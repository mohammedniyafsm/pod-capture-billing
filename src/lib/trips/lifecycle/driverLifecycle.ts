import { TripStatus } from "@prisma/client";
import { prisma } from "../../prisma";

export type DriverTripTransition = "start" | "complete";

export type DriverTripTransitionResult =
  | { ok: true; status: TripStatus; timestamp: Date }
  | {
      ok: false;
      code: "trip_not_found" | "invalid_transition";
      currentStatus?: TripStatus;
    };

export async function transitionDriverTrip(
  tripId: string,
  driverId: string,
  transition: DriverTripTransition,
): Promise<DriverTripTransitionResult> {
  const timestamp = new Date();
  const expectedStatus =
    transition === "start" ? TripStatus.ASSIGNED : TripStatus.IN_TRANSIT;
  const nextStatus =
    transition === "start" ? TripStatus.IN_TRANSIT : TripStatus.POD_PENDING;

  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.trip.updateMany({
      where: { id: tripId, driverId, status: expectedStatus },
      data:
        transition === "start"
          ? { status: nextStatus, startedAt: timestamp }
          : { status: nextStatus, deliveredAt: timestamp },
    });

    if (updated.count !== 1) {
      const trip = await transaction.trip.findFirst({
        where: { id: tripId, driverId },
        select: { status: true },
      });
      return trip
        ? {
            ok: false as const,
            code: "invalid_transition" as const,
            currentStatus: trip.status,
          }
        : { ok: false as const, code: "trip_not_found" as const };
    }

    await transaction.auditLog.create({
      data: {
        userId: driverId,
        action: transition === "start" ? "TRIP_STARTED" : "TRIP_DELIVERY_COMPLETED",
        entity: "Trip",
        entityId: tripId,
      },
    });

    return { ok: true as const, status: nextStatus, timestamp };
  }, {
    maxWait: 10_000,
    timeout: 15_000,
  });
}
