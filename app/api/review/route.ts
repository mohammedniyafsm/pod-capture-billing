import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const filterSchema = z.object({
  search: z.string().trim().optional(),
  reason: z.string().trim().min(1).max(100).optional(),
  branch: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export async function GET(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const filters = filterSchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    reason: url.searchParams.get("reason") ?? undefined,
    branch: url.searchParams.get("branch") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!filters.success) {
    return Response.json(
      { error: "Review filters are invalid.", code: "validation_error" },
      { status: 400 },
    );
  }

  const { search, reason, branch, page, limit } = filters.data;

  const where: Record<string, unknown> = {
    status: "NEEDS_REVIEW",
  };

  if (branch) {
    where.OR = [
      { branchId: branch },
      { branch: { name: { equals: branch, mode: "insensitive" } } },
    ];
  }

  if (reason) {
    where.podSubmissions = {
      some: {
        extraction: {
          reasons: { has: reason },
        },
      },
    };
  }

  if (search && search.length > 0) {
    const searchFilter = [
      { tripCode: { contains: search, mode: "insensitive" } },
      { lrNumber: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
      { vehicleNo: { contains: search, mode: "insensitive" } },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchFilter }];
      delete where.OR;
    } else {
      where.OR = searchFilter;
    }
  }

  const skip = (page - 1) * limit;

  const [total, trips] = await Promise.all([
    prisma.trip.count({ where }),
    prisma.trip.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip,
      take: limit,
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
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return Response.json({
    trips,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
}
