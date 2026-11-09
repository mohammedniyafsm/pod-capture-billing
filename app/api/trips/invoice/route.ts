import { TripStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);

// Tally invoice number: text, max 40 chars, letters, digits, - and /
const invoiceSchema = z
  .object({
    tripIds: z.array(z.string().uuid()).min(1, "At least one trip ID is required."),
    invoiceNumber: z
      .string()
      .trim()
      .max(40, "Invoice number must be at most 40 characters.")
      .regex(/^[a-zA-Z0-9\-\/]*$/, "Invoice number can only contain letters, digits, '-' and '/'.")
      .optional()
      .or(z.literal("")),
    invoiceDate: z.string().trim().min(1, "Invoice date is required."),
  })
  .strict();

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

  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Validation failed.",
        code: "validation_error",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const { tripIds, invoiceNumber, invoiceDate: invoiceDateStr } = parsed.data;
  const parsedInvoiceDate = new Date(invoiceDateStr);
  if (Number.isNaN(parsedInvoiceDate.getTime())) {
    return Response.json(
      { error: "Invalid invoice date format.", code: "invalid_date" },
      { status: 400 },
    );
  }

  const now = new Date();
  if (parsedInvoiceDate.getTime() > now.getTime() + 1000 * 60 * 60 * 24) {
    // Cannot be in the future (permitting minor timezone day edge cases)
    return Response.json(
      { error: "Invoice date cannot be in the future.", code: "future_date" },
      { status: 400 },
    );
  }

  // Fetch the targeted trips
  const trips = await prisma.trip.findMany({
    where: { id: { in: tripIds } },
    select: {
      id: true,
      tripCode: true,
      status: true,
      podReceivedAt: true,
      invoicedAt: true,
      invoiceNumber: true,
    },
  });

  if (trips.length === 0) {
    return Response.json(
      { error: "No matching trips found.", code: "not_found" },
      { status: 404 },
    );
  }

  // Check if any trip is already invoiced
  const alreadyInvoiced = trips.filter((t) => t.status === TripStatus.INVOICED);
  const eligibleTrips = trips.filter((t) => t.status === TripStatus.EXPORTED);
  const invalidStatusTrips = trips.filter(
    (t) => t.status !== TripStatus.EXPORTED && t.status !== TripStatus.INVOICED,
  );

  // If there are trips with invalid status (neither EXPORTED nor INVOICED)
  if (invalidStatusTrips.length > 0) {
    const invalidCodes = invalidStatusTrips.map((t) => `${t.tripCode} (${t.status})`).join(", ");
    return Response.json(
      {
        error: `Only EXPORTED trips can be marked as invoiced. Found ineligible trips: ${invalidCodes}`,
        code: "ineligible_status",
      },
      { status: 409 },
    );
  }

  // Check POD date vs Invoice date constraint
  for (const t of eligibleTrips) {
    if (t.podReceivedAt && parsedInvoiceDate.getTime() < new Date(t.podReceivedAt).getTime()) {
      return Response.json(
        {
          error: `Invoice date cannot be before POD received date for trip ${t.tripCode}.`,
          code: "invoice_before_pod",
        },
        { status: 400 },
      );
    }
  }

  // If all requested trips were already invoiced, return an idempotent success message
  if (eligibleTrips.length === 0 && alreadyInvoiced.length > 0) {
    return Response.json({
      success: true,
      message: `${alreadyInvoiced.length} trip(s) were already marked as invoiced. No changes made.`,
      updatedCount: 0,
      alreadyInvoicedCount: alreadyInvoiced.length,
      tripIds: alreadyInvoiced.map((t) => t.id),
    });
  }

  const finalInvoiceNum = invoiceNumber && invoiceNumber.trim().length > 0 ? invoiceNumber.trim() : null;

  // Single transaction update
  const result = await prisma.$transaction(async (tx) => {
    const eligibleIds = eligibleTrips.map((t) => t.id);

    await tx.trip.updateMany({
      where: { id: { in: eligibleIds } },
      data: {
        status: TripStatus.INVOICED,
        invoicedAt: parsedInvoiceDate,
        invoiceNumber: finalInvoiceNum,
      },
    });

    // Write audit log entry per updated trip
    const auditEntries = eligibleTrips.map((t) => ({
      userId: auth.session.userId,
      action: "TRIP_MARKED_INVOICED",
      entity: "Trip",
      entityId: t.id,
    }));

    await tx.auditLog.createMany({
      data: auditEntries,
    });

    return {
      updatedCount: eligibleTrips.length,
      alreadyInvoicedCount: alreadyInvoiced.length,
      updatedTripIds: eligibleIds,
    };
  });

  const msg =
    result.alreadyInvoicedCount > 0
      ? `${result.updatedCount} trip(s) marked as invoiced (${result.alreadyInvoicedCount} already invoiced).`
      : `${result.updatedCount} trip(s) marked as invoiced.`;

  return Response.json({
    success: true,
    message: msg,
    updatedCount: result.updatedCount,
    alreadyInvoicedCount: result.alreadyInvoicedCount,
    tripIds: result.updatedTripIds,
  });
}

