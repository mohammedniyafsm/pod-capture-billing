import { describe, expect, it } from "vitest";
import {
  aggregateBranchPodToInvoice,
  calculateMedian,
  calculatePodToInvoiceDays,
} from "./metrics";

describe("calculatePodToInvoiceDays", () => {
  it("computes normal positive latency in days rounded to one decimal place", () => {
    const podDate = new Date("2026-11-01T10:00:00Z");
    const invDate = new Date("2026-11-05T22:00:00Z"); // 4.5 days
    const result = calculatePodToInvoiceDays(podDate, invDate);
    expect(result).toBe(4.5);
  });

  it("handles same day invoice (0.0 days if exact, or fractional)", () => {
    const podDate = new Date("2026-11-01T10:00:00Z");
    const invDate = new Date("2026-11-01T10:00:00Z");
    expect(calculatePodToInvoiceDays(podDate, invDate)).toBe(0);

    const invLaterSameDay = new Date("2026-11-01T22:00:00Z"); // 12 hours = 0.5 days
    expect(calculatePodToInvoiceDays(podDate, invLaterSameDay)).toBe(0.5);
  });

  it("returns null when either podReceivedAt or invoicedAt is missing", () => {
    expect(calculatePodToInvoiceDays(null, new Date())).toBeNull();
    expect(calculatePodToInvoiceDays(new Date(), null)).toBeNull();
    expect(calculatePodToInvoiceDays(undefined, undefined)).toBeNull();
  });

  it("throws an error when invoice date is chronologically before POD date", () => {
    const podDate = new Date("2026-11-05T10:00:00Z");
    const invDate = new Date("2026-11-01T10:00:00Z");
    expect(() => calculatePodToInvoiceDays(podDate, invDate)).toThrow(
      "Invoice date cannot be earlier than POD received date.",
    );
  });
});

describe("calculateMedian", () => {
  it("calculates median for odd and even lists", () => {
    expect(calculateMedian([2, 4, 6])).toBe(4);
    expect(calculateMedian([2, 4, 6, 8])).toBe(5);
    expect(calculateMedian([])).toBeNull();
  });
});

describe("aggregateBranchPodToInvoice", () => {
  it("aggregates per-branch metrics, excluding un-invoiced trips from average, never counting them as 0", () => {
    const branches = [
      { id: "b1", name: "Pune" },
      { id: "b2", name: "Nagpur" },
    ];

    const trips = [
      // Branch 1: 2 invoiced (3 days and 5 days), 1 pending
      {
        branchId: "b1",
        podReceivedAt: "2026-11-01T00:00:00Z",
        invoicedAt: "2026-11-04T00:00:00Z", // 3.0 days
      },
      {
        branchId: "b1",
        podReceivedAt: "2026-11-01T00:00:00Z",
        invoicedAt: "2026-11-06T00:00:00Z", // 5.0 days
      },
      {
        branchId: "b1",
        podReceivedAt: "2026-11-05T00:00:00Z",
        invoicedAt: null, // pending
      },
      // Branch 2: no invoiced trips, 2 pending
      {
        branchId: "b2",
        podReceivedAt: "2026-11-02T00:00:00Z",
        invoicedAt: null,
      },
      {
        branchId: "b2",
        podReceivedAt: null,
        invoicedAt: null,
      },
    ];

    const result = aggregateBranchPodToInvoice(trips, branches);

    // Nagpur
    const nagpur = result.find((r) => r.branchName === "Nagpur");
    expect(nagpur).toBeDefined();
    expect(nagpur?.averageDays).toBeNull();
    expect(nagpur?.medianDays).toBeNull();
    expect(nagpur?.invoicedCount).toBe(0);
    expect(nagpur?.pendingCount).toBe(2);

    // Pune: avg = (3 + 5) / 2 = 4.0; median = 4.0; 2 invoiced, 1 pending
    const pune = result.find((r) => r.branchName === "Pune");
    expect(pune).toBeDefined();
    expect(pune?.averageDays).toBe(4);
    expect(pune?.medianDays).toBe(4);
    expect(pune?.invoicedCount).toBe(2);
    expect(pune?.pendingCount).toBe(1);
  });
});

