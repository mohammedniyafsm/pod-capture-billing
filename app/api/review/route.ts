import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/requireRole";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const filterSchema = z.object({
  reason: z.string().trim().min(1).max(100).optional(),
  branch: z.string().trim().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const filters = filterSchema.safeParse({
    reason: url.searchParams.get("reason") ?? undefined,
    branch: url.searchParams.get("branch") ?? undefined,
  });
  if (!filters.success) {
    return Response.json(
      { error: "Review filters are invalid.", code: "validation_error" },
      { status: 400 },
    );
  }

  const branch = filters.data.branch;
  const trips = await prisma.trip.findMany({
    where: {
      status: "NEEDS_REVIEW",
      ...(branch
        ? {
            OR: [
              { branchId: branch },
              { branch: { name: { equals: branch, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(filters.data.reason
        ? {
            podSubmissions: {
              some: {
                extraction: {
                  reasons: { has: filters.data.reason },
                },
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      branch: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      vehicle: { select: { vehicleNo: true } },
      podSubmissions: {
        orderBy: { uploadedAt: "desc" },
        take: 1,
        include: { extraction: true },
      },
    },
  });

  return Response.json({ trips });
}
