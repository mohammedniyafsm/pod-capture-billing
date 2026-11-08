import { describe, expect, it } from "vitest";
import { parseCsv } from "../../billing/csv/csv";
import {
  IMPORT_CSV_HEADERS,
  importRowSchema,
  parseDeliveredAt,
  validateImportCsvHeader,
} from "./importValidation";

const validRow = {
  tripCode: "TRP-10001",
  client: "Company B",
  vehicleNo: "MH20 EL 4521",
  driverPhone: "9000000001",
  branch: "Pune",
  origin: "Pune",
  destination: "Nagpur",
  freight: "35000",
  lrNumber: "LR-B-20481",
  ewayBillNo: "441022876153",
  goodsDescription: "Cement",
  expectedQuantity: "600",
  quantityUnit: "cartons",
  deliveredAt: "2026-11-03T12:00:00.000Z",
  consigneeName: "Consignee",
  consigneePhone: "9000000010",
};

describe("CSV trip import validation", () => {
  it("accepts a valid import row and the documented header", () => {
    expect(importRowSchema.safeParse(validRow).success).toBe(true);
    expect(validateImportCsvHeader(IMPORT_CSV_HEADERS)).toBe(true);
  });

  it.each([
    ["short e-way bill", { ewayBillNo: "12345" }],
    ["non-numeric e-way bill", { ewayBillNo: "12345678901X" }],
    ["zero freight", { freight: "0" }],
    ["negative freight", { freight: "-1" }],
    ["empty trip code", { tripCode: " " }],
  ])("rejects a row with %s", (_description, change) => {
    expect(importRowSchema.safeParse({ ...validRow, ...change }).success).toBe(
      false,
    );
  });

  it("rejects reordered or missing headers", () => {
    expect(validateImportCsvHeader([...IMPORT_CSV_HEADERS].reverse())).toBe(
      false,
    );
    expect(validateImportCsvHeader(IMPORT_CSV_HEADERS.slice(1))).toBe(false);
  });

  it("validates CSV rows and optional delivery dates", () => {
    const [header, row] = parseCsv(
      `${IMPORT_CSV_HEADERS.join(",")}\n${Object.values(validRow).join(",")}`,
    );
    expect(validateImportCsvHeader(header)).toBe(true);
    expect(
      importRowSchema.safeParse(
        Object.fromEntries(header.map((key, index) => [key, row[index]])),
      ).success,
    ).toBe(true);
    expect(parseDeliveredAt("")).toBeNull();
    expect(() => parseDeliveredAt("not-a-date")).toThrow(
      "deliveredAt must be a valid ISO date",
    );
  });
});
