import { z } from "zod";

export const IMPORT_CSV_HEADERS = [
  "trip_code",
  "client",
  "vehicle_no",
  "is_hired",
  "origin",
  "destination",
  "freight",
  "lr_number",
  "eway_bill_no",
  "goods",
  "quantity",
  "unit",
  "branch",
  "driver_phone",
] as const;

// Legacy headers supported for backwards compatibility
export const LEGACY_IMPORT_CSV_HEADERS = [
  "tripCode",
  "client",
  "vehicleNo",
  "driverPhone",
  "branch",
  "origin",
  "destination",
  "freight",
  "lrNumber",
  "ewayBillNo",
  "goodsDescription",
  "expectedQuantity",
  "quantityUnit",
  "deliveredAt",
  "consigneeName",
  "consigneePhone",
] as const;

/**
 * Sanitizes CSV text values against formula injection (CSV injection).
 * If a string begins with =, +, -, or @, neutralizes it by prefixing with a single quote '
 * or rejects if unsafe.
 */
export function sanitizeCsvCellValue(val: string): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (/^[=+\-@]/.test(trimmed)) {
    // If it's a valid signed number (e.g. +100 or -50), check if numeric
    if (/^[+\-]\d+(\.\d+)?$/.test(trimmed)) {
      return trimmed;
    }
    // Neutralize formula injection
    return `'${trimmed}`;
  }
  return trimmed;
}

export function detectFormulaInjection(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  // If it starts with =, +, -, @ and is not purely a numeric signed value
  if (/^[=@]/.test(trimmed)) return true;
  if (/^[+\-]/.test(trimmed) && !/^[+\-]?\d+(\.\d+)?$/.test(trimmed)) {
    return true;
  }
  return false;
}

export const importTripRowSchema = z
  .object({
    trip_code: z
      .string()
      .trim()
      .min(1, "Trip code is required.")
      .max(100, "Trip code max 100 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in trip code."),
    client: z
      .string()
      .trim()
      .min(1, "Client is required.")
      .max(150, "Client max 150 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in client."),
    vehicle_no: z
      .string()
      .trim()
      .min(1, "Vehicle number is required.")
      .max(40, "Vehicle number max 40 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in vehicle number."),
    is_hired: z.preprocess((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") {
        const lower = v.trim().toLowerCase();
        return lower === "true" || lower === "yes" || lower === "1" || lower === "hired";
      }
      return false;
    }, z.boolean()),
    origin: z
      .string()
      .trim()
      .min(1, "Origin is required.")
      .max(150, "Origin max 150 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in origin."),
    destination: z
      .string()
      .trim()
      .min(1, "Destination is required.")
      .max(150, "Destination max 150 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in destination."),
    freight: z.coerce.number().finite().positive("Freight must be a positive number."),
    lr_number: z
      .string()
      .trim()
      .min(1, "LR number is required.")
      .max(100, "LR number max 100 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in LR number."),
    eway_bill_no: z
      .string()
      .trim()
      .regex(/^\d{12}$/, "E-way bill number must be exactly 12 digits."),
    goods: z
      .string()
      .trim()
      .min(1, "Goods description is required.")
      .max(500, "Goods description max 500 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in goods."),
    quantity: z.coerce.number().finite().positive("Quantity must be a positive number."),
    unit: z
      .string()
      .trim()
      .min(1, "Quantity unit is required.")
      .max(40, "Unit max 40 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in unit."),
    branch: z
      .string()
      .trim()
      .min(1, "Branch is required.")
      .max(100, "Branch max 100 characters.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in branch."),
    driver_phone: z
      .string()
      .trim()
      .max(40, "Driver phone max 40 characters.")
      .default("")
      .refine((v) => !v || /^\+?[0-9\s\-]+$/.test(v), "Driver phone must be a valid phone number.")
      .refine((v) => !detectFormulaInjection(v), "Formula injection detected in driver phone."),
  })
  .strict();

export type StandardImportRow = z.infer<typeof importTripRowSchema>;

export function normalizeHeader(header: string[]): "standard" | "legacy" | null {
  const trimmed = header.map((h) => h.trim().replace(/^\uFEFF/, ""));
  if (
    trimmed.length === IMPORT_CSV_HEADERS.length &&
    IMPORT_CSV_HEADERS.every((name, index) => trimmed[index] === name)
  ) {
    return "standard";
  }
  if (
    trimmed.length === LEGACY_IMPORT_CSV_HEADERS.length &&
    LEGACY_IMPORT_CSV_HEADERS.every((name, index) => trimmed[index] === name)
  ) {
    return "legacy";
  }
  return null;
}

export function mapRowToStandard(
  rawValues: string[],
  headerType: "standard" | "legacy",
): Record<string, unknown> {
  if (headerType === "standard") {
    return Object.fromEntries(
      IMPORT_CSV_HEADERS.map((key, i) => [key, rawValues[i] ?? ""]),
    );
  }
  // Map legacy columns
  const legacyMap = Object.fromEntries(
    LEGACY_IMPORT_CSV_HEADERS.map((key, i) => [key, rawValues[i] ?? ""]),
  );
  return {
    trip_code: legacyMap.tripCode,
    client: legacyMap.client,
    vehicle_no: legacyMap.vehicleNo,
    is_hired: false,
    origin: legacyMap.origin,
    destination: legacyMap.destination,
    freight: legacyMap.freight,
    lr_number: legacyMap.lrNumber,
    eway_bill_no: legacyMap.ewayBillNo,
    goods: legacyMap.goodsDescription,
    quantity: legacyMap.expectedQuantity,
    unit: legacyMap.quantityUnit,
    branch: legacyMap.branch,
    driver_phone: legacyMap.driverPhone,
  };
}

