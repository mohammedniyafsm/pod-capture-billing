import {
  PodSubmissionStatus,
  Prisma,
  TripStatus,
  Verdict as DatabaseVerdict,
} from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import {
  extractPod,
  type PodExtractionData,
} from "../ai/extractPod";
import { decideVerdict, MAX_RETAKES, type RetakeReason } from "./verdict";
import { getPodImageStorage } from "../storage/imageStorage";
import { logPodEvent } from "../ai/podLogger";

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateOnlyInKolkata(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) {
    throw new Error("Could not format the recorded delivery date.");
  }
  return `${year}-${month}-${day}`;
}

function mapExtractionToVerdict(extraction: PodExtractionData) {
  return {
    fields: {
      lr_number: extraction.lr_number.value,
      consignee_stamp_present: extraction.consignee_stamp.present,
      signature_present: extraction.signature.present,
      remarks_text: extraction.remarks_text,
      image_readable: extraction.image_quality.readable,
      blurry: extraction.image_quality.blur,
      cropped: extraction.image_quality.cropped,
      delivery_date: extraction.delivery_date.value,
      quantity_received: extraction.quantity_received.value,
      quantity_unit: extraction.quantity_received.unit,
      goods_description: extraction.goods_description.value,
      has_shortage_or_damage_remark:
        extraction.has_shortage_or_damage_remark,
      retake_hint: extraction.retake_hint,
    },
    confidences: {
      lr_number: extraction.lr_number.confidence,
      consignee_stamp: extraction.consignee_stamp.confidence,
      signature: extraction.signature.confidence,
      delivery_date: extraction.delivery_date.confidence,
      quantity_received: extraction.quantity_received.confidence,
      goods_description: extraction.goods_description.confidence,
    },
  };
}

function databaseStatus(verdict: DatabaseVerdict): TripStatus {
  if (verdict === DatabaseVerdict.VERIFIED) return TripStatus.VERIFIED;
  if (verdict === DatabaseVerdict.RETAKE) return TripStatus.RETAKE_REQUESTED;
  return TripStatus.NEEDS_REVIEW;
}

export class PermanentPodVerificationError extends Error {}

export class RetryablePodVerificationError extends Error {}

function toUint8Array(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

export async function markPodVerificationFailed(
  submissionId: string,
  error: unknown,
) {
  const errorMessage =
    error instanceof Error ? error.name : "UnknownWorkerError";
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.podSubmission.updateMany({
      where: {
        id: submissionId,
        status: PodSubmissionStatus.AI_CHECKING,
      },
      data: {
        status: PodSubmissionStatus.FAILED,
        processingError: errorMessage.slice(0, 1000),
      },
    });
    if (updated.count !== 1) return;
    const submission = await transaction.podSubmission.findUnique({
      where: { id: submissionId },
      select: { tripId: true },
    });
    if (!submission) return;
    await transaction.trip.updateMany({
      where: { id: submission.tripId, status: TripStatus.AI_CHECKING },
      data: {
        status: TripStatus.POD_PENDING,
        statusReason: "pod_processing_failed",
      },
    });
  });
  logPodEvent("worker.submission_failed", {
    submissionId,
    errorType: error instanceof Error ? error.name : "UnknownError",
  }, "error");
}

export async function processPodVerification(submissionId: string) {
  const submission = await prisma.podSubmission.findUnique({
    where: { id: submissionId },
    include: {
      extraction: true,
      trip: {
        select: {
          id: true,
          lrNumber: true,
          expectedQuantity: true,
          quantityUnit: true,
          goodsDescription: true,
          deliveredAt: true,
          retakeCount: true,
          status: true,
        },
      },
    },
  });
  if (!submission) {
    throw new PermanentPodVerificationError("POD submission does not exist.");
  }
  if (submission.extraction) return "already_processed" as const;
  if (submission.status !== PodSubmissionStatus.AI_CHECKING) {
    return "not_processing" as const;
  }

  const storage = getPodImageStorage();
  const storedImage = await storage.read(submission.imageKey);
  if (!storedImage) {
    throw new PermanentPodVerificationError("Stored POD image is missing.");
  }
  const imageBytes = await toUint8Array(storedImage.body);
  const mediaType = storedImage.contentType;
  if (
    mediaType !== "image/jpeg" &&
    mediaType !== "image/png" &&
    mediaType !== "image/webp"
  ) {
    throw new PermanentPodVerificationError("Stored POD has an unsupported media type.");
  }

  const aiResult = await extractPod({
    imageBytes,
    imageFilename:
      submission.sourceFilename || `pod-attempt-${submission.attemptNo}`,
    mediaType,
    correlationId: submission.clientSubmissionId ?? submission.id,
    expectedLrNumber: submission.trip.lrNumber,
    expectedGoodsDescription: submission.trip.goodsDescription,
    expectedQuantity: submission.trip.expectedQuantity.toNumber(),
    expectedQuantityUnit: submission.trip.quantityUnit,
    recordedDeliveryDate: submission.trip.deliveredAt
      ? dateOnlyInKolkata(submission.trip.deliveredAt)
      : null,
  });
  if (!aiResult.ok) {
    const message = `POD extraction failed: ${aiResult.reason}`;
    if (aiResult.retryable !== true) {
      throw new PermanentPodVerificationError(message);
    }
    throw new RetryablePodVerificationError(message);
  }

  const mapped = mapExtractionToVerdict(aiResult.extraction);
  const decision = decideVerdict(
    { fields: mapped.fields, confidences: mapped.confidences },
    {
      lrNumber: submission.trip.lrNumber,
      expectedQuantity: submission.trip.expectedQuantity.toNumber(),
      quantityUnit: submission.trip.quantityUnit,
      goodsDescription: submission.trip.goodsDescription,
      deliveredAt: submission.trip.deliveredAt,
    },
    submission.trip.retakeCount,
  );
  const verdict =
    decision.verdict === "VERIFIED"
      ? DatabaseVerdict.VERIFIED
      : decision.verdict === "RETAKE"
        ? DatabaseVerdict.RETAKE
        : DatabaseVerdict.REVIEW;
  const nextStatus = databaseStatus(verdict);
  const nextRetakeCount =
    submission.trip.retakeCount + (verdict === DatabaseVerdict.RETAKE ? 1 : 0);
  const attemptsLeft = Math.max(0, MAX_RETAKES - nextRetakeCount);
  const retakeReason: RetakeReason | null = decision.retakeReason ?? null;
  const deliveredQuantity =
    verdict === DatabaseVerdict.VERIFIED
      ? aiResult.extraction.quantity_received.value
      : null;
  if (verdict === DatabaseVerdict.VERIFIED && deliveredQuantity === null) {
    throw new PermanentPodVerificationError(
      "A verified POD must include an extracted quantity.",
    );
  }

  const result = await prisma.$transaction(async (transaction) => {
    const current = await transaction.podSubmission.findUnique({
      where: { id: submissionId },
      select: { status: true, extraction: { select: { submissionId: true } } },
    });
    if (current?.extraction) return "already_processed" as const;
    if (current?.status !== PodSubmissionStatus.AI_CHECKING) {
      return "not_processing" as const;
    }

    const updatedTrip = await transaction.trip.updateMany({
      where: {
        id: submission.trip.id,
        status: TripStatus.AI_CHECKING,
      },
      data: {
        status: nextStatus,
        statusReason: decision.reasons.join(","),
        ...(verdict === DatabaseVerdict.RETAKE
          ? { retakeCount: { increment: 1 } }
          : {}),
        ...(deliveredQuantity === null
          ? {}
          : { deliveredQuantity: new Prisma.Decimal(deliveredQuantity) }),
        ...(verdict === DatabaseVerdict.VERIFIED
          ? { verifiedAt: new Date() }
          : {}),
      },
    });
    if (updatedTrip.count !== 1) return "not_processing" as const;

    await transaction.podSubmission.update({
      where: { id: submissionId },
      data: {
        status:
          verdict === DatabaseVerdict.VERIFIED
            ? PodSubmissionStatus.VERIFIED
            : verdict === DatabaseVerdict.RETAKE
              ? PodSubmissionStatus.RETAKE
              : PodSubmissionStatus.REVIEW,
        retakeReason,
        processingError: null,
        attemptsLeft,
        extraction: {
          create: {
            fields: jsonInput(mapped.fields),
            confidences: jsonInput(mapped.confidences),
            verdict,
            reasons: decision.reasons,
            modelName: aiResult.modelName,
            rawResponse: jsonInput(aiResult.rawResponse),
          },
        },
      },
    });

    return "processed" as const;
  });

  logPodEvent("worker.verification_completed", {
    submissionId,
    result,
    verdict,
    reasons: decision.reasons,
    attemptsLeft,
  });
  return result;
}
