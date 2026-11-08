import { describe, expect, it } from "vitest";
import {
  aggregateDashboardEvents,
  createDashboardSeries,
  getPodAgeBucket,
  getDashboardWindow,
  isWithinDashboardWindow,
} from "./analytics";

describe("dashboard analytics windows", () => {
  const now = new Date("2026-03-19T08:30:00.000Z");

  it("uses Asia/Kolkata calendar days and zero-fills the selected daily range", () => {
    const window = getDashboardWindow("7d", now);

    expect(window.from.toISOString()).toBe("2026-03-12T18:30:00.000Z");
    expect(window.to).toBe(now);
    expect(window.granularity).toBe("day");
    expect(createDashboardSeries("7d", window.from, window.to)).toHaveLength(7);
    expect(
      createDashboardSeries("7d", window.from, window.to).every(
        (bucket) =>
          bucket.delivered === 0 &&
          bucket.podReceived === 0 &&
          bucket.invoicedCount === 0 &&
          bucket.podToInvoiceSampleSize === 0 &&
          bucket.within24hCount === 0 &&
          bucket.within24hEligible === 0 &&
          bucket.avgPodToInvoiceDays === null,
      ),
    ).toBe(true);
  });

  it("includes the current month in a six-month window", () => {
    const window = getDashboardWindow("6m", now);
    const series = createDashboardSeries("6m", window.from, window.to);

    expect(window.from.toISOString()).toBe("2025-09-30T18:30:00.000Z");
    expect(window.granularity).toBe("month");
    expect(series.map((bucket) => bucket.period)).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("uses inclusive event timestamps inside the requested window", () => {
    const from = new Date("2026-03-01T00:00:00.000Z");
    const to = new Date("2026-03-31T23:59:59.999Z");

    expect(isWithinDashboardWindow(from, from, to)).toBe(true);
    expect(isWithinDashboardWindow(to, from, to)).toBe(true);
    expect(isWithinDashboardWindow(null, from, to)).toBe(false);
    expect(
      isWithinDashboardWindow(new Date("2026-04-01T00:00:00.000Z"), from, to),
    ).toBe(false);
  });

  it("counts only timestamp-paired PODs as eligible and builds per-period trend values", () => {
    const from = new Date("2026-02-28T18:30:00.000Z");
    const to = new Date("2026-03-04T18:29:59.999Z");
    const deliveredAt = new Date("2026-03-01T00:30:00.000Z");
    const onTimePodAt = new Date(deliveredAt.getTime() + 24 * 60 * 60 * 1000);
    const latePodAt = new Date(deliveredAt.getTime() + 30 * 60 * 60 * 1000);
    const noDeliveryPodAt = new Date("2026-03-02T03:30:00.000Z");
    const result = aggregateDashboardEvents(
      [
        {
          deliveredAt,
          podReceivedAt: onTimePodAt,
          invoicedAt: new Date("2026-03-03T00:30:00.000Z"),
        },
        { deliveredAt, podReceivedAt: latePodAt, invoicedAt: null },
        {
          deliveredAt: null,
          podReceivedAt: noDeliveryPodAt,
          invoicedAt: new Date("2026-03-02T05:30:00.000Z"),
        },
      ],
      "7d",
      from,
      to,
      "day",
    );
    const march2 = result.series.find((bucket) => bucket.period === "2026-03-02");
    const march3 = result.series.find((bucket) => bucket.period === "2026-03-03");

    expect(result.summary.deliveredCount).toBe(2);
    expect(result.summary.podReceivedCount).toBe(3);
    expect(result.summary.podWithin24Hours).toEqual({
      eligible: 2,
      count: 1,
      percentage: 50,
    });
    expect(march2).toMatchObject({
      podReceived: 3,
      within24hEligible: 2,
      within24hCount: 1,
      invoicedCount: 1,
      podToInvoiceSampleSize: 1,
    });
    expect(march2?.avgPodToInvoiceDays).toBeCloseTo(2 / 24);
    expect(march3).toMatchObject({
      invoicedCount: 1,
      podToInvoiceSampleSize: 1,
      avgPodToInvoiceDays: 1,
    });
    expect(result.summary.podToInvoiceSampleSize).toBe(2);
  });

  it("keeps a zero-eligible POD compliance rate null", () => {
    const from = new Date("2026-03-01T00:00:00.000Z");
    const to = new Date("2026-03-02T00:00:00.000Z");
    const result = aggregateDashboardEvents([], "7d", from, to, "day");

    expect(result.summary.podWithin24Hours).toEqual({
      eligible: 0,
      count: 0,
      percentage: null,
    });
  });

  it("keeps day 10 in the 4-10 bucket and labels only older trips over10", () => {
    expect(getPodAgeBucket(3)).toBe("0-3");
    expect(getPodAgeBucket(4)).toBe("4-10");
    expect(getPodAgeBucket(10)).toBe("4-10");
    expect(getPodAgeBucket(11)).toBe("over10");
  });
});
