import { PodSubmissionStatus, Prisma, TripStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma";
import { getPodImageStorage } from "../storage/imageStorage";
import { logPodEvent } from "../common/podLogger";
import { enqueuePodVerification } from "../queue/queue";
import { claimUploadLink } from "../links/uploadLinks";
import type { ParsedPodUpload } from "../validation/uploadValidation";

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

class CaptureConflictError extends Error { }

function isPrismaUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export type AcceptedPodCapture = {
  submissionId: string;
  status: PodSubmissionStatus;
  enqueued?: boolean;
};

async function findExistingSubmission(clientSubmissionId: string) {
  return prisma.podSubmission.findUnique({
    where: { clientSubmissionId },
    select: {
      id: true,
      tripId: true,
      uploadLinkId: true,
      status: true,
      trip: { select: { driverId: true } },
    },
  });
}

export async function processPodCapture(
  upload: ParsedPodUpload,
  actor: { userId: string | null; uploadLinkId?: string },
): Promise<AcceptedPodCapture> {


  logPodEvent("capture.started", {
    clientSubmissionId: upload.clientSubmissionId,
    tripId: upload.tripId,
    source: actor.uploadLinkId ? "upload_link" : "driver",
    imageSizeBytes: upload.imageBytes.byteLength,
    detectedMimeType: upload.mediaType,
  });

  const existing = await findExistingSubmission(upload.clientSubmissionId);

  if (existing) {
    if (
      existing.tripId !== upload.tripId ||
      existing.uploadLinkId !== (actor.uploadLinkId ?? null)
    ) {
      throw new CaptureError(
        "clientSubmissionId has already been used for another upload.",
        409,
        "submission_id_conflict",
      );
    }

    if (actor.userId && existing.trip.driverId !== actor.userId) {
      throw new CaptureError("Trip not found.", 404, "trip_not_found");
    }

    // If existing submission is still awaiting verification, attempt to safely re-enqueue in BullMQ
    if (existing.status === PodSubmissionStatus.AI_CHECKING) {
      try {
        await enqueuePodVerification(existing.id);
      } catch (enqueueError) {
        logPodEvent(
          "submission.re_enqueue_failed",
          {
            submissionId: existing.id,
            errorType: enqueueError instanceof Error ? enqueueError.name : "UnknownError",
            errorMessage: enqueueError instanceof Error ? enqueueError.message : "Unknown",
          },
          "error",
        );
      }
    }

    return { submissionId: existing.id, status: existing.status };
  }

  const trip = await prisma.trip.findUnique({
    where: { id: upload.tripId },
    select: {
      id: true,
      driverId: true,
      isHired: true,
      retakeCount: true,
      status: true,
    },
  });
  if (!trip) throw new CaptureError("Trip not found.", 404, "trip_not_found");
  if (actor.userId && trip.driverId !== actor.userId) {
    throw new CaptureError("Trip not found.", 404, "trip_not_found");
  }
  if (actor.uploadLinkId && !trip.isHired) {
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
    const repeated = await findExistingSubmission(upload.clientSubmissionId);
    if (repeated?.tripId === upload.tripId) {
      return { submissionId: repeated.id, status: repeated.status };
    }
    throw new CaptureError(
      "This trip is not currently accepting a POD image.",
      409,
      "trip_not_accepting_pod",
    );
  }

  const storage = getPodImageStorage();
  const imageKey = await storage.save(upload.imageBytes, upload.mediaType);
  const submissionId = randomUUID();
  const uploadedAt = new Date();

  try {
    await prisma.$transaction(async (transaction) => {
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
        data: {
          status: TripStatus.AI_CHECKING,
          podReceivedAt: uploadedAt,
        },
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
          sourceFilename: upload.imageFilename.slice(0, 255),
          sizeKb: Math.ceil(upload.imageBytes.byteLength / 1024),
          gpsLat: upload.gpsLat,
          gpsLng: upload.gpsLng,
          capturedAt: upload.capturedAt,
          uploadedAt,
          status: PodSubmissionStatus.AI_CHECKING,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: actor.userId,
          action: actor.uploadLinkId ? "POD_UPLOADED_BY_LINK" : "POD_UPLOADED",
          entity: "PodSubmission",
          entityId: submissionId,
        },
      });
    });
  } catch (error) {
    try {
      await storage.remove(imageKey);
    } catch (cleanupError) {
      logPodEvent("image.cleanup_failed", {
        submissionId,
        errorType:
          cleanupError instanceof Error ? cleanupError.name : "UnknownError",
      }, "error");
    }
    logPodEvent("submission.create_failed", {
      submissionId,
      errorType: error instanceof Error ? error.name : "UnknownError",
      prismaCode:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : undefined,
    }, "error");

    if (isPrismaUniqueError(error)) {
      const repeated = await findExistingSubmission(upload.clientSubmissionId);
      if (
        repeated?.tripId === upload.tripId &&
        repeated.uploadLinkId === (actor.uploadLinkId ?? null)
      ) {
        return { submissionId: repeated.id, status: repeated.status };
      }
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

  logPodEvent("submission.accepted", {
    submissionId,
    status: PodSubmissionStatus.AI_CHECKING,
  });

  let enqueued = false;
  try {
    await enqueuePodVerification(submissionId);
    enqueued = true;
  } catch (enqueueError) {
    logPodEvent(
      "submission.enqueue_failed",
      {
        submissionId,
        errorType:
          enqueueError instanceof Error ? enqueueError.name : "UnknownError",
        errorMessage:
          enqueueError instanceof Error ? enqueueError.message : "Unknown",
      },
      "error",
    );
  }

  return {
    submissionId,
    status: PodSubmissionStatus.AI_CHECKING,
    enqueued,
  };
}
