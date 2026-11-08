import { TripStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/requireRole";
import {
  aggregateDashboardEvents,
  daysBetween,
  getPodAgeBucket,
  getDashboardWindow,
  isWithinDashboardWindow,
  type DashboardRange,
} from "@/src/lib/dashboard/analytics";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const INVOICE_TARGET_DAYS = 4;
const POD_WITHIN_24_HOURS_TARGET_PERCENTAGE = 80;
const dashboardQuerySchema = z.object({
  range: z.enum(["7d", "30d", "6m", "12m"]).default("30d"),
  branch: z.string().trim().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = dashboardQuerySchema.safeParse({
    range: url.searchParams.get("range") ?? undefined,
    branch: url.searchParams.get("branch") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Dashboard filters are invalid.", code: "validation_error" },
      { status: 400 },
    );
  }

  const { range, branch } = parsed.data;
  const branchFilter = branch
    ? {
      OR: [
        { branchId: branch },
        { branch: { name: { equals: branch, mode: "insensitive" as const } } },
      ],
    }
    : {};
  const now = new Date();
  const { from, to, granularity } = getDashboardWindow(
    range as DashboardRange,
    now,
  );
  const inWindow = { gte: from, lte: to };

  const [branches, missingPodTrips, statusGroups, windowTrips] =
    await Promise.all([
      prisma.branch.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.trip.findMany({
        where: {
          ...branchFilter,
          status: TripStatus.POD_PENDING,
          deliveredAt: { not: null },
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
      prisma.trip.groupBy({
        by: ["status"],
        where: branchFilter,
        _count: { _all: true },
      }),
      prisma.trip.findMany({
        where: {
          ...branchFilter,
          OR: [
            { deliveredAt: inWindow },
            { podReceivedAt: inWindow },
            { invoicedAt: inWindow },
          ],
        },
        select: {
          branchId: true,
          deliveredAt: true,
          podReceivedAt: true,
          invoicedAt: true,
        },
      }),
    ]);

  const selectedBranches = branch
    ? branches.filter(
      (item) =>
        item.id === branch ||
        item.name.toLocaleLowerCase() === branch.toLocaleLowerCase(),
    )
    : branches;
  const ageingByBranch = new Map<
    string,
    {
      branchId: string;
      branch: string;
      total: number;
      buckets: { "0-3": number; "4-10": number; over10: number };
      trips: Array<{
        id: string;
        tripCode: string;
        status: TripStatus;
        ageDays: number;
      }>;
    }
  >();

  for (const trip of missingPodTrips) {
    const ageDays = Math.max(
      0,
      Math.floor(daysBetween(trip.deliveredAt ?? trip.createdAt, now)),
    );
    const current = ageingByBranch.get(trip.branch.id) ?? {
      branchId: trip.branch.id,
      branch: trip.branch.name,
      total: 0,
      buckets: { "0-3": 0, "4-10": 0, over10: 0 },
      trips: [],
    };
    current.total += 1;
    current.buckets[getPodAgeBucket(ageDays)] += 1;
    current.trips.push({
      id: trip.id,
      tripCode: trip.tripCode,
      status: trip.status,
      ageDays,
    });
    ageingByBranch.set(trip.branch.id, current);
  }

  const emptyAgeing = (branchId: string, name: string) => ({
    branchId,
    branch: name,
    total: 0,
    buckets: { "0-3": 0, "4-10": 0, over10: 0 },
    trips: [],
  });
  const byBranch = selectedBranches.map((item) => {
    const invoiceDurations = windowTrips
      .filter(
        (trip) =>
          trip.branchId === item.id &&
          isWithinDashboardWindow(trip.invoicedAt, from, to) &&
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
      branchId: item.id,
      branch: item.name,
      avgPodToInvoiceDays,
      invoiceTargetDays: INVOICE_TARGET_DAYS,
      withinTarget:
        avgPodToInvoiceDays === null
          ? null
          : avgPodToInvoiceDays <= INVOICE_TARGET_DAYS,
      tripsWithoutPod: ageingByBranch.get(item.id) ?? emptyAgeing(item.id, item.name),
    };
  });

  const eventMetrics = aggregateDashboardEvents(
    windowTrips,
    range as DashboardRange,
    from,
    to,
    granularity,
  );

  const statusCounts = Object.fromEntries(
    Object.values(TripStatus).map((status) => [status, 0]),
  ) as Record<TripStatus, number>;
  for (const group of statusGroups) {
    statusCounts[group.status] = group._count._all;
  }

  return Response.json({
    range,
    branch: branch ?? null,
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: "Asia/Kolkata",
    granularity,
    branches,
    statusCounts,
    series: eventMetrics.series,
    summary: {
      ...eventMetrics.summary,
      invoiceTargetDays: INVOICE_TARGET_DAYS,
      podWithin24Hours: {
        ...eventMetrics.summary.podWithin24Hours,
        targetPercentage: POD_WITHIN_24_HOURS_TARGET_PERCENTAGE,
      },
    },
    byBranch,
  });
}
