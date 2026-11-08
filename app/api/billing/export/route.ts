import { TripStatus, UserRole } from "@prisma/client";
import { zipSync } from "fflate";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { formatCsv } from "@/src/lib/billing/csv/csv";
import { getBillingWindow } from "@/src/lib/billing/cycle/cycle";
import { getNonVerifiedTripIds } from "@/src/lib/billing/queue/queue";
import { getExportStorage } from "@/src/lib/billing/export/exportStorage";
import { getPodImageStorage } from "@/src/lib/pods/storage/imageStorage";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const exportSchema = z.object({
  tripIds: z.array(z.uuid()).min(1).max(100),
}).strict();
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

  const rows = trips.map((trip) => [
    (trip.deliveredAt ?? trip.podReceivedAt ?? trip.createdAt).toISOString().slice(0, 10),
    trip.client.tallyLedgerName,
    trip.tripCode,
    trip.lrNumber,
    trip.ewayBillNo,
    trip.vehicle.vehicleNo,
    `${trip.origin} to ${trip.destination}`,
    Number(trip.freight).toFixed(2),
    `${trip.goodsDescription}; delivered quantity ${trip.deliveredQuantity ?? trip.expectedQuantity} ${trip.quantityUnit}`,
  ]);
  const csv = `\uFEFF${formatCsv([csvHeaders, ...rows])}`;
  const archiveFiles: Record<string, Uint8Array> = {
    "Tally.csv": new TextEncoder().encode(csv),
  };
  const imageStorage = getPodImageStorage();
  for (const trip of trips) {
    const submission = trip.podSubmissions[0];
    if (!submission) {
      return Response.json(
        {
          error: `Trip ${trip.tripCode} has no POD image.`,
          code: "pod_image_missing",
          tripId: trip.id,
        },
        { status: 409 },
      );
    }
    const image = await imageStorage.read(submission.imageKey);
    if (!image) {
      return Response.json(
        {
          error: `POD image for trip ${trip.tripCode} is missing.`,
          code: "pod_image_missing",
          tripId: trip.id,
        },
        { status: 409 },
      );
    }
    const extension = image.contentType === "image/webp" ? "webp" : "jpg";
    archiveFiles[`POD/${safeFilename(trip.lrNumber)}.${extension}`] =
      await toBytes(image.body);
  }

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
