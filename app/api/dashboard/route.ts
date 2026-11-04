import { TripStatus, UserRole } from "@prisma/client";
import { requireRole } from "@/src/lib/auth/requireRole";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const DAY_MS = 24 * 60 * 60 * 1000;
const INVOICE_TARGET_DAYS = 4;

function daysBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / DAY_MS;
}

export async function GET(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const [branches, trips] = await Promise.all([
    prisma.branch.findMany({
      select: {
        id: true,
        name: true,
        trips: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            deliveredAt: true,
            podReceivedAt: true,
            invoicedAt: true,
            podSubmissions: { select: { id: true }, take: 1 },
          },
        },
      },
    }),
    prisma.trip.findMany({
      where: {
        status: {
          in: [
            TripStatus.ASSIGNED,
            TripStatus.IN_TRANSIT,
            TripStatus.POD_PENDING,
            TripStatus.RETAKE_REQUESTED,
            TripStatus.UNASSIGNED,
          ],
        },
        podSubmissions: { none: {} },
      },
      select: {
        id: true,
        tripCode: true,
        status: true,
        createdAt: true,
        deliveredAt: true,
        branch: { select: { id: true, name: true } },
      },
    }),
  ]);

  const now = new Date();
  const ageingByBranch = new Map<
    string,
    {
      branchId: string;
      branch: string;
      total: number;
      buckets: { "0-3": number; "4-10": number; "10+": number };
      trips: Array<{
        id: string;
        tripCode: string;
        status: TripStatus;
        ageDays: number;
      }>;
    }
  >();

  for (const trip of trips) {
    const ageDays = Math.max(
      0,
      Math.floor(daysBetween(trip.deliveredAt ?? trip.createdAt, now)),
    );
    const current = ageingByBranch.get(trip.branch.id) ?? {
      branchId: trip.branch.id,
      branch: trip.branch.name,
      total: 0,
      buckets: { "0-3": 0, "4-10": 0, "10+": 0 },
      trips: [],
    };
    current.total += 1;
    if (ageDays <= 3) current.buckets["0-3"] += 1;
    else if (ageDays <= 10) current.buckets["4-10"] += 1;
    else current.buckets["10+"] += 1;
    current.trips.push({
      id: trip.id,
      tripCode: trip.tripCode,
      status: trip.status,
      ageDays,
    });
    ageingByBranch.set(trip.branch.id, current);
  }

  const byBranch = branches.map((branch) => {
    const invoiceDurations = branch.trips
      .filter(
        (trip) =>
          trip.podReceivedAt !== null &&
          trip.invoicedAt !== null &&
          trip.invoicedAt >= trip.podReceivedAt,
      )
      .map((trip) => daysBetween(trip.podReceivedAt!, trip.invoicedAt!));
    const avgPodToInvoiceDays =
      invoiceDurations.length === 0
        ? null
        : invoiceDurations.reduce((total, days) => total + days, 0) /
          invoiceDurations.length;
    return {
      branchId: branch.id,
      branch: branch.name,
      avgPodToInvoiceDays,
      invoiceTargetDays: INVOICE_TARGET_DAYS,
      withinTarget:
        avgPodToInvoiceDays === null
          ? null
          : avgPodToInvoiceDays <= INVOICE_TARGET_DAYS,
      tripsWithoutPod: ageingByBranch.get(branch.id) ?? {
        branchId: branch.id,
        branch: branch.name,
        total: 0,
        buckets: { "0-3": 0, "4-10": 0, "10+": 0 },
        trips: [],
      },
    };
  });

  const deliveredTrips = branches.flatMap((branch) => branch.trips).filter(
    (trip) => trip.deliveredAt !== null && trip.podReceivedAt !== null,
  );
  const within24Hours = deliveredTrips.filter(
    (trip) => {
      const elapsed = daysBetween(trip.deliveredAt!, trip.podReceivedAt!);
      return elapsed >= 0 && elapsed <= 1;
    },
  ).length;

  return Response.json({
    byBranch,
    podWithin24Hours: {
      eligible: deliveredTrips.length,
      count: within24Hours,
      percentage:
        deliveredTrips.length === 0
          ? null
          : (within24Hours / deliveredTrips.length) * 100,
    },
  });
}
