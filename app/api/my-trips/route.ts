import { TripStatus, UserRole } from "@prisma/client";
import { requireRole } from "@/src/lib/auth/requireRole";
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
          TripStatus.POD_PENDING,
          TripStatus.RETAKE_REQUESTED,
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
      createdAt: true,
      client: { select: { name: true } },
    },
  });

  return Response.json({ trips });
}
