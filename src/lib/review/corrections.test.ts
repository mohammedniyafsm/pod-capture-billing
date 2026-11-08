import { describe, expect, it } from "vitest";
import { buildReviewCorrection } from "./corrections";

describe("executive review corrections", () => {
  it("records confirmed quantity without mutating original AI extraction", () => {
    const aiFields = {
      quantity_received: 94,
      quantity_unit: "tons",
      remarks_text: "Short by 6 tons",
    };
    const corrections = { quantity_received: 94, quantity_unit: "tons" };

    expect(
      buildReviewCorrection(aiFields, corrections, "tons", null),
    ).toEqual({
      ok: true,
      fieldChanges: {
        quantity_received: { before: 94, after: 94 },
        quantity_unit: { before: "tons", after: "tons" },
        deliveredQuantity: { before: null, after: 94 },
      },
      deliveredQuantity: 94,
    });
    expect(aiFields).toEqual({
      quantity_received: 94,
      quantity_unit: "tons",
      remarks_text: "Short by 6 tons",
    });
  });

  it("requires a unit and rejects mismatched units for quantity confirmation", () => {
    expect(
      buildReviewCorrection(
        {},
        { quantity_received: 100 },
        "tons",
        null,
      ),
    ).toEqual({ ok: false, code: "quantity_unit_required" });
    expect(
      buildReviewCorrection(
        {},
        { quantity_received: 100, quantity_unit: "bags" },
        "tons",
        null,
      ),
    ).toEqual({ ok: false, code: "quantity_unit_mismatch" });
  });
});
