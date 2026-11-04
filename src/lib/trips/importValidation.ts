import { z } from "zod";

export const IMPORT_CSV_HEADERS = [
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

export const importRowSchema = z.object({
  tripCode: z.string().trim().min(1).max(100),
  client: z.string().trim().min(1).max(150),
  vehicleNo: z.string().trim().min(1).max(40),
  driverPhone: z.string().trim().max(40).optional().default(""),
  branch: z.string().trim().min(1).max(100),
  origin: z.string().trim().min(1).max(150),
  destination: z.string().trim().min(1).max(150),
  freight: z.coerce.number().finite().positive(),
  lrNumber: z.string().trim().min(1).max(100),
  ewayBillNo: z
    .string()
    .trim()
    .regex(/^\d{12}$/, "E-way bill must be 12 digits."),
  goodsDescription: z.string().trim().min(1).max(500),
  expectedQuantity: z.coerce.number().finite().positive(),
  quantityUnit: z.string().trim().min(1).max(40),
  deliveredAt: z.string().trim().optional().default(""),
  consigneeName: z.string().trim().max(150).optional().default(""),
  consigneePhone: z.string().trim().max(40).optional().default(""),
}).strict();

export function parseDeliveredAt(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("deliveredAt must be a valid ISO date.");
  }
  return date;
}

export function validateImportCsvHeader(header: readonly string[]) {
  return (
    header.length === IMPORT_CSV_HEADERS.length &&
    IMPORT_CSV_HEADERS.every((name, index) => header[index] === name)
  );
}
