import { prisma } from "@/src/lib/prisma";
import { requireTripReadAccess } from "@/src/lib/auth/requireRole";
import { createPodImageToken, POD_IMAGE_URL_TTL_SECONDS } from "@/src/lib/pods/imageUrl";

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const { submissionId } = await context.params;
  const submission = await prisma.podSubmission.findUnique({
    where: { id: submissionId },
    select: { trip: { select: { driverId: true } } },
  });
  if (!submission) {
    return Response.json(
      { error: "POD submission not found.", code: "submission_not_found" },
      { status: 404 },
    );
  }

  const auth = await requireTripReadAccess(request, submission.trip.driverId);
  if (!auth.ok) return auth.response;

  const token = await createPodImageToken(submissionId);
  const imageUrl = new URL(
    `/api/pods/${encodeURIComponent(submissionId)}/image?token=${encodeURIComponent(token)}`,
    request.url,
  );
  return Response.json({
    url: imageUrl.toString(),
    expiresInSeconds: POD_IMAGE_URL_TTL_SECONDS,
  });
}
