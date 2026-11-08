import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { getExportStorage } from "@/src/lib/billing/export/exportStorage";
import { prisma } from "@/src/lib/prisma";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const idSchema = z.uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const { batchId } = await context.params;
  if (!idSchema.safeParse(batchId).success) {
    return Response.json(
      { error: "Export batch ID is invalid.", code: "validation_error" },
      { status: 400 },
    );
  }
  const batch = await prisma.exportBatch.findUnique({
    where: { id: batchId },
    select: { fileKey: true, cycleLabel: true },
  });
  if (!batch) {
    return Response.json(
      { error: "Export batch not found.", code: "export_not_found" },
      { status: 404 },
    );
  }
  const archive = await getExportStorage().read(batch.fileKey);
  if (!archive) {
    return Response.json(
      { error: "Export archive not found.", code: "archive_not_found" },
      { status: 404 },
    );
  }
  return new Response(archive, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="tally-export-${batch.cycleLabel}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
