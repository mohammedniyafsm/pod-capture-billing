/**
 * Pure calculation functions for metrics and analytics.
 */

export type TripMetricRecord = {
  id?: string;
  branchId: string;
  branchName?: string;
  podReceivedAt: Date | string | null;
  invoicedAt: Date | string | null;
  status?: string;
};

export type BranchPodToInvoiceMetric = {
  branchId: string;
  branchName: string;
  averageDays: number | null;
  medianDays: number | null;
  invoicedCount: number;
  pendingCount: number;
};

/**
 * Calculates the difference between invoicedAt and podReceivedAt in fractional days rounded to one decimal place.
 * Returns null if either date is missing.
 * Throws an Error if invoicedAt is chronologically before podReceivedAt.
 */
export function calculatePodToInvoiceDays(
  podReceivedAt: Date | string | null | undefined,
  invoicedAt: Date | string | null | undefined,
): number | null {
  if (!podReceivedAt || !invoicedAt) {
    return null;
  }

  const podDate = new Date(podReceivedAt);
  const invDate = new Date(invoicedAt);

  if (Number.isNaN(podDate.getTime()) || Number.isNaN(invDate.getTime())) {
    return null;
  }

  const diffMs = invDate.getTime() - podDate.getTime();
  if (diffMs < 0) {
    throw new Error("Invoice date cannot be earlier than POD received date.");
  }

  // Fractional days rounded to 1 decimal place
  const days = diffMs / (1000 * 60 * 60 * 24);
  return Math.round(days * 10) / 10;
}

/**
 * Calculates median from an array of numbers.
 * Assumes numbers array is non-empty; returns null if empty.
 */
export function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return Math.round(sorted[mid] * 10) / 10;
  }
  const median = (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median * 10) / 10;
}

/**
 * Aggregates POD-to-invoice latency metrics grouped by branch.
 * - Trips without invoicedAt are EXCLUDED from the average and median calculations,
 *   never counted as 0, but tracked in `pendingCount`.
 * - Trips with both dates have their days calculated and included.
 */
export function aggregateBranchPodToInvoice(
  trips: TripMetricRecord[],
  branches: Array<{ id: string; name: string }>,
): BranchPodToInvoiceMetric[] {
  const branchMap = new Map<
    string,
    {
      branchName: string;
      daysList: number[];
      pendingCount: number;
    }
  >();

  for (const b of branches) {
    branchMap.set(b.id, {
      branchName: b.name,
      daysList: [],
      pendingCount: 0,
    });
  }

  for (const trip of trips) {
    let entry = branchMap.get(trip.branchId);
    if (!entry) {
      entry = {
        branchName: trip.branchName ?? trip.branchId,
        daysList: [],
        pendingCount: 0,
      };
      branchMap.set(trip.branchId, entry);
    }

    if (trip.podReceivedAt && trip.invoicedAt) {
      try {
        const days = calculatePodToInvoiceDays(trip.podReceivedAt, trip.invoicedAt);
        if (days !== null) {
          entry.daysList.push(days);
        }
      } catch {
        // Skip invalid chronology
      }
    } else {
      // Uninvoiced or awaiting invoice
      entry.pendingCount += 1;
    }
  }

  const results: BranchPodToInvoiceMetric[] = [];
  for (const [branchId, data] of branchMap.entries()) {
    const { branchName, daysList, pendingCount } = data;
    const invoicedCount = daysList.length;

    let averageDays: number | null = null;
    let medianDays: number | null = null;

    if (invoicedCount > 0) {
      const sum = daysList.reduce((acc, v) => acc + v, 0);
      averageDays = Math.round((sum / invoicedCount) * 10) / 10;
      medianDays = calculateMedian(daysList);
    }

    results.push({
      branchId,
      branchName,
      averageDays,
      medianDays,
      invoicedCount,
      pendingCount,
    });
  }

  // Return sorted by branch name
  return results.sort((a, b) => a.branchName.localeCompare(b.branchName));
}

