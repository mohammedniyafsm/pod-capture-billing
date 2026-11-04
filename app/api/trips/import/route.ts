import {
  TripStatus,
  UserRole,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/src/lib/auth/requireRole";
import { parseCsv } from "@/src/lib/billing/csv";
import { prisma } from "@/src/lib/prisma";
import { createUploadLinkInTransaction } from "@/src/lib/pods/uploadLinks";
import {
  IMPORT_CSV_HEADERS,
  importRowSchema,
  parseDeliveredAt,
  validateImportCsvHeader,
} from "@/src/lib/trips/importValidation";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const MAX_CSV_BYTES = 2 * 1024 * 1024;
async function getCsvText(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CSV_BYTES) {
    return { error: "CSV file must be 2 MB or smaller.", text: null };
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { error: "Request must be valid multipart form data.", text: null };
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return { error: "CSV file is required in the 'file' field.", text: null };
    }
    if (file.size > MAX_CSV_BYTES) {
      return { error: "CSV file must be 2 MB or smaller.", text: null };
    }
    return { error: null, text: await file.text() };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    return { error: "CSV file must be 2 MB or smaller.", text: null };
  }
  return { error: null, text };
}

export async function POST(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const csv = await getCsvText(request);
  if (csv.error || csv.text === null) {
    return Response.json(
      { error: csv.error ?? "CSV file is required.", code: "invalid_csv" },
      { status: 400 },
    );
  }

  let rows: string[][];
  try {
    rows = parseCsv(csv.text.replace(/^\uFEFF/, ""));
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "CSV format is invalid.",
        code: "invalid_csv",
      },
      { status: 400 },
    );
  }
  if (rows.length < 1) {
    return Response.json(
      { error: "CSV must include a header row.", code: "invalid_csv" },
      { status: 400 },
    );
  }
  const header = rows[0].map((value) => value.trim());
  if (
    !validateImportCsvHeader(header)
  ) {
    return Response.json(
      {
        error: `CSV headers must be: ${IMPORT_CSV_HEADERS.join(",")}`,
        code: "invalid_csv_headers",
      },
      { status: 400 },
    );
  }

  let imported = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];
  for (let index = 1; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const values = rows[index];
    if (values.length !== IMPORT_CSV_HEADERS.length) {
      skipped += 1;
      errors.push({ row: rowNumber, message: "Column count does not match the header." });
      continue;
    }
    const raw = Object.fromEntries(
      IMPORT_CSV_HEADERS.map((key, column) => [key, values[column]]),
    );
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      errors.push({
        row: rowNumber,
        message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      });
      continue;
    }
    const data = parsed.data;
    let deliveredAt: Date | null;
    try {
      deliveredAt = parseDeliveredAt(data.deliveredAt);
    } catch (error) {
      skipped += 1;
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "deliveredAt is invalid.",
      });
      continue;
    }

    try {
      const [client, branch, vehicle] = await Promise.all([
        prisma.client.findFirst({
          where: { OR: [{ id: data.client }, { name: { equals: data.client, mode: "insensitive" } }] },
          select: { id: true },
        }),
        prisma.branch.findFirst({
          where: { OR: [{ id: data.branch }, { name: { equals: data.branch, mode: "insensitive" } }] },
          select: { id: true },
        }),
        prisma.vehicle.findUnique({
          where: { vehicleNo: data.vehicleNo },
          include: { defaultDriver: { select: { id: true, phone: true, role: true } } },
        }),
      ]);
      if (!client) throw new Error(`Unknown client '${data.client}'.`);
      if (!branch) throw new Error(`Unknown branch '${data.branch}'.`);
      if (!vehicle) throw new Error(`Unknown vehicle '${data.vehicleNo}'.`);

      const phoneUser = data.driverPhone
        ? await prisma.user.findUnique({
            where: { phone: data.driverPhone },
            select: { id: true, phone: true, role: true },
          })
        : null;
      const defaultDriver =
        vehicle.defaultDriver?.role === UserRole.DRIVER
          ? vehicle.defaultDriver
          : null;
      const driver =
        phoneUser?.role === UserRole.DRIVER ? phoneUser : defaultDriver;
      const smsPhone = data.driverPhone || driver?.phone || "";
      if (vehicle.isHired && !smsPhone) {
        throw new Error("Hired vehicle rows require driverPhone for the upload link SMS.");
      }

      await prisma.$transaction(async (transaction) => {
        const trip = await transaction.trip.create({
          data: {
            tripCode: data.tripCode,
            clientId: client.id,
            vehicleNo: vehicle.vehicleNo,
            isHired: vehicle.isHired,
            driverId: driver?.id ?? null,
            driverPhone: data.driverPhone || null,
            branchId: branch.id,
            origin: data.origin,
            destination: data.destination,
            freight: data.freight,
            lrNumber: data.lrNumber,
            ewayBillNo: data.ewayBillNo,
            goodsDescription: data.goodsDescription,
            expectedQuantity: data.expectedQuantity,
            quantityUnit: data.quantityUnit,
            deliveredAt,
            startedAt: null,
            consigneeName: data.consigneeName || null,
            consigneePhone: data.consigneePhone || null,
            status:
              vehicle.isHired || (driver && deliveredAt)
                ? TripStatus.POD_PENDING
                : driver
                  ? TripStatus.ASSIGNED
                  : TripStatus.UNASSIGNED,
          },
          select: { id: true },
        });

        if (vehicle.isHired) {
          const link = await createUploadLinkInTransaction(transaction, trip.id);
          await transaction.smsOutbox.create({
            data: {
              toPhone: smsPhone,
              tripId: trip.id,
              body: `Please upload the proof of delivery: ${new URL(`/api/upload/${link.token}`, request.url).toString()}`,
            },
          });
        }
      });
      imported += 1;
    } catch (error) {
      skipped += 1;
      errors.push({
        row: rowNumber,
        message:
          error instanceof Error
            ? error.message
            : "Trip could not be imported.",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: auth.session.userId,
      action: "TRIPS_IMPORTED",
      entity: "TripImport",
      entityId: randomUUID(),
    },
  });
  return Response.json({ imported, skipped, errors });
}
