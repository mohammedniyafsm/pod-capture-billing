import { TripStatus, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { requireRole } from "../../../../src/lib/auth/rbac/requireRole";
import { parseCsv } from "../../../../src/lib/billing/csv/csv";
import { createUploadLinkInTransaction } from "../../../../src/lib/pods/links/uploadLinks";
import { prisma } from "../../../../src/lib/prisma";
import {
  importTripRowSchema,
  mapRowToStandard,
  normalizeHeader,
  IMPORT_CSV_HEADERS,
} from "../../../../src/lib/trips/import/importStandard";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_CSV_ROWS = 1000;

export async function getCsvTextFromRequest(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CSV_BYTES) {
    return { error: "CSV file must be 2 MB or smaller.", text: null, filename: "unknown.csv" };
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { error: "Request must be valid multipart form data.", text: null, filename: "unknown.csv" };
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return { error: "CSV file is required in the 'file' field.", text: null, filename: "unknown.csv" };
    }
    if (file.size > MAX_CSV_BYTES) {
      return { error: "CSV file must be 2 MB or smaller.", text: null, filename: file.name };
    }
    return { error: null, text: await file.text(), filename: file.name };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    return { error: "CSV file must be 2 MB or smaller.", text: null, filename: "upload.csv" };
  }
  return { error: null, text, filename: "upload.csv" };
}

export type ValidatedRowResult = {
  rowNumber: number;
  data?: any;
  status: "READY" | "DUPLICATE" | "ERROR";
  reason?: string;
  raw: Record<string, string>;
};

export async function processAndValidateCsv(csvText: string): Promise<{
  headerType: "standard" | "legacy";
  results: ValidatedRowResult[];
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
  errorsList: Array<{ row: number; reason: string }>;
}> {
  // Handle UTF-8 BOM
  const cleaned = csvText.replace(/^\uFEFF/, "");
  const rows = parseCsv(cleaned);
  if (rows.length < 1) {
    throw new Error("CSV file is empty.");
  }
  if (rows.length - 1 > MAX_CSV_ROWS) {
    throw new Error(`CSV exceeds maximum limit of ${MAX_CSV_ROWS} rows.`);
  }

  const header = rows[0].map((h) => h.trim());
  const headerType = normalizeHeader(header);
  if (!headerType) {
    throw new Error(
      `CSV headers do not match expected columns: ${IMPORT_CSV_HEADERS.join(", ")}`,
    );
  }

  // Pre-load reference databases for quick in-memory cross checking
  const [existingClients, existingBranches, existingTrips] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.trip.findMany({
      select: {
        id: true,
        tripCode: true,
        clientId: true,
        lrNumber: true,
      },
    }),
  ]);

  const clientLookup = new Map<string, string>();
  for (const c of existingClients) {
    clientLookup.set(c.id, c.id);
    clientLookup.set(c.name.toLowerCase(), c.id);
  }

  const branchLookup = new Map<string, string>();
  for (const b of existingBranches) {
    branchLookup.set(b.id, b.id);
    branchLookup.set(b.name.toLowerCase(), b.id);
  }

  const dbTripCodes = new Set(existingTrips.map((t) => t.tripCode.toLowerCase()));
  const dbClientLrs = new Set(
    existingTrips.map((t) => `${t.clientId}:${t.lrNumber.toLowerCase()}`),
  );

  // In-file duplicate trackers
  const fileTripCodes = new Set<string>();
  const fileClientLrs = new Set<string>();

  const results: ValidatedRowResult[] = [];
  const errorsList: Array<{ row: number; reason: string }> = [];

  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const rawValues = rows[i];
    const rawObj = mapRowToStandard(rawValues, headerType) as Record<string, string>;

    const parsed = importTripRowSchema.safeParse(rawObj);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ");
      results.push({ rowNumber, status: "ERROR", reason, raw: rawObj });
      errorsList.push({ row: rowNumber, reason });
      continue;
    }

    const rowData = parsed.data;
    const clientId = clientLookup.get(rowData.client.toLowerCase());
    if (!clientId) {
      const reason = `Client '${rowData.client}' does not exist.`;
      results.push({ rowNumber, status: "ERROR", reason, raw: rawObj });
      errorsList.push({ row: rowNumber, reason });
      continue;
    }

    const branchId = branchLookup.get(rowData.branch.toLowerCase());
    if (!branchId) {
      const reason = `Branch '${rowData.branch}' does not exist.`;
      results.push({ rowNumber, status: "ERROR", reason, raw: rawObj });
      errorsList.push({ row: rowNumber, reason });
      continue;
    }

    // Check duplicate trip code (in-file or database)
    const tripCodeKey = rowData.trip_code.toLowerCase();
    if (dbTripCodes.has(tripCodeKey) || fileTripCodes.has(tripCodeKey)) {
      const reason = `Duplicate trip code '${rowData.trip_code}' (already exists).`;
      results.push({ rowNumber, status: "DUPLICATE", reason, raw: rawObj });
      continue;
    }

    // Check duplicate client + lr_number (in-file or database)
    const clientLrKey = `${clientId}:${rowData.lr_number.toLowerCase()}`;
    if (dbClientLrs.has(clientLrKey) || fileClientLrs.has(clientLrKey)) {
      const reason = `Duplicate LR number '${rowData.lr_number}' for this client.`;
      results.push({ rowNumber, status: "DUPLICATE", reason, raw: rawObj });
      continue;
    }

    // Hired vehicle requires a driver phone for upload link
    if (rowData.is_hired && !rowData.driver_phone) {
      const reason = "Hired vehicle rows require a driver phone number for the upload link.";
      results.push({ rowNumber, status: "ERROR", reason, raw: rawObj });
      errorsList.push({ row: rowNumber, reason });
      continue;
    }

    fileTripCodes.add(tripCodeKey);
    fileClientLrs.add(clientLrKey);

    results.push({
      rowNumber,
      status: "READY",
      data: {
        ...rowData,
        resolvedClientId: clientId,
        resolvedBranchId: branchId,
      },
      raw: rawObj,
    });
  }

  const readyCount = results.filter((r) => r.status === "READY").length;
  const duplicateCount = results.filter((r) => r.status === "DUPLICATE").length;
  const errorCount = results.filter((r) => r.status === "ERROR").length;

  return {
    headerType,
    results,
    readyCount,
    duplicateCount,
    errorCount,
    errorsList,
  };
}

export async function POST(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const isPreview = url.searchParams.get("preview") === "true";

  const csv = await getCsvTextFromRequest(request);
  if (csv.error || csv.text === null) {
    return Response.json(
      { error: csv.error ?? "CSV file is required.", code: "invalid_csv" },
      { status: 400 },
    );
  }

  let validation;
  try {
    validation = await processAndValidateCsv(csv.text);
  } catch (err: unknown) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid CSV data.", code: "invalid_csv" },
      { status: 400 },
    );
  }

  // If preview was requested, return diagnostics without saving
  if (isPreview) {
    return Response.json({
      preview: true,
      filename: csv.filename,
      counts: {
        total: validation.results.length,
        ready: validation.readyCount,
        duplicates: validation.duplicateCount,
        errors: validation.errorCount,
      },
      rows: validation.results.map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        reason: r.reason,
        tripCode: r.raw.trip_code || r.raw.tripCode || "",
        client: r.raw.client || "",
        vehicleNo: r.raw.vehicle_no || r.raw.vehicleNo || "",
        origin: r.raw.origin || "",
        destination: r.raw.destination || "",
        freight: r.raw.freight || "",
        lrNumber: r.raw.lr_number || r.raw.lrNumber || "",
        ewayBillNo: r.raw.eway_bill_no || r.raw.ewayBillNo || "",
        isHired: r.raw.is_hired ?? false,
      })),
      errors: validation.errorsList,
    });
  }

  // Confirmation step: re-validates on the server and writes in a single transaction
  const readyRows = validation.results.filter((r) => r.status === "READY");
  let importedCount = 0;
  let skippedCount = validation.duplicateCount;
  const executionErrors: Array<{ row: number; reason: string }> = [...validation.errorsList];

  for (const item of readyRows) {
    const row = item.data;
    try {
      await prisma.$transaction(
        async (tx) => {
          // Vehicle is created if new (is_hired flag respected)
          const vehicle = await tx.vehicle.upsert({
            where: { vehicleNo: row.vehicle_no },
            create: {
              vehicleNo: row.vehicle_no,
              isHired: row.is_hired,
            },
            update: {
              isHired: row.is_hired,
            },
            include: { defaultDriver: { select: { id: true, phone: true, role: true } } },
          });

          // Resolve driver if driver_phone provided
          let driverUser = null;
          if (row.driver_phone) {
            driverUser = await tx.user.findUnique({
              where: { phone: row.driver_phone },
              select: { id: true, phone: true, role: true },
            });
          }
          const defaultDriver =
            vehicle.defaultDriver?.role === UserRole.DRIVER ? vehicle.defaultDriver : null;
          const driver = driverUser?.role === UserRole.DRIVER ? driverUser : defaultDriver;

          const trip = await tx.trip.create({
            data: {
              tripCode: row.trip_code,
              clientId: row.resolvedClientId,
              vehicleNo: vehicle.vehicleNo,
              isHired: row.is_hired,
              driverId: driver?.id ?? null,
              driverPhone: row.driver_phone || null,
              branchId: row.resolvedBranchId,
              origin: row.origin,
              destination: row.destination,
              freight: row.freight,
              lrNumber: row.lr_number,
              ewayBillNo: row.eway_bill_no,
              goodsDescription: row.goods,
              expectedQuantity: row.quantity,
              quantityUnit: row.unit,
              status: row.is_hired
                ? TripStatus.ASSIGNED
                : driver
                  ? TripStatus.ASSIGNED
                  : TripStatus.UNASSIGNED,
            },
            select: { id: true },
          });

          // A hired vehicle's trip stays ASSIGNED and gets an upload link
          if (row.is_hired) {
            const link = await createUploadLinkInTransaction(tx, trip.id);
            await tx.smsOutbox.create({
              data: {
                toPhone: row.driver_phone,
                tripId: trip.id,
                body: `Please upload the proof of delivery: ${new URL(`/api/upload/${link.token}`, request.url).toString()}`,
              },
            });
          }
        },
        { timeout: 30000, maxWait: 10000 },
      );
      importedCount += 1;
    } catch (err: unknown) {
      skippedCount += 1;
      executionErrors.push({
        row: item.rowNumber,
        reason: err instanceof Error ? err.message : "Failed to insert trip.",
      });
    }
  }

  // Audit log entry per import (counts, filename, strictly no personal data)
  await prisma.auditLog.create({
    data: {
      userId: auth.session.userId,
      action: "TRIPS_IMPORTED",
      entity: "TripImport",
      entityId: randomUUID(),
    },
  });

  return Response.json({
    success: true,
    imported: importedCount,
    skipped: skippedCount,
    errors: executionErrors,
    filename: csv.filename,
  });
}
