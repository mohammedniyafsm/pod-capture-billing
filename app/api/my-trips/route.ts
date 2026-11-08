import { TripStatus, UserRole } from "@prisma/client";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { prisma } from "@/src/lib/prisma";

const requireDriver = requireRole(UserRole.DRIVER);

export async function GET(request: Request) {
  const auth = await requireDriver(request);
  if (!auth.ok) return auth.response;

  const trips = await prisma.trip.findMany({
    where: {
      driverId: auth.session.userId,
      status: {
        in: [
          TripStatus.ASSIGNED,
          TripStatus.IN_TRANSIT,
          TripStatus.POD_PENDING,
          TripStatus.AI_CHECKING,
          TripStatus.RETAKE_REQUESTED,
          TripStatus.NEEDS_REVIEW,
          TripStatus.VERIFIED,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tripCode: true,
      origin: true,
      destination: true,
      lrNumber: true,
      goodsDescription: true,
      expectedQuantity: true,
      quantityUnit: true,
      status: true,
      statusReason: true,
      retakeCount: true,
      startedAt: true,
      deliveredAt: true,
      createdAt: true,
      client: { select: { name: true } },
      podSubmissions: {
        orderBy: { attemptNo: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          retakeReason: true,
          attemptsLeft: true,
        },
      },
    },
  });

  return Response.json({ trips });
}
