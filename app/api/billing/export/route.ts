import { TripStatus, UserRole } from "@prisma/client";
import { zipSync } from "fflate";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { formatCsv } from "@/src/lib/billing/csv/csv";
import { getBillingWindow } from "@/src/lib/billing/cycle/cycle";
import { getNonVerifiedTripIds } from "@/src/lib/billing/queue/queue";
import { getExportStorage } from "@/src/lib/billing/export/exportStorage";
import { getPodImageStorage } from "@/src/lib/pods/storage/imageStorage";
import {
  buildTallyWorkbook,
  sanitizeTallyText,
  sanitizeVehiclePlate,
  type TallyExportTripItem,
} from "@/src/lib/billing/export/tallyExport";
import { BRAND } from "@/src/lib/brand";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const exportSchema = z.object({
  tripIds: z.array(z.uuid()).min(1).max(100),
}).strict();

// Note: Consignee name and consignee phone are strictly omitted under the DPDP Act 2023.
const csvHeaders = [
  "Date",
  "Party Ledger",
  "Voucher No",
  "LR No",
  "E-way Bill",
  "Vehicle",
  "Route",
  "Amount",
  "Narration",
  "POD File",
];

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
}

async function toBytes(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function POST(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Export request is invalid.",
        code: "validation_error",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const tripIds = [...new Set(parsed.data.tripIds)];
  if (tripIds.length !== parsed.data.tripIds.length) {
    return Response.json(
      { error: "tripIds must not contain duplicates.", code: "duplicate_trip_ids" },
      { status: 400 },
    );
  }

  const trips = await prisma.trip.findMany({
    where: { id: { in: tripIds } },
    orderBy: { lrNumber: "asc" },
    include: {
      client: { select: { id: true, name: true, billingCycle: true, tallyLedgerName: true } },
      vehicle: { select: { vehicleNo: true } },
      podSubmissions: {
        orderBy: { attemptNo: "desc" },
        take: 1,
        select: { imageKey: true, attemptNo: true },
      },
    },
  });
  if (trips.length !== tripIds.length) {
    return Response.json(
      { error: "One or more trips were not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }
  const notVerified = getNonVerifiedTripIds(trips);
  if (notVerified.length > 0) {
    return Response.json(
      {
        error: "Only VERIFIED trips can be exported.",
        code: "trip_not_verified",
        tripIds: notVerified,
      },
      { status: 409 },
    );
  }

  const client = trips[0].client;
  const window = getBillingWindow(
    trips[0].deliveredAt ?? trips[0].verifiedAt ?? trips[0].createdAt,
    client.billingCycle,
  );
  const mixedWindow = trips.some((trip) => {
    if (trip.client.id !== client.id || trip.client.billingCycle !== client.billingCycle) {
      return true;
    }
    const date = trip.deliveredAt ?? trip.verifiedAt ?? trip.createdAt;
    return getBillingWindow(date, trip.client.billingCycle).label !== window.label;
  });
  if (mixedWindow) {
    return Response.json(
      {
        error: "Export each client billing window as a separate batch.",
        code: "mixed_billing_windows",
      },
      { status: 400 },
    );
  }

  const imageStorage = getPodImageStorage();
  const archiveFiles: Record<string, Uint8Array> = {};
  const exportItems: TallyExportTripItem[] = [];
  let missingPodCount = 0;

  for (const trip of trips) {
    const submission = trip.podSubmissions[0];
    let podFileName = "MISSING";

    if (submission?.imageKey) {
      try {
        const image = await imageStorage.read(submission.imageKey);
        if (image) {
          const extension = image.contentType === "image/webp" ? "webp" : "jpg";
          podFileName = `${safeFilename(trip.lrNumber)}_${safeFilename(trip.tripCode)}.${extension}`;
          archiveFiles[`pods/${podFileName}`] = await toBytes(image.body);
        } else {
          missingPodCount += 1;
        }
      } catch {
        missingPodCount += 1;
      }
    } else {
      missingPodCount += 1;
    }

    const tripDate = trip.deliveredAt ?? trip.podReceivedAt ?? trip.createdAt;
    exportItems.push({
      id: trip.id,
      tripCode: trip.tripCode,
      lrNumber: trip.lrNumber,
      ewayBillNo: trip.ewayBillNo,
      origin: trip.origin,
      destination: trip.destination,
      vehicleNo: trip.vehicle.vehicleNo,
      freight: Number(trip.freight),
      goodsDescription: trip.goodsDescription,
      expectedQuantity: Number(trip.expectedQuantity),
      deliveredQuantity: trip.deliveredQuantity ? Number(trip.deliveredQuantity) : null,
      quantityUnit: trip.quantityUnit,
      date: tripDate,
      podFileName,
    });
  }

  // 1. Generate primary XLSX workbook
  const now = new Date();
  const xlsxBuffer = await buildTallyWorkbook(exportItems, {
    clientName: client.name,
    tallyLedgerName: client.tallyLedgerName,
    cycleLabel: window.label,
    exportedBy: auth.session.userId,
    exportedAt: now,
    missingPodCount,
  });

  // 2. Generate secondary CSV file (RFC 4180 with UTF-8 BOM, plain string IDs, numeric amounts)
  const rows = exportItems.map((item) => [
    item.date.toISOString().slice(0, 10),
    sanitizeTallyText(client.tallyLedgerName),
    sanitizeTallyText(item.tripCode),
    sanitizeTallyText(item.lrNumber),
    sanitizeTallyText(item.ewayBillNo),
    sanitizeVehiclePlate(item.vehicleNo),
    `${sanitizeTallyText(item.origin)} to ${sanitizeTallyText(item.destination)}`,
    Number(item.freight).toFixed(2),
    sanitizeTallyText(
      `${item.goodsDescription}; delivered quantity ${item.deliveredQuantity ?? item.expectedQuantity} ${item.quantityUnit}`,
    ),
    sanitizeTallyText(item.podFileName),
  ]);
  const csvText = `\uFEFF${formatCsv([csvHeaders, ...rows])}`;

  const clientSlug = safeFilename(client.name).slice(0, 20);
  const cycleSlug = safeFilename(window.label).slice(0, 24);

  archiveFiles[`Tally_${cycleSlug}.xlsx`] = new Uint8Array(xlsxBuffer);
  archiveFiles[`Tally_${cycleSlug}.csv`] = new TextEncoder().encode(csvText);

  // Add helpful README text
  const readmeText = [
    `# ${BRAND} Tally Accounting Export`,
    `Client: ${client.name}`,
    `Billing Cycle: ${window.label}`,
    `Exported At: ${now.toISOString()}`,
    `Trips: ${trips.length}`,
    "",
    "FILES INCLUDED:",
    `1. ${BRAND}_Tally_${clientSlug}_${cycleSlug}.xlsx - Formatted Excel file for verification and review.`,
    `2. ${BRAND}_Tally_${clientSlug}_${cycleSlug}.csv - Clean UTF-8 CSV with BOM for direct Tally import.`,
    "3. pods/ - Folder containing attached Proof of Delivery images.",
    "",
    "DPDP ACT 2023 NOTICE:",
    "Personal identifiable information (PII) such as consignee names and phone numbers",
    "has been excluded in compliance with privacy regulations.",
  ].join("\r\n");
  archiveFiles["README.txt"] = new TextEncoder().encode(readmeText);

  const archive = zipSync(archiveFiles, { level: 6 });
  const exportStorage = getExportStorage();
  const fileKey = await exportStorage.save(archive);
  try {
    const batch = await prisma.$transaction(async (transaction) => {
      const currentTrips = await transaction.trip.findMany({
        where: { id: { in: tripIds }, status: TripStatus.VERIFIED },
        select: { id: true },
      });
      if (currentTrips.length !== tripIds.length) {
        throw new Error("Export eligibility changed during archive generation.");
      }
      const createdBatch = await transaction.exportBatch.create({
        data: {
          clientId: client.id,
          cycleLabel: window.label,
          tripIds,
          exportedById: auth.session.userId,
          fileKey,
        },
      });
      const updated = await transaction.trip.updateMany({
        where: { id: { in: tripIds }, status: TripStatus.VERIFIED },
        data: { status: TripStatus.EXPORTED },
      });
      if (updated.count !== tripIds.length) {
        throw new Error("Export eligibility changed during status update.");
      }
      await transaction.auditLog.create({
        data: {
          userId: auth.session.userId,
          action: "BILLING_EXPORT_CREATED",
          entity: "ExportBatch",
          entityId: createdBatch.id,
        },
      });
      return createdBatch;
    });

    return Response.json({
      batchId: batch.id,
      cycleLabel: batch.cycleLabel,
      clientId: batch.clientId,
      tripCount: tripIds.length,
      downloadUrl: new URL(`/api/billing/export/${batch.id}`, request.url).toString(),
    });
  } catch (error) {
    await exportStorage.remove(fileKey);
    throw error;
  }
}
