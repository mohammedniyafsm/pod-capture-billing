import { UserRole } from "@prisma/client";
import { requireRole } from "@/src/lib/auth/requireRole";
import { CaptureError, processPodCapture } from "@/src/lib/pods/capture";
import { logPodEvent } from "@/src/lib/pods/podLogger";
import { parsePodUploadRequest } from "@/src/lib/pods/uploadValidation";

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
      httpStatus: 200,
      verdict: result.verdict,
      durationMs: Date.now() - requestStartedAt,
    });
    return Response.json(result);
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
