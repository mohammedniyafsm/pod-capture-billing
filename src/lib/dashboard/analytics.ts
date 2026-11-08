export type DashboardRange = "7d" | "30d" | "6m" | "12m";
export type DashboardGranularity = "day" | "month";

export type DashboardTimeBucket = {
  period: string;
  label: string;
  delivered: number;
  podReceived: number;
  invoicedCount: number;
  podToInvoiceSampleSize: number;
  within24hCount: number;
  within24hEligible: number;
  avgPodToInvoiceDays: number | null;
};

export type DashboardEventTrip = {
  deliveredAt: Date | null;
  podReceivedAt: Date | null;
  invoicedAt: Date | null;
};

export type DashboardEventSummary = {
  deliveredCount: number;
  podReceivedCount: number;
  invoicedCount: number;
  avgPodToInvoiceDays: number | null;
  podToInvoiceSampleSize: number;
  podWithin24Hours: {
    eligible: number;
    count: number;
    percentage: number | null;
  };
};

export type PodAgeBucket = "0-3" | "4-10" | "over10";

const DAY_MS = 24 * 60 * 60 * 1000;
const KOLKATA_OFFSET_MS = 330 * 60 * 1000;

function kolkataDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((item) => item.type === type)?.value;
    if (!value) throw new Error(`Could not determine ${type} in Asia/Kolkata.`);
    return Number(value);
  };
  return { year: part("year"), month: part("month"), day: part("day") };
}

function kolkataMidnight(year: number, month: number, day: number) {
  return new Date(
    Date.UTC(year, month - 1, day) - KOLKATA_OFFSET_MS,
  );
}

function periodFor(date: Date, granularity: DashboardGranularity) {
  const { year, month, day } = kolkataDateParts(date);
  return granularity === "day"
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : `${year}-${String(month).padStart(2, "0")}`;
}

export function dashboardPeriod(
  date: Date,
  granularity: DashboardGranularity,
) {
  return periodFor(date, granularity);
}

function periodLabel(period: string, granularity: DashboardGranularity) {
  const [year, month, day] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day ?? 15, 12));
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(granularity === "day"
      ? { day: "numeric", month: "short" }
      : { month: "short", year: "numeric" }),
  }).format(date);
}

export function getDashboardWindow(range: DashboardRange, now = new Date()) {
  const { year, month, day } = kolkataDateParts(now);
  if (range === "7d" || range === "30d") {
    const dayCount = range === "7d" ? 7 : 30;
    const start = new Date(Date.UTC(year, month - 1, day - dayCount + 1));
    return {
      from: kolkataMidnight(
        start.getUTCFullYear(),
        start.getUTCMonth() + 1,
        start.getUTCDate(),
      ),
      to: now,
      granularity: "day" as const,
    };
  }

  const monthCount = range === "6m" ? 6 : 12;
  const startMonth = year * 12 + month - monthCount;
  const startYear = Math.floor(startMonth / 12);
  const startMonthOfYear = (startMonth % 12) + 1;
  return {
    from: kolkataMidnight(startYear, startMonthOfYear, 1),
    to: now,
    granularity: "month" as const,
  };
}

export function createDashboardSeries(
  range: DashboardRange,
  from: Date,
  to: Date,
): DashboardTimeBucket[] {
  const granularity: DashboardGranularity =
    range === "7d" || range === "30d" ? "day" : "month";
  const periods: string[] = [];

  if (granularity === "day") {
    const fromParts = kolkataDateParts(from);
    const toParts = kolkataDateParts(to);
    const start = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
    const end = Date.UTC(toParts.year, toParts.month - 1, toParts.day);
    for (let cursor = start; cursor <= end; cursor += DAY_MS) {
      const date = new Date(cursor);
      periods.push(
        `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      );
    }
  } else {
    const fromParts = kolkataDateParts(from);
    const toParts = kolkataDateParts(to);
    let year = fromParts.year;
    let month = fromParts.month;
    while (year < toParts.year || (year === toParts.year && month <= toParts.month)) {
      periods.push(`${year}-${String(month).padStart(2, "0")}`);
      month += 1;
      if (month === 13) {
        year += 1;
        month = 1;
      }
    }
  }

  return periods.map((period) => ({
    period,
    label: periodLabel(period, granularity),
    delivered: 0,
    podReceived: 0,
    invoicedCount: 0,
    podToInvoiceSampleSize: 0,
    within24hCount: 0,
    within24hEligible: 0,
    avgPodToInvoiceDays: null,
  }));
}

export function isWithinDashboardWindow(
  value: Date | null,
  from: Date,
  to: Date,
) {
  return value !== null && value >= from && value <= to;
}

export function daysBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / DAY_MS;
}

export function getPodAgeBucket(ageDays: number): PodAgeBucket {
  if (ageDays <= 3) return "0-3";
  if (ageDays <= 10) return "4-10";
  return "over10";
}

export function aggregateDashboardEvents(
  trips: readonly DashboardEventTrip[],
  range: DashboardRange,
  from: Date,
  to: Date,
  granularity: DashboardGranularity,
) {
  const series = createDashboardSeries(range, from, to);
  const bucketsByPeriod = new Map(
    series.map((bucket) => [bucket.period, bucket]),
  );
  const invoiceStatsByPeriod = new Map<
    string,
    { totalDays: number; sampleSize: number }
  >();
  let deliveredCount = 0;
  let podReceivedCount = 0;
  let invoicedCount = 0;
  let onTimePodCount = 0;
  let podWithin24HoursEligible = 0;
  let podToInvoiceTotalDays = 0;
  let podToInvoiceSampleSize = 0;

  for (const trip of trips) {
    const deliveredAt = trip.deliveredAt;
    if (deliveredAt && isWithinDashboardWindow(deliveredAt, from, to)) {
      const period = dashboardPeriod(deliveredAt, granularity);
      const bucket = bucketsByPeriod.get(period);
      if (bucket) {
        bucket.delivered += 1;
        deliveredCount += 1;
      }
    }

    const receivedAt = trip.podReceivedAt;
    if (receivedAt && isWithinDashboardWindow(receivedAt, from, to)) {
      const bucket = bucketsByPeriod.get(dashboardPeriod(receivedAt, granularity));
      if (bucket) {
        bucket.podReceived += 1;
        podReceivedCount += 1;
        if (trip.deliveredAt) {
          bucket.within24hEligible += 1;
          podWithin24HoursEligible += 1;
          const hours = (receivedAt.getTime() - trip.deliveredAt.getTime()) /
            (60 * 60 * 1000);
          if (hours >= 0 && hours <= 24) {
            bucket.within24hCount += 1;
            onTimePodCount += 1;
          }
        }
      }
    }

    const invoicedAt = trip.invoicedAt;
    if (invoicedAt && isWithinDashboardWindow(invoicedAt, from, to)) {
      const bucket = bucketsByPeriod.get(dashboardPeriod(invoicedAt, granularity));
      if (bucket) {
        bucket.invoicedCount += 1;
        invoicedCount += 1;
        if (trip.podReceivedAt && invoicedAt >= trip.podReceivedAt) {
          const durationDays = daysBetween(trip.podReceivedAt, invoicedAt);
          podToInvoiceTotalDays += durationDays;
          podToInvoiceSampleSize += 1;
          bucket.podToInvoiceSampleSize += 1;
          const stats = invoiceStatsByPeriod.get(bucket.period) ?? {
            totalDays: 0,
            sampleSize: 0,
          };
          stats.totalDays += durationDays;
          stats.sampleSize += 1;
          invoiceStatsByPeriod.set(bucket.period, stats);
        }
      }
    }
  }

  for (const bucket of series) {
    const stats = invoiceStatsByPeriod.get(bucket.period);
    bucket.avgPodToInvoiceDays =
      stats && stats.sampleSize > 0
        ? stats.totalDays / stats.sampleSize
        : null;
  }

  return {
    series,
    summary: {
      deliveredCount,
      podReceivedCount,
      invoicedCount,
      avgPodToInvoiceDays:
        podToInvoiceSampleSize === 0
          ? null
          : podToInvoiceTotalDays / podToInvoiceSampleSize,
      podToInvoiceSampleSize,
      podWithin24Hours: {
        eligible: podWithin24HoursEligible,
        count: onTimePodCount,
        percentage:
          podWithin24HoursEligible === 0
            ? null
            : (onTimePodCount / podWithin24HoursEligible) * 100,
      },
    } satisfies DashboardEventSummary,
  };
}
