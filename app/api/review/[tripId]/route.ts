import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/requireRole";
import { createPodImageToken, POD_IMAGE_URL_TTL_SECONDS } from "@/src/lib/pods/imageUrl";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const tripIdSchema = z.uuid();

function maskPhone(phone: string | null) {
  if (!phone) return null;
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const { tripId } = await context.params;
  if (!tripIdSchema.safeParse(tripId).success) {
    return Response.json(
      { error: "Trip ID is invalid.", code: "validation_error" },
      { status: 400 },
    );
  }
  const unmask = new URL(request.url).searchParams.get("unmask") === "true";
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      branch: { select: { id: true, name: true } },
      client: { select: { id: true, name: true, billingCycle: true, tallyLedgerName: true } },
      vehicle: { select: { vehicleNo: true, isHired: true } },
      driver: { select: { id: true, name: true, phone: true } },
      podSubmissions: {
        orderBy: { attemptNo: "asc" },
        include: { extraction: true },
      },
      reviewActions: {
        orderBy: { at: "asc" },
        include: { reviewer: { select: { id: true, name: true } } },
      },
    },
  });
  if (!trip) {
    return Response.json(
      { error: "Trip not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }

  if (unmask) {
    await prisma.auditLog.create({
      data: {
        userId: auth.session.userId,
        action: "CONSIGNEE_PHONE_UNMASKED",
        entity: "Trip",
        entityId: trip.id,
      },
    });
  }

  const submissions = await Promise.all(
    trip.podSubmissions.map(async (submission) => ({
      ...submission,
      imageUrl: await createPodImageToken(submission.id).then((token) => {
        const url = new URL(
          `/api/pods/${encodeURIComponent(submission.id)}/image?token=${encodeURIComponent(token)}`,
          request.url,
        );
        return { url: url.toString(), expiresInSeconds: POD_IMAGE_URL_TTL_SECONDS };
      }),
    })),
  );

  return Response.json({
    trip: {
      ...trip,
      consigneePhone: unmask ? trip.consigneePhone : maskPhone(trip.consigneePhone),
      driver: trip.driver
        ? { ...trip.driver, phone: unmask ? trip.driver.phone : maskPhone(trip.driver.phone) }
        : null,
      podSubmissions: submissions,
    },
    history: trip.reviewActions,
  });
}
