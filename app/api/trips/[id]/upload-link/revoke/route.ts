import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { revokeUploadLink } from "../../../../../../src/lib/pods/links/uploadLinks";
import { prisma } from "../../../../../../src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const tripIdSchema = z.uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!tripIdSchema.safeParse(id).success) {
    return Response.json(
      { error: "Trip ID is invalid.", code: "validation_error" },
      { status: 400 },
    );
  }

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { id: true, isHired: true },
  });

  if (!trip) {
    return Response.json(
      { error: "Trip not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }

  if (!trip.isHired) {
    return Response.json(
      {
        error: "Upload links can only be revoked for hired-vehicle trips.",
        code: "not_hired_trip",
      },
      { status: 400 },
    );
  }

  const revoked = await revokeUploadLink(trip.id);

  if (revoked) {
    await prisma.auditLog.create({
      data: {
        userId: auth.session.userId,
        action: "UPLOAD_LINK_REVOKED",
        entity: "Trip",
        entityId: trip.id,
      },
    });
  }

  return Response.json({
    success: true,
    message: revoked
      ? "Upload link revoked successfully."
      : "No active upload link found to revoke.",
    revoked,
  });
}

