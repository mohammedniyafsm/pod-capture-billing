import { quantityUnitsMatch } from "../verdict";

export type ReviewFieldChanges = Record<
  string,
  { before: unknown; after: unknown }
>;

export type ReviewCorrectionResult =
  | {
      ok: true;
      fieldChanges: ReviewFieldChanges;
      deliveredQuantity: number | null;
    }
  | {
      ok: false;
      code: "quantity_unit_required" | "quantity_unit_mismatch";
    };

export function buildReviewCorrection(
  aiFields: Readonly<Record<string, unknown>>,
  corrections: Readonly<Record<string, unknown>>,
  expectedUnit: string,
  previousDeliveredQuantity: string | null,
): ReviewCorrectionResult {
  const fieldChanges: ReviewFieldChanges = {};
  for (const [field, value] of Object.entries(corrections)) {
    fieldChanges[field] = {
      before: aiFields[field] ?? null,
      after: value,
    };
  }

  const quantity = corrections.quantity_received;
  if (typeof quantity !== "number") {
    return { ok: true, fieldChanges, deliveredQuantity: null };
  }

  const unit = corrections.quantity_unit;
  if (typeof unit !== "string") {
    return { ok: false, code: "quantity_unit_required" };
  }
  if (!quantityUnitsMatch(expectedUnit, unit)) {
    return { ok: false, code: "quantity_unit_mismatch" };
  }

  fieldChanges.deliveredQuantity = {
    before: previousDeliveredQuantity,
    after: quantity,
  };
  return { ok: true, fieldChanges, deliveredQuantity: quantity };
}
