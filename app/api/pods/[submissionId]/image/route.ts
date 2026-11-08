import { prisma } from "@/src/lib/prisma";
import { verifyPodImageToken } from "@/src/lib/pods/storage/imageUrl";
import { getPodImageStorage } from "@/src/lib/pods/storage/imageStorage";

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const { submissionId } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !(await verifyPodImageToken(token, submissionId))) {
    return Response.json(
      { error: "Image URL is invalid or expired.", code: "invalid_image_url" },
      { status: 403 },
    );
  }

  const submission = await prisma.podSubmission.findUnique({
    where: { id: submissionId },
    select: { imageKey: true },
  });
  if (!submission) {
    return Response.json(
      { error: "POD submission not found.", code: "submission_not_found" },
      { status: 404 },
    );
  }

  const image = await getPodImageStorage().read(submission.imageKey);
  if (!image) {
    return Response.json(
      { error: "POD image not found.", code: "image_not_found" },
      { status: 404 },
    );
  }
  return new Response(image.body, {
    headers: {
      "Content-Type": image.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
