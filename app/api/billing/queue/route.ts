import { BillingCycle, TripStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { groupBillingQueueTrips } from "@/src/lib/billing/queue/queue";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const filtersSchema = z.object({
  client: z.string().trim().min(1).max(100).optional(),
  cycle: z.nativeEnum(BillingCycle).optional(),
  branch: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["VERIFIED", "EXPORTED"]).default("VERIFIED"),
});

export async function GET(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = filtersSchema.safeParse({
    client: url.searchParams.get("client") ?? undefined,
    cycle: url.searchParams.get("cycle") ?? undefined,
    branch: url.searchParams.get("branch") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Billing filters are invalid.", code: "validation_error" },
      { status: 400 },
    );
  }

  const { client, cycle, branch, status } = parsed.data;
  const targetStatus = status === "EXPORTED" ? TripStatus.EXPORTED : TripStatus.VERIFIED;
  const trips = await prisma.trip.findMany({
    where: {
      status: targetStatus,
      AND: [
        ...(client
          ? [
              {
                OR: [
                  { clientId: client },
                  { client: { name: { equals: client, mode: "insensitive" as const } } },
                ],
              },
            ]
          : []),
        ...(cycle ? [{ client: { billingCycle: cycle } }] : []),
        ...(branch
          ? [
              {
                OR: [
                  { branchId: branch },
                  { branch: { name: { equals: branch, mode: "insensitive" as const } } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ clientId: "asc" }, { deliveredAt: "asc" }, { createdAt: "asc" }],
    include: {
      client: { select: { id: true, name: true, billingCycle: true, tallyLedgerName: true } },
      branch: { select: { id: true, name: true } },
      vehicle: { select: { vehicleNo: true } },
    },
  });

  return Response.json({ groups: groupBillingQueueTrips(trips) });
}
