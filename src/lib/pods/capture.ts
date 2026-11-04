import {
  PodSubmissionStatus,
  Prisma,
  TripStatus,
  Verdict as DatabaseVerdict,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import {
  decideVerdict,
  MAX_RETAKES,
  type RetakeReason,
} from "../verdict";
import {
  extractPod,
  type PodExtractionData,
} from "../ai/extractPod";
import { getPodImageStorage } from "./imageStorage";
import { logPodEvent, type PodLogLevel } from "./podLogger";
import { claimUploadLink } from "./uploadLinks";
import type { ParsedPodUpload } from "./uploadValidation";

type CaptureResponse = {
  verdict: DatabaseVerdict;
  reasons: string[];
  retakeReason: string | null;
  attemptsLeft: number;
};

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

class CaptureConflictError extends Error {}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

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

function buildResponse(submission: {
  retakeReason: string | null;
  attemptsLeft: number | null;
  extraction: { verdict: DatabaseVerdict; reasons: string[] } | null;
}): CaptureResponse | null {
  if (!submission.extraction) return null;
  return {
    verdict: submission.extraction.verdict,
    reasons: submission.extraction.reasons,
    retakeReason: submission.retakeReason,
    attemptsLeft: submission.attemptsLeft ?? 0,
  };
}

async function findExistingSubmission(clientSubmissionId: string) {
  return prisma.podSubmission.findUnique({
    where: { clientSubmissionId },
    include: { trip: true, extraction: true },
  });
}

async function waitForExistingResult(
  clientSubmissionId: string,
  tripId: string,
  submissionId?: string,
): Promise<CaptureResponse | null> {
  logPodEvent("submission.wait_started", {
    clientSubmissionId,
    tripId,
    submissionId,
    waitLimitMs: 32_000,
  });
  const deadline = Date.now() + 32_000;
  let lastStatus: PodSubmissionStatus | undefined;
  do {
    const submission = await findExistingSubmission(clientSubmissionId);
    if (!submission || submission.tripId !== tripId) return null;
    lastStatus = submission.status;
    const result = buildResponse(submission);
    if (result) {
      logPodEvent("submission.wait_completed", {
        clientSubmissionId,
        tripId,
        submissionId: submission.id,
        status: submission.status,
        verdict: result.verdict,
      });
      return result;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  } while (Date.now() < deadline);
  logPodEvent(
    "submission.wait_timed_out",
    {
      clientSubmissionId,
      tripId,
      submissionId,
      lastStatus,
      nextAction: "Inspect this submission and recover it; do not reuse its ID for a different image.",
    },
    "error",
  );
  throw new CaptureError(
    "This POD submission is still being processed. Retry with the same clientSubmissionId.",
    202,
    "processing",
  );
}

export async function processPodCapture(
  upload: ParsedPodUpload,
  actor: { userId: string | null; uploadLinkId?: string },
): Promise<CaptureResponse> {
  const startedAt = Date.now();
  const log = (
    event: string,
    details: Readonly<Record<string, unknown>> = {},
    level: PodLogLevel = "info",
  ) =>
    logPodEvent(
      event,
      {
        clientSubmissionId: upload.clientSubmissionId,
        tripId: upload.tripId,
        ...details,
      },
      level,
    );

  log("capture.started", {
    source: actor.uploadLinkId ? "upload_link" : "driver",
    imageSizeBytes: upload.imageBytes.byteLength,
    detectedMimeType: upload.mediaType,
  });
  log("submission.lookup_started");
  const existing = await findExistingSubmission(upload.clientSubmissionId);
  if (existing) {
    log("submission.found", {
      submissionId: existing.id,
      submissionStatus: existing.status,
      hasExtraction: Boolean(existing.extraction),
      attemptNo: existing.attemptNo,
    });
    if (existing.tripId !== upload.tripId) {
      log("submission.id_conflict", { existingTripId: existing.tripId }, "error");
      throw new CaptureError(
        "clientSubmissionId has already been used for another trip.",
        409,
        "submission_id_conflict",
      );
    }
    if (existing.uploadLinkId !== (actor.uploadLinkId ?? null)) {
      log("submission.upload_conflict", {}, "error");
      throw new CaptureError(
        "clientSubmissionId has already been used for another upload.",
        409,
        "submission_id_conflict",
      );
    }
    if (actor.userId && existing.trip.driverId !== actor.userId) {
      log("submission.not_found_for_actor", {}, "warn");
      throw new CaptureError("Trip not found.", 404, "trip_not_found");
    }
    const result = buildResponse(existing);
    if (result) {
      log("submission.idempotent_result_returned", {
        submissionId: existing.id,
        verdict: result.verdict,
        reasons: result.reasons,
      });
      return result;
    }
    const pendingResult = await waitForExistingResult(
      upload.clientSubmissionId,
      upload.tripId,
      existing.id,
    );
    if (pendingResult) return pendingResult;
    throw new CaptureError(
      "The existing POD submission could not be found.",
      404,
      "submission_not_found",
    );
  }

  log("trip.lookup_started");
  const trip = await prisma.trip.findUnique({
    where: { id: upload.tripId },
    select: {
      id: true,
      lrNumber: true,
      driverId: true,
      isHired: true,
      retakeCount: true,
      status: true,
      expectedQuantity: true,
      quantityUnit: true,
      goodsDescription: true,
      deliveredAt: true,
    },
  });

  if (!trip) {
    log("trip.lookup_not_found", {}, "warn");
    throw new CaptureError("Trip not found.", 404, "trip_not_found");
  }
  log("trip.found", {
    tripStatus: trip.status,
    retakeCount: trip.retakeCount,
    isHired: trip.isHired,
  });
  if (actor.userId && trip.driverId !== actor.userId) {
    log("trip.owner_mismatch", {}, "warn");
    throw new CaptureError("Trip not found.", 404, "trip_not_found");
  }
  if (actor.uploadLinkId && !trip.isHired) {
    log("trip.upload_link_not_allowed", {}, "warn");
    throw new CaptureError(
      "This upload link is not valid for a hired-driver trip.",
      403,
      "invalid_upload_link",
    );
  }

  if (
    trip.status !== TripStatus.POD_PENDING &&
    trip.status !== TripStatus.RETAKE_REQUESTED &&
    !(actor.uploadLinkId && trip.status === TripStatus.UNASSIGNED)
  ) {
    log("trip.status_not_eligible", {
      tripStatus: trip.status,
      allowedStatuses: [
        TripStatus.POD_PENDING,
        TripStatus.RETAKE_REQUESTED,
        ...(actor.uploadLinkId ? [TripStatus.UNASSIGNED] : []),
      ],
    }, "warn");
    const repeated = await findExistingSubmission(upload.clientSubmissionId);
    if (repeated?.tripId === upload.tripId) {
      log("submission.found_during_status_check", {
        submissionId: repeated.id,
        submissionStatus: repeated.status,
        hasExtraction: Boolean(repeated.extraction),
      });
      if (repeated.uploadLinkId !== (actor.uploadLinkId ?? null)) {
        throw new CaptureError(
          "clientSubmissionId has already been used for another upload.",
          409,
          "submission_id_conflict",
        );
      }
      if (actor.userId && repeated.trip.driverId !== actor.userId) {
        throw new CaptureError("Trip not found.", 404, "trip_not_found");
      }
      const completed = buildResponse(repeated);
      if (completed) return completed;
      const pendingResult = await waitForExistingResult(
        upload.clientSubmissionId,
        upload.tripId,
        repeated.id,
      );
      if (pendingResult) return pendingResult;
    }
    throw new CaptureError(
      "This trip is not currently accepting a POD image.",
      409,
      "trip_not_accepting_pod",
    );
  }

  const storage = getPodImageStorage();
  log("image.storage_started");
  let imageKey: string;
  try {
    imageKey = await storage.save(upload.imageBytes, upload.mediaType);
  } catch (error) {
    log(
      "image.storage_failed",
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "error",
    );
    throw error;
  }
  log("image.storage_completed");
  const submissionId = randomUUID();

  try {
    const attemptNo = await prisma.$transaction(async (transaction) => {
      if (actor.uploadLinkId) {
        const claimedLink = await claimUploadLink(
          transaction,
          actor.uploadLinkId,
        );
        if (!claimedLink) {
          throw new CaptureError(
            "This upload link has expired or has already been used.",
            410,
            "upload_link_unavailable",
          );
        }
      }

      const currentAttempt = await transaction.podSubmission.findFirst({
        where: { tripId: trip.id },
        orderBy: { attemptNo: "desc" },
        select: { attemptNo: true },
      });
      const nextAttemptNo = (currentAttempt?.attemptNo ?? 0) + 1;

      const updatedTrip = await transaction.trip.updateMany({
        where: {
          id: trip.id,
          status: {
            in: [
              TripStatus.POD_PENDING,
              TripStatus.RETAKE_REQUESTED,
              ...(actor.uploadLinkId ? [TripStatus.UNASSIGNED] : []),
            ],
          },
          retakeCount: trip.retakeCount,
          ...(actor.userId ? { driverId: actor.userId } : {}),
        },
        data: { status: TripStatus.AI_CHECKING },
      });
      if (updatedTrip.count !== 1) {
        throw new CaptureConflictError("Trip state changed before capture.");
      }

      await transaction.podSubmission.create({
        data: {
          id: submissionId,
          clientSubmissionId: upload.clientSubmissionId,
          uploadLinkId: actor.uploadLinkId ?? null,
          tripId: trip.id,
          attemptNo: nextAttemptNo,
          imageKey,
          sizeKb: Math.ceil(upload.imageBytes.byteLength / 1024),
          gpsLat: upload.gpsLat,
          gpsLng: upload.gpsLng,
          capturedAt: upload.capturedAt,
          status: PodSubmissionStatus.AI_CHECKING,
        },
      });
      return nextAttemptNo;
    });
    log("submission.created", {
      submissionId,
      attemptNo,
      submissionStatus: PodSubmissionStatus.AI_CHECKING,
      tripStatus: TripStatus.AI_CHECKING,
    });
  } catch (error) {
    await storage.remove(imageKey);
    log(
      "submission.create_failed",
      {
        submissionId,
        errorType: error instanceof Error ? error.name : "UnknownError",
        prismaCode:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : undefined,
      },
      "error",
    );
    if (isPrismaUniqueError(error)) {
      const repeated = await waitForExistingResult(
        upload.clientSubmissionId,
        upload.tripId,
        submissionId,
      );
      if (repeated) return repeated;
    }
    if (error instanceof CaptureError) throw error;
    if (error instanceof CaptureConflictError) {
      throw new CaptureError(
        "Another POD capture changed this trip. Refresh and try again.",
        409,
        "trip_state_conflict",
      );
    }
    throw error;
  }

  let aiResult: Awaited<ReturnType<typeof extractPod>>;
  log("ai.extraction_started", { submissionId });
  try {
    aiResult = await extractPod({
      imageBytes: upload.imageBytes,
      imageFilename: upload.imageFilename,
      mediaType: upload.mediaType,
      correlationId: upload.clientSubmissionId,
      expectedLrNumber: trip.lrNumber,
      expectedGoodsDescription: trip.goodsDescription,
      expectedQuantity: trip.expectedQuantity.toNumber(),
      expectedQuantityUnit: trip.quantityUnit,
      recordedDeliveryDate: trip.deliveredAt
        ? dateOnlyInKolkata(trip.deliveredAt)
        : null,
    });
  } catch (error) {
    log(
      "ai.unexpected_error",
      {
        submissionId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "error",
    );
    aiResult = {
      ok: false,
      aiFailed: true,
      aiTimedOut: false,
      reason: "request_failed",
    };
  }
  log("ai.extraction_finished", {
    submissionId,
    success: aiResult.ok,
    modelName: aiResult.ok ? aiResult.modelName : undefined,
    failureReason: aiResult.ok ? undefined : aiResult.reason,
    timedOut: aiResult.ok ? false : aiResult.aiTimedOut,
  });

  const mapped = aiResult.ok ? mapExtractionToVerdict(aiResult.extraction) : null;
  const decision = decideVerdict(
    mapped
      ? {
          fields: mapped.fields,
          confidences: mapped.confidences,
        }
      : { aiFailed: true },
    {
      lrNumber: trip.lrNumber,
      expectedQuantity: trip.expectedQuantity.toNumber(),
      quantityUnit: trip.quantityUnit,
      goodsDescription: trip.goodsDescription,
      deliveredAt: trip.deliveredAt,
    },
    trip.retakeCount,
  );
  const dbVerdict =
    decision.verdict === "VERIFIED"
      ? DatabaseVerdict.VERIFIED
      : decision.verdict === "RETAKE"
        ? DatabaseVerdict.RETAKE
        : DatabaseVerdict.REVIEW;
  const nextRetakeCount =
    trip.retakeCount + (dbVerdict === DatabaseVerdict.RETAKE ? 1 : 0);
  const attemptsLeft = Math.max(0, MAX_RETAKES - nextRetakeCount);
  const retakeReason: RetakeReason | null = decision.retakeReason ?? null;
  const rawResponse = aiResult.ok
    ? aiResult.rawResponse
    : (aiResult.rawResponse ?? { failure: aiResult.reason });
  const extractionFields = mapped?.fields ?? {};
  const extractionConfidences = mapped?.confidences ?? {};
  const newTripStatus = databaseStatus(dbVerdict);
  const statusReason = decision.reasons.join(",");
  log("verdict.decided", {
    submissionId,
    verdict: dbVerdict,
    reasons: decision.reasons,
    retakeReason,
    attemptsLeft,
    nextTripStatus: newTripStatus,
  });
  const deliveredQuantity =
    dbVerdict === DatabaseVerdict.VERIFIED && aiResult.ok
      ? aiResult.extraction.quantity_received.value
      : null;
  if (dbVerdict === DatabaseVerdict.VERIFIED && deliveredQuantity === null) {
    throw new Error("A verified POD must include an extracted quantity.");
  }
  const deliveredQuantityUpdate =
    deliveredQuantity === null
      ? {}
      : { deliveredQuantity: new Prisma.Decimal(deliveredQuantity) };

  log("result.persistence_started", { submissionId });
  let result: CaptureResponse | null;
  try {
    result = await prisma.$transaction(async (transaction) => {
    const submission = await transaction.podSubmission.update({
      where: { id: submissionId },
      data: {
        status:
          dbVerdict === DatabaseVerdict.VERIFIED
            ? PodSubmissionStatus.VERIFIED
            : dbVerdict === DatabaseVerdict.RETAKE
              ? PodSubmissionStatus.RETAKE
              : PodSubmissionStatus.REVIEW,
        retakeReason,
        attemptsLeft,
        extraction: {
          create: {
            fields: jsonInput(extractionFields),
            confidences: jsonInput(extractionConfidences),
            verdict: dbVerdict,
            reasons: decision.reasons,
            modelName: aiResult.ok ? aiResult.modelName : "unavailable",
            rawResponse: jsonInput(rawResponse),
          },
        },
      },
      include: { extraction: true },
    });

    await transaction.trip.update({
      where: { id: trip.id },
      data: {
        status: newTripStatus,
        statusReason,
        podReceivedAt: new Date(),
        ...(dbVerdict === DatabaseVerdict.RETAKE
          ? { retakeCount: { increment: 1 } }
          : {}),
        ...(dbVerdict === DatabaseVerdict.VERIFIED
          ? {
              verifiedAt: new Date(),
              ...deliveredQuantityUpdate,
            }
          : {}),
      },
    });

    await transaction.auditLog.create({
      data: {
        userId: actor.userId,
        action: actor.uploadLinkId ? "POD_UPLOADED_BY_LINK" : "POD_UPLOADED",
        entity: "PodSubmission",
        entityId: submission.id,
      },
    });

    return buildResponse(submission);
    });
  } catch (error) {
    log(
      "result.persistence_failed",
      {
        submissionId,
        errorType: error instanceof Error ? error.name : "UnknownError",
        prismaCode:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : undefined,
      },
      "error",
    );
    throw error;
  }

  if (!result) {
    throw new Error("POD extraction was saved without a verdict.");
  }
  log("capture.completed", {
    submissionId,
    verdict: result.verdict,
    reasons: result.reasons,
    attemptsLeft: result.attemptsLeft,
    durationMs: Date.now() - startedAt,
  });
  return result;
}
