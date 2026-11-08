import { TripStatus } from "@prisma/client";
import { getBillingWindow } from "../cycle/cycle";

export interface BillingQueueTrip {
  id: string;
  status: TripStatus;
  freight: number | { toString(): string };
  deliveredAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
  client: {
    id: string;
    name: string;
    billingCycle: Parameters<typeof getBillingWindow>[1];
    tallyLedgerName: string;
  };
}

export function getNonVerifiedTripIds(
  trips: readonly { id: string; status: TripStatus }[],
): string[] {
  return trips
    .filter((trip) => trip.status !== TripStatus.VERIFIED)
    .map((trip) => trip.id);
}

export function groupBillingQueueTrips<T extends BillingQueueTrip>(
  trips: readonly T[],
) {
  const groups = new Map<
    string,
    {
      client: T["client"];
      cycleLabel: string;
      windowStart: Date;
      windowEnd: Date;
      count: number;
      totalAmount: number;
      trips: T[];
    }
  >();

  for (const trip of trips) {
    const anchorDate = trip.deliveredAt ?? trip.verifiedAt ?? trip.createdAt;
    const window = getBillingWindow(anchorDate, trip.client.billingCycle);
    const key = `${trip.client.id}:${window.label}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.totalAmount += Number(trip.freight);
      group.trips.push(trip);
    } else {
      groups.set(key, {
        client: trip.client,
        cycleLabel: window.label,
        windowStart: window.start,
        windowEnd: window.end,
        count: 1,
        totalAmount: Number(trip.freight),
        trips: [trip],
      });
    }
  }
  return [...groups.values()];
}
