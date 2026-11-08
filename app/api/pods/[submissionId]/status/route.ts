import { requireTripReadAccess } from "@/src/lib/auth/rbac/requireRole";
import { prisma } from "@/src/lib/prisma";

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const { submissionId } = await context.params;
  const submission = await prisma.podSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      retakeReason: true,
      attemptsLeft: true,
      extraction: { select: { verdict: true, reasons: true } },
      trip: { select: { id: true, driverId: true, status: true } },
    },
  });
  if (!submission) {
    return Response.json(
      { error: "POD submission not found.", code: "submission_not_found" },
      { status: 404 },
    );
  }

  const auth = await requireTripReadAccess(request, submission.trip.driverId);
  if (!auth.ok) return auth.response;

  return Response.json({
    submission: {
      id: submission.id,
      status: submission.status,
      verdict: submission.extraction?.verdict ?? null,
      reasons: submission.extraction?.reasons ?? [],
      retakeReason: submission.retakeReason,
      attemptsLeft: submission.attemptsLeft,
      message:
        submission.status === "FAILED"
          ? "Verification could not be completed. Please upload the POD again."
          : null,
    },
    trip: { id: submission.trip.id, status: submission.trip.status },
  });
}
