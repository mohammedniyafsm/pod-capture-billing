import { TripStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { createUploadLinkInTransaction } from "../../../../../src/lib/pods/links/uploadLinks";
import { prisma } from "../../../../../src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const tripIdSchema = z.uuid();

export async function POST(
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
    select: {
      id: true,
      tripCode: true,
      isHired: true,
      status: true,
    },
  });

  if (!trip) {
    return Response.json(
      { error: "Trip not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }

  if (!trip.isHired) {
    return Response.json(
      {
        error: "Upload links can only be generated for hired-vehicle trips.",
        code: "not_hired_trip",
      },
      { status: 400 },
    );
  }

  // Verify trip is eligible to receive a POD
  const eligibleStatuses: TripStatus[] = [
    TripStatus.ASSIGNED,
    TripStatus.IN_TRANSIT,
    TripStatus.POD_PENDING,
    TripStatus.RETAKE_REQUESTED,
    TripStatus.UNASSIGNED,
  ];

  if (!eligibleStatuses.includes(trip.status)) {
    return Response.json(
      {
        error: `Cannot generate upload link for a trip in ${trip.status} status.`,
        code: "trip_not_eligible_for_pod",
      },
      { status: 400 },
    );
  }

  const now = new Date();

  // Atomically serialize link generation for this trip using Prisma transaction with lock.
  // In PostgreSQL, SELECT ... FOR UPDATE or updating the trip row serializes concurrent transactions on the same trip.
  const linkResult = await prisma.$transaction(async (tx) => {
    // 1. Lock the trip row so concurrent link generation requests for the same trip must wait
    // and execute sequentially rather than concurrently inserting active links.
    await tx.trip.update({
      where: { id: trip.id },
      data: { updatedAt: now },
    });

    // 2. Invalidate existing active links for this trip
    await tx.uploadLink.updateMany({
      where: {
        tripId: trip.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        usedAt: now, // mark as revoked
      },
    });

    // 3. Create the new link
    const newLink = await createUploadLinkInTransaction(tx, trip.id);

    // 4. Record audit log
    await tx.auditLog.create({
      data: {
        userId: auth.session.userId,
        action: "UPLOAD_LINK_GENERATED",
        entity: "Trip",
        entityId: trip.id,
      },
    });

    return newLink;
  });

  // Construct public driver page URL
  const uploadUrl = new URL(`/upload/${linkResult.token}`, request.url).toString();

  return Response.json({
    success: true,
    message: "Hired driver POD upload link generated successfully.",
    link: {
      id: linkResult.id,
      uploadUrl,
      expiresAt: linkResult.expiresAt.toISOString(),
    },
  });
}

