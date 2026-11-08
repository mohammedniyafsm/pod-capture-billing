import { BillingCycle } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getBillingWindow, getCycleStartForLabel } from "./cycle";

describe("billing cycle windows", () => {
  it("uses Monday-through-Monday calendar weeks", () => {
    const window = getBillingWindow(
      new Date("2026-11-04T18:00:00.000Z"),
      BillingCycle.WEEKLY,
    );
    expect(window.label).toBe("WEEKLY-2026-11-02");
    expect(window.start.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it.each([
    ["2026-11-01", "FORTNIGHTLY-2026-11-01"],
    ["2026-11-15", "FORTNIGHTLY-2026-11-01"],
    ["2026-11-16", "FORTNIGHTLY-2026-11-16"],
    ["2026-11-30", "FORTNIGHTLY-2026-11-16"],
  ])("labels fortnight window containing %s", (date, label) => {
    expect(
      getBillingWindow(new Date(`${date}T12:00:00.000Z`), BillingCycle.FORTNIGHTLY)
        .label,
    ).toBe(label);
  });

  it("uses calendar months and parses export labels", () => {
    const window = getBillingWindow(
      new Date("2026-11-30T23:59:00.000Z"),
      BillingCycle.MONTHLY,
    );
    expect(window.label).toBe("MONTHLY-2026-11-01");
    expect(getCycleStartForLabel(window.label)?.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(getCycleStartForLabel("NOT-A-CYCLE")).toBeNull();
  });
});
