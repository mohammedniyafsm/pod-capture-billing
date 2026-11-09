import ExcelJS from "exceljs";

export interface TallyExportTripItem {
  id: string;
  tripCode: string;
  lrNumber: string;
  ewayBillNo: string;
  origin: string;
  destination: string;
  vehicleNo: string;
  freight: number;
  goodsDescription: string;
  expectedQuantity: number;
  deliveredQuantity: number | null;
  quantityUnit: string;
  date: Date; // delivery or verified date
  podFileName: string; // e.g. "LR123_TRIP01.jpg" or "MISSING"
}

export interface TallyExportBatchMetadata {
  batchId?: string;
  clientName: string;
  tallyLedgerName: string;
  cycleLabel: string;
  exportedBy: string;
  exportedAt: Date;
  missingPodCount: number;
}

/**
 * DPDP Act 2023 Compliance & Security Notice:
 * 1. Personal Identifiable Information (PII) such as Consignee Name and Consignee Phone
 *    MUST NEVER be included in accounting exports. Only business logistics data is exported.
 * 2. Formula Injection Prevention: Text fields must neutralize leading '=', '+', '-', or '@'.
 */
export function sanitizeTallyText(val: string | null | undefined): string {
  if (!val) return "";
  const trimmed = String(val).trim();
  // Neutralize formula injection
  if (/^[=+\-@]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Sanitizes vehicle registration numbers:
 * Removes extraneous annotations like "(hired)", "- HIRED", etc., leaving only plate chars.
 */
export function sanitizeVehiclePlate(vehicleNo: string | null | undefined): string {
  if (!vehicleNo) return "";
  return sanitizeTallyText(
    vehicleNo
      .replace(/\s*\([^)]*hired[^)]*\)/gi, "")
      .replace(/\s*-\s*hired/gi, "")
      .replace(/\s*hired/gi, "")
      .trim()
  );
}

export async function buildTallyWorkbook(
  trips: TallyExportTripItem[],
  meta: TallyExportBatchMetadata,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Haulmark Operations";
  workbook.lastModifiedBy = meta.exportedBy;
  workbook.created = meta.exportedAt;
  workbook.modified = meta.exportedAt;

  // 1. Sheet 1: Tally Import
  const sheet = workbook.addWorksheet("Tally Import", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Party Ledger Name", key: "partyLedger", width: 32 },
    { header: "Voucher No", key: "voucherNo", width: 18 },
    { header: "LR No", key: "lrNo", width: 20 },
    { header: "E-way Bill No", key: "ewayBillNo", width: 18 },
    { header: "Vehicle No", key: "vehicleNo", width: 16 },
    { header: "Route", key: "route", width: 30 },
    { header: "Amount (INR)", key: "amount", width: 16 },
    { header: "Narration", key: "narration", width: 50 },
    { header: "POD File", key: "podFile", width: 28 },
  ];

  // Header styling: bold, #f3f5f6 fill, thin bottom border, Inter/Calibri 11
  const headerRow = sheet.getRow(1);
  headerRow.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF14181B" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F5F6" },
  };
  headerRow.border = {
    bottom: { style: "thin", color: { argb: "FFE3E6E8" } },
  };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 24;

  // Populate data rows
  trips.forEach((trip) => {
    const routeText = `${sanitizeTallyText(trip.origin)} to ${sanitizeTallyText(trip.destination)}`;
    const deliveredQty = trip.deliveredQuantity ?? trip.expectedQuantity;
    const narrationText = sanitizeTallyText(
      `${trip.goodsDescription}; delivered quantity ${deliveredQty} ${trip.quantityUnit}`
    );

    const row = sheet.addRow({
      date: trip.date,
      partyLedger: sanitizeTallyText(meta.tallyLedgerName),
      voucherNo: sanitizeTallyText(trip.tripCode),
      lrNo: sanitizeTallyText(trip.lrNumber),
      ewayBillNo: sanitizeTallyText(trip.ewayBillNo),
      vehicleNo: sanitizeVehiclePlate(trip.vehicleNo),
      route: routeText,
      amount: Number(trip.freight),
      narration: narrationText,
      podFile: sanitizeTallyText(trip.podFileName),
    });

    // Formatting per cell
    // Date: dd-mm-yyyy
    const dateCell = row.getCell("date");
    dateCell.numFmt = "dd-mm-yyyy";

    // LR & E-way Bill: explicit string with text format "@"
    const lrCell = row.getCell("lrNo");
    lrCell.numFmt = "@";

    const ewayCell = row.getCell("ewayBillNo");
    ewayCell.numFmt = "@";

    // Amount: number formatted with 2 decimals
    const amountCell = row.getCell("amount");
    amountCell.numFmt = "#,##0.00";
    amountCell.alignment = { horizontal: "right" };

    // Narration: wrap text
    const narrationCell = row.getCell("narration");
    narrationCell.alignment = { wrapText: true };

    // Font styling
    row.font = { name: "Calibri", size: 11, color: { argb: "FF14181B" } };
  });

  // Enable Auto-filter on header
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  // 2. Sheet 2: Summary (Keeps Tally Import range completely clean of total rows)
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Field", key: "field", width: 24 },
    { header: "Value", key: "value", width: 40 },
  ];

  const summaryHeader = summarySheet.getRow(1);
  summaryHeader.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF14181B" } };
  summaryHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F5F6" },
  };
  summaryHeader.height = 24;

  const totalAmount = trips.reduce((sum, t) => sum + Number(t.freight), 0);

  const summaryRows = [
    { field: "Batch ID", value: meta.batchId ?? "Generated on-demand" },
    { field: "Client Name", value: meta.clientName },
    { field: "Tally Ledger", value: meta.tallyLedgerName },
    { field: "Billing Cycle", value: meta.cycleLabel },
    { field: "Total Trips", value: trips.length },
    { field: "Total Freight (INR)", value: totalAmount },
    { field: "Exported By", value: meta.exportedBy },
    { field: "Exported At", value: meta.exportedAt.toISOString() },
    { field: "Missing POD Images", value: meta.missingPodCount },
    {
      field: "Tally Import Note",
      value: "Import the 'Tally Import' sheet into Tally / ERP. The Summary sheet is for internal audit.",
    },
  ];

  summaryRows.forEach((item) => {
    const r = summarySheet.addRow(item);
    r.font = { name: "Calibri", size: 11 };
    if (item.field === "Total Freight (INR)") {
      r.getCell("value").numFmt = "₹#,##0.00";
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

