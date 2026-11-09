import { UserRole } from "@prisma/client";
import { unzipSync } from "fflate";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/rbac/requireRole";
import { getExportStorage } from "@/src/lib/billing/export/exportStorage";
import { BRAND } from "@/src/lib/brand";
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

  const url = new URL(request.url);
  const format = url.searchParams.get("format"); // "xlsx" | "csv" | undefined (zip)

  const batch = await prisma.exportBatch.findUnique({
    where: { id: batchId },
    select: {
      fileKey: true,
      cycleLabel: true,
      exportedAt: true,
      client: { select: { name: true } },
    },
  });
  if (!batch) {
    return Response.json(
      { error: "Export batch not found.", code: "export_not_found" },
      { status: 404 },
    );
  }
  const stream = await getExportStorage().read(batch.fileKey);
  if (!stream) {
    return Response.json(
      { error: "Export archive not found.", code: "archive_not_found" },
      { status: 404 },
    );
  }

  const archiveBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const safeClient = (batch.client?.name ?? "client").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 20);
  const safeCycle = batch.cycleLabel.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 24);
  const yyyymmdd = new Date(batch.exportedAt).toISOString().slice(0, 10).replace(/-/g, "");

  // If specific format requested, extract from ZIP archive
  if (format === "xlsx" || format === "csv") {
    try {
      const files = unzipSync(archiveBytes);
      const targetExtension = format === "xlsx" ? ".xlsx" : ".csv";
      const targetName = Object.keys(files).find((name) => name.toLowerCase().endsWith(targetExtension));

      if (targetName && files[targetName]) {
        const fileBytes = files[targetName];
        const contentType =
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8";
        const downloadFilename = `Haulmark_Tally_${safeClient}_${safeCycle}.${format}`;

        return new Response(fileBytes as unknown as BodyInit, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${downloadFilename}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    } catch {
      // Fallback to serving the full zip archive
    }
  }

  const zipFilename = `Haulmark_Tally_${safeClient}_${safeCycle}_${yyyymmdd}.zip`;

  return new Response(archiveBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
