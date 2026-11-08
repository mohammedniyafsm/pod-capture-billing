import { UserRole } from "@prisma/client";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { CaptureError, processPodCapture } from "@/src/lib/pods/capture/capture";
import { logPodEvent } from "@/src/lib/pods/common/podLogger";
import { parsePodUploadRequest } from "@/src/lib/pods/validation/uploadValidation";

export const maxDuration = 60;

const requireDriver = requireRole(UserRole.DRIVER);

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  const auth = await requireDriver(request);
  if (!auth.ok) {
    logPodEvent(
      "route.authentication_failed",
      { httpStatus: auth.response.status },
      "warn",
    );
    return auth.response;
  }

  const parsed = await parsePodUploadRequest(request);
  if (!parsed.success) {
    logPodEvent(
      "route.request_rejected",
      { httpStatus: parsed.status, errorCode: parsed.code },
      "warn",
    );
    return Response.json(
      {
        error: parsed.error,
        code: parsed.code,
        ...(parsed.details ? { details: parsed.details } : {}),
      },
      { status: parsed.status },
    );
  }

  logPodEvent("route.request_accepted", {
    clientSubmissionId: parsed.data.clientSubmissionId,
    tripId: parsed.data.tripId,
    imageSizeBytes: parsed.data.imageBytes.byteLength,
    detectedMimeType: parsed.data.mediaType,
  });

  try {
    const result = await processPodCapture(parsed.data, {
      userId: auth.session.userId,
    });

    logPodEvent("route.response_sent", {
      clientSubmissionId: parsed.data.clientSubmissionId,
      tripId: parsed.data.tripId,
      submissionId: result.submissionId,
      httpStatus: 202,
      status: result.status,
      enqueued: result.enqueued,
      durationMs: Date.now() - requestStartedAt,
    });

    return Response.json(
      {
        success: true,
        message: result.enqueued === false
          ? "POD uploaded. Verification queuing delayed; status will be available shortly."
          : "POD uploaded. Verification is in progress.",
        data: result,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof CaptureError) {
      logPodEvent(
        "route.response_sent",
        {
          clientSubmissionId: parsed.data.clientSubmissionId,
          tripId: parsed.data.tripId,
          httpStatus: error.status,
          errorCode: error.code,
          durationMs: Date.now() - requestStartedAt,
        },
        error.status >= 500 ? "error" : "warn",
      );
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    logPodEvent(
      "route.unexpected_error",
      {
        clientSubmissionId: parsed.data.clientSubmissionId,
        tripId: parsed.data.tripId,
        errorType: error instanceof Error ? error.name : "UnknownError",
        durationMs: Date.now() - requestStartedAt,
      },
      "error",
    );
    throw error;
  }
}
