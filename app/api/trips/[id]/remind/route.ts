import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { prisma } from "@/src/lib/prisma";

const requireTripUser = requireRole([UserRole.DRIVER, UserRole.BILLING_EXEC]);
const tripIdSchema = z.uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTripUser(request);
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
    include: { driver: { select: { phone: true, role: true } } },
  });
  if (!trip) {
    return Response.json(
      { error: "Trip not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }
  if (
    auth.session.role === UserRole.DRIVER &&
    trip.driverId !== auth.session.userId
  ) {
    return Response.json(
      { error: "Trip not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }
  const phone =
    trip.driverPhone ??
    (trip.driver?.role === UserRole.DRIVER ? trip.driver.phone : null);
  if (!phone) {
    return Response.json(
      { error: "Trip has no driver phone for an SMS reminder.", code: "phone_unavailable" },
      { status: 409 },
    );
  }

  const result = await prisma.$transaction(async (transaction) => {
    const message = await transaction.smsOutbox.create({
      data: {
        toPhone: phone,
        tripId: trip.id,
        body: `Reminder: please submit the proof of delivery for trip ${trip.tripCode}.`,
      },
    });
    await transaction.auditLog.create({
      data: {
        userId: auth.session.userId,
        action: "TRIP_REMINDER_QUEUED",
        entity: "Trip",
        entityId: trip.id,
      },
    });
    return message;
  });

  return Response.json({ queued: true, messageId: result.id }, { status: 202 });
}
