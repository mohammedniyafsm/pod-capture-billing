import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { createPodImageToken, POD_IMAGE_URL_TTL_SECONDS } from "../../../../src/lib/pods/storage/imageUrl";
import { deriveUploadLinkStatus } from "../../../../src/lib/pods/links/uploadLinks";
import { prisma } from "../../../../src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const tripIdSchema = z.uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!tripIdSchema.safeParse(id).success) {
    return Response.json(
      { error: "Trip ID is invalid.", code: "validation_error" },
      { status: 400 },
    );
  }

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          billingCycle: true,
          tallyLedgerName: true,
        },
      },
      branch: { select: { id: true, name: true } },
      vehicle: { select: { vehicleNo: true, isHired: true } },
      driver: { select: { id: true, name: true, phone: true } },
      podSubmissions: {
        orderBy: { attemptNo: "asc" },
        include: { extraction: true },
      },
      uploadLinks: {
        orderBy: { expiresAt: "desc" },
        take: 1,
        include: {
          submission: { select: { id: true } },
        },
      },
    },
  });

  if (!trip) {
    return Response.json(
      { error: "Trip not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }

  // Pre-sign image URLs for POD submissions
  const submissionsWithUrls = await Promise.all(
    trip.podSubmissions.map(async (submission) => ({
      ...submission,
      imageUrl: await createPodImageToken(submission.id).then((token: string) => {
        const url = new URL(
          `/api/pods/${encodeURIComponent(submission.id)}/image?token=${encodeURIComponent(token)}`,
          request.url,
        );
        return {
          url: url.toString(),
          expiresInSeconds: POD_IMAGE_URL_TTL_SECONDS,
        };
      }),
    })),
  );

  const latestUploadLink = trip.uploadLinks[0] ?? null;
  const uploadLinkStatus = deriveUploadLinkStatus(latestUploadLink);

  return Response.json({
    trip: {
      ...trip,
      freight: Number(trip.freight),
      expectedQuantity: Number(trip.expectedQuantity),
      deliveredQuantity:
        trip.deliveredQuantity !== null
          ? Number(trip.deliveredQuantity)
          : null,
      podSubmissions: submissionsWithUrls,
      uploadLink: latestUploadLink
        ? {
            id: latestUploadLink.id,
            status: uploadLinkStatus,
            expiresAt: latestUploadLink.expiresAt.toISOString(),
            usedAt: latestUploadLink.usedAt
              ? latestUploadLink.usedAt.toISOString()
              : null,
          }
        : {
            status: "NOT_GENERATED",
            expiresAt: null,
            usedAt: null,
          },
    },
  });
}
