import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/requireRole";
import { transitionDriverTrip } from "@/src/lib/trips/driverLifecycle";

const requireDriver = requireRole(UserRole.DRIVER);
const tripIdSchema = z.uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDriver(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!tripIdSchema.safeParse(id).success) {
    return Response.json(
      { error: "Trip ID is invalid.", code: "validation_error" },
      { status: 400 },
    );
  }

  const result = await transitionDriverTrip(
    id,
    auth.session.userId,
    "start",
  );
  
  if (!result.ok) {
    return Response.json(
      {
        error:
          result.code === "trip_not_found"
            ? "Trip not found."
            : "Trip cannot be started from its current status.",
        code: result.code,
        ...(result.currentStatus ? { currentStatus: result.currentStatus } : {}),
      },
      { status: result.code === "trip_not_found" ? 404 : 409 },
    );
  }

  return Response.json({
    tripId: id,
    status: result.status,
    startedAt: result.timestamp.toISOString(),
  });
}
