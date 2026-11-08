import { prisma } from "../../../../src/lib/prisma";
import { CaptureError, processPodCapture } from "../../../../src/lib/pods/capture/capture";
import { deriveUploadLinkStatus, hashUploadToken } from "../../../../src/lib/pods/links/uploadLinks";
import { parsePodUploadRequest } from "../../../../src/lib/pods/validation/uploadValidation";

export const maxDuration = 60;

/**
 * Public endpoint to fetch safe metadata for an upload token.
 * Used by the public mobile upload page (app/upload/[token]/page.tsx).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return Response.json(
      { error: "Upload link not found.", code: "upload_link_not_found" },
      { status: 404 },
    );
  }

  const uploadLink = await prisma.uploadLink.findUnique({
    where: { tokenHash: hashUploadToken(token) },
    include: {
      trip: {
        select: {
          id: true,
          tripCode: true,
          origin: true,
          destination: true,
          lrNumber: true,
          isHired: true,
          status: true,
          client: { select: { name: true } },
          vehicle: { select: { vehicleNo: true } },
        },
      },
      submission: { select: { id: true, status: true } },
    },
  });

  if (!uploadLink) {
    return Response.json(
      { error: "Upload link not found.", code: "upload_link_not_found" },
      { status: 404 },
    );
  }

  const linkStatus = deriveUploadLinkStatus(uploadLink);

  return Response.json({
    valid: linkStatus === "ACTIVE",
    status: linkStatus,
    expiresAt: uploadLink.expiresAt.toISOString(),
    usedAt: uploadLink.usedAt ? uploadLink.usedAt.toISOString() : null,
    trip: {
      id: uploadLink.trip.id,
      tripCode: uploadLink.trip.tripCode,
      lrNumber: uploadLink.trip.lrNumber,
      origin: uploadLink.trip.origin,
      destination: uploadLink.trip.destination,
      clientName: uploadLink.trip.client?.name ?? "Client",
      vehicleNo: uploadLink.trip.vehicle?.vehicleNo ?? "Hired Vehicle",
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return Response.json(
      { error: "Upload link not found.", code: "upload_link_not_found" },
      { status: 404 },
    );
  }

  const parsed = await parsePodUploadRequest(request);
  if (!parsed.success) {
    return Response.json(
      {
        error: parsed.error,
        code: parsed.code,
        ...(parsed.details ? { details: parsed.details } : {}),
      },
      { status: parsed.status },
    );
  }

  const uploadLink = await prisma.uploadLink.findUnique({
    where: { tokenHash: hashUploadToken(token) },
    include: { trip: { select: { isHired: true } } },
  });
  if (!uploadLink) {
    return Response.json(
      { error: "Upload link not found.", code: "upload_link_not_found" },
      { status: 404 },
    );
  }
  if (!uploadLink.trip.isHired || uploadLink.tripId !== parsed.data.tripId) {
    return Response.json(
      { error: "Upload link does not match this trip.", code: "invalid_upload_link" },
      { status: 403 },
    );
  }

  if (uploadLink.usedAt || uploadLink.expiresAt <= new Date()) {
    const repeated = await prisma.podSubmission.findUnique({
      where: { clientSubmissionId: parsed.data.clientSubmissionId },
      select: { tripId: true, uploadLinkId: true },
    });
    if (
      repeated?.tripId !== uploadLink.tripId ||
      repeated.uploadLinkId !== uploadLink.id
    ) {
      return Response.json(
        {
          error: "This upload link has expired or has already been used.",
          code: "upload_link_unavailable",
        },
        { status: 410 },
      );
    }
  }

  try {
    const result = await processPodCapture(parsed.data, {
      userId: null,
      uploadLinkId: uploadLink.id,
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
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
