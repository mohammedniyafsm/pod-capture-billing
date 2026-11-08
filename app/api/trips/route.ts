import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/requireRole";
import { prisma } from "../../../src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);

const tripsQuerySchema = z.object({
  search: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  vehicleType: z.enum(["ALL", "OWN", "HIRED"]).default("ALL"),
  podStatus: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = tripsQuerySchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    clientId: url.searchParams.get("clientId") ?? undefined,
    branchId: url.searchParams.get("branchId") ?? undefined,
    vehicleType: url.searchParams.get("vehicleType") ?? undefined,
    podStatus: url.searchParams.get("podStatus") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      {
        error: "Trips query parameters are invalid.",
        code: "validation_error",
        details: parsed.error.format(),
      },
      { status: 400 },
    );
  }

  const {
    search,
    clientId,
    branchId,
    vehicleType,
    podStatus,
    from,
    to,
    page,
    limit,
  } = parsed.data;

  // Build Prisma where conditions
  const where: Record<string, unknown> = {};

  if (clientId) {
    where.clientId = clientId;
  }

  if (branchId) {
    where.branchId = branchId;
  }

  if (vehicleType === "OWN") {
    where.isHired = false;
  } else if (vehicleType === "HIRED") {
    where.isHired = true;
  }

  if (podStatus) {
    where.status = podStatus;
  }

  // Date range filtering on createdAt or deliveredAt
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  // Search filter matching Trip Code, LR Number, Vehicle Number, or Client Name
  if (search && search.length > 0) {
    where.OR = [
      { tripCode: { contains: search, mode: "insensitive" } },
      { lrNumber: { contains: search, mode: "insensitive" } },
      { vehicleNo: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const skip = (page - 1) * limit;

  const [totalCount, trips, branches, clients] = await Promise.all([
    prisma.trip.count({ where }),
    prisma.trip.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        client: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        vehicle: { select: { vehicleNo: true, isHired: true } },
        driver: { select: { id: true, name: true, phone: true } },
        podSubmissions: {
          orderBy: { uploadedAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            uploadedAt: true,
            attemptNo: true,
          },
        },
        uploadLinks: {
          orderBy: { expiresAt: "desc" },
          take: 1,
          select: {
            id: true,
            expiresAt: true,
            usedAt: true,
          },
        },
      },
    }),
    prisma.branch.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  return Response.json({
    trips: trips.map((trip) => ({
      id: trip.id,
      tripCode: trip.tripCode,
      lrNumber: trip.lrNumber,
      origin: trip.origin,
      destination: trip.destination,
      freight: Number(trip.freight),
      status: trip.status,
      isHired: trip.isHired,
      createdAt: trip.createdAt.toISOString(),
      deliveredAt: trip.deliveredAt ? trip.deliveredAt.toISOString() : null,
      client: trip.client,
      branch: trip.branch,
      vehicle: trip.vehicle,
      driver: trip.driver,
      latestPod: trip.podSubmissions[0] ?? null,
      latestUploadLink: trip.uploadLinks[0] ?? null,
    })),
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
    meta: {
      branches,
      clients,
    },
  });
}

