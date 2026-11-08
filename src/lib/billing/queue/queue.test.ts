import { BillingCycle, TripStatus, type BillingCycle as BillingCycleType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getNonVerifiedTripIds,
  groupBillingQueueTrips,
  type BillingQueueTrip,
} from "./queue";

const client: {
  id: string;
  name: string;
  billingCycle: BillingCycleType;
  tallyLedgerName: string;
} = {
  id: "client-1",
  name: "Company B",
  billingCycle: BillingCycle.FORTNIGHTLY,
  tallyLedgerName: "Company B - Cement",
};

function trip(
  id: string,
  freight: number,
  deliveredAt: string,
  clientInfo = client,
): BillingQueueTrip {
  return {
    id,
    status: TripStatus.VERIFIED,
    freight,
    deliveredAt: new Date(`${deliveredAt}T12:00:00.000Z`),
    verifiedAt: null,
    createdAt: new Date(`${deliveredAt}T12:00:00.000Z`),
    client: clientInfo,
  };
}

describe("billing queue grouping", () => {
  it("groups trips by client and billing window with counts and totals", () => {
    const laterClient = {
      ...client,
      id: "client-2",
      name: "Company C",
      billingCycle: BillingCycle.MONTHLY,
    };
    const groups = groupBillingQueueTrips([
      trip("trip-1", 1250.5, "2026-11-02"),
      trip("trip-2", 750, "2026-11-15"),
      trip("trip-3", 100, "2026-11-16"),
      trip("trip-4", 300, "2026-11-16", laterClient),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups).toMatchObject([
      {
        client: { id: "client-1" },
        cycleLabel: "FORTNIGHTLY-2026-11-01",
        count: 2,
        totalAmount: 2000.5,
        trips: [{ id: "trip-1" }, { id: "trip-2" }],
      },
      {
        client: { id: "client-1" },
        cycleLabel: "FORTNIGHTLY-2026-11-16",
        count: 1,
        totalAmount: 100,
      },
      {
        client: { id: "client-2" },
        cycleLabel: "MONTHLY-2026-11-01",
        count: 1,
        totalAmount: 300,
      },
    ]);
  });

  it("identifies every trip that is not VERIFIED for export rejection", () => {
    expect(
      getNonVerifiedTripIds([
        { id: "verified", status: TripStatus.VERIFIED },
        { id: "review", status: TripStatus.NEEDS_REVIEW },
        { id: "disputed", status: TripStatus.DISPUTED },
      ]),
    ).toEqual(["review", "disputed"]);
    expect(
      getNonVerifiedTripIds([{ id: "verified", status: TripStatus.VERIFIED }]),
    ).toEqual([]);
  });
});
