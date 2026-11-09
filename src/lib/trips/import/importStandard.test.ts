import { describe, expect, it } from "vitest";
import {
  detectFormulaInjection,
  importTripRowSchema,
  normalizeHeader,
  sanitizeCsvCellValue,
  IMPORT_CSV_HEADERS,
} from "./importStandard";

const validRow = {
  trip_code: "TRIP-2026-101",
  client: "Sahyadri Cements Ltd",
  vehicle_no: "MH20 EL 4521",
  is_hired: "false",
  origin: "Pune",
  destination: "Nagpur",
  freight: "42000",
  lr_number: "LR-2026-991",
  eway_bill_no: "261199990001",
  goods: "Portland Pozzolana Cement",
  quantity: "25",
  unit: "tonnes",
  branch: "Pune",
  driver_phone: "9000000001",
};

describe("importStandard validation and CSV safety", () => {
  it("validates a standard CSV row successfully", () => {
    const parsed = importTripRowSchema.safeParse(validRow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.is_hired).toBe(false);
      expect(parsed.data.freight).toBe(42000);
      expect(parsed.data.quantity).toBe(25);
    }
  });

  it("handles is_hired truthy values ('true', 'yes', '1', 'hired')", () => {
    for (const val of ["true", "yes", "1", "hired", "True", "YES"]) {
      const parsed = importTripRowSchema.safeParse({ ...validRow, is_hired: val });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.is_hired).toBe(true);
      }
    }
  });

  it("rejects invalid e-way bill length or non-digits", () => {
    expect(
      importTripRowSchema.safeParse({ ...validRow, eway_bill_no: "12345" }).success,
    ).toBe(false);
    expect(
      importTripRowSchema.safeParse({ ...validRow, eway_bill_no: "1234567890123" }).success,
    ).toBe(false);
    expect(
      importTripRowSchema.safeParse({ ...validRow, eway_bill_no: "12345678901A" }).success,
    ).toBe(false);
  });

  it("detects and rejects formula injection cells (=, +, -, @)", () => {
    expect(detectFormulaInjection("=SUM(A1:A10)")).toBe(true);
    expect(detectFormulaInjection("@cmd|' /C calc'!A0")).toBe(true);
    expect(detectFormulaInjection("-2+3+cmd|' /C calc'!A0")).toBe(true);
    expect(detectFormulaInjection("+123")).toBe(false); // numeric signed
    expect(detectFormulaInjection("-50.5")).toBe(false); // numeric signed
    expect(detectFormulaInjection("Normal text")).toBe(false);

    // Schema rejects formula in text fields
    const injection = importTripRowSchema.safeParse({
      ...validRow,
      goods: "=cmd|' /C calc'!A0",
    });
    expect(injection.success).toBe(false);
  });

  it("neutralizes formula injection with sanitizeCsvCellValue", () => {
    expect(sanitizeCsvCellValue("=SUM(1,2)")).toBe("'=SUM(1,2)");
    expect(sanitizeCsvCellValue("@alert(1)")).toBe("'@alert(1)");
    expect(sanitizeCsvCellValue("+100")).toBe("+100");
    expect(sanitizeCsvCellValue("Safe string")).toBe("Safe string");
  });

  it("validates header normalization for standard headers", () => {
    expect(normalizeHeader([...IMPORT_CSV_HEADERS])).toBe("standard");
    expect(normalizeHeader(["bad", "header"])).toBeNull();
  });
});

