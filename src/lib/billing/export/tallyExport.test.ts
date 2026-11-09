import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildTallyWorkbook,
  sanitizeTallyText,
  sanitizeVehiclePlate,
  type TallyExportTripItem,
  type TallyExportBatchMetadata,
} from "./tallyExport";

describe("Tally XLSX and Row Sanitization", () => {
  it("neutralizes formula injection on text fields starting with =, +, -, @", () => {
    expect(sanitizeTallyText("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeTallyText("+123456")).toBe("'+123456");
    expect(sanitizeTallyText("-45.20")).toBe("'-45.20");
    expect(sanitizeTallyText("@command")).toBe("'@command");
    expect(sanitizeTallyText("Normal Text")).toBe("Normal Text");
    expect(sanitizeTallyText("")).toBe("");
  });

  it("strips (hired) or extraneous annotations from vehicle plates", () => {
    expect(sanitizeVehiclePlate("MH12 AB 2201 (hired)")).toBe("MH12 AB 2201");
    expect(sanitizeVehiclePlate("MH15 DL 5505 - Hired")).toBe("MH15 DL 5505");
    expect(sanitizeVehiclePlate("MH12 AB 2201")).toBe("MH12 AB 2201");
    expect(sanitizeVehiclePlate("=MH12 0001")).toBe("'=MH12 0001");
  });

  it("builds a typed XLSX workbook with frozen headers, string IDs, numeric amount, and Summary sheet", async () => {
    const mockTrips: TallyExportTripItem[] = [
      {
        id: "trip-1",
        tripCode: "TRIP-1001",
        lrNumber: "LR-987654321012",
        ewayBillNo: "883019284756", // 12 digit e-way bill
        origin: "Pune",
        destination: "Mumbai",
        vehicleNo: "MH12 AB 2201 (hired)",
        freight: 42500.5,
        goodsDescription: "FMCG Personal Care",
        expectedQuantity: 500,
        deliveredQuantity: 498,
        quantityUnit: "cartons",
        date: new Date("2026-11-03T10:00:00.000Z"),
        podFileName: "LR-987654321012_TRIP-1001.jpg",
      },
      {
        id: "trip-2",
        tripCode: "TRIP-1002",
        lrNumber: "LR-000000000002",
        ewayBillNo: "998877665544",
        origin: "Nagpur",
        destination: "Hyderabad",
        vehicleNo: "MH31 CD 8899",
        freight: 38000,
        goodsDescription: "Steel TMT Rebars",
        expectedQuantity: 20,
        deliveredQuantity: 20,
        quantityUnit: "tonnes",
        date: new Date("2026-11-04T12:00:00.000Z"),
        podFileName: "MISSING",
      },
    ];

    const mockMeta: TallyExportBatchMetadata = {
      batchId: "batch-1234-uuid",
      clientName: "Tata Consumer Products",
      tallyLedgerName: "Tata Consumer Products Ltd",
      cycleLabel: "WEEKLY-2026-11-02",
      exportedBy: "billing-exec-1",
      exportedAt: new Date("2026-11-09T12:00:00.000Z"),
      missingPodCount: 1,
    };

    const buffer = await buildTallyWorkbook(mockTrips, mockMeta);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);

    // Read back and assert structure
    const reader = new ExcelJS.Workbook();
    await reader.xlsx.load(buffer as any);

    // 1. Verify Sheets
    expect(reader.worksheets.map((s) => s.name)).toEqual(["Tally Import", "Summary"]);

    const importSheet = reader.getWorksheet("Tally Import");
    expect(importSheet).toBeDefined();

    // 2. Verify Column Headers & Order
    const expectedHeaders = [
      "Date",
      "Party Ledger Name",
      "Voucher No",
      "LR No",
      "E-way Bill No",
      "Vehicle No",
      "Route",
      "Amount (INR)",
      "Narration",
      "POD File",
    ];
    const headerRow = importSheet!.getRow(1);
    expectedHeaders.forEach((name, idx) => {
      expect(headerRow.getCell(idx + 1).value).toBe(name);
    });

    // 3. Verify Cell Types and Formatting
    const row1 = importSheet!.getRow(2);

    // E-way bill must be stored as string (not a number that converts to 8.83E+11)
    const ewayCell = row1.getCell(5);
    expect(ewayCell.value).toBe("883019284756");
    expect(typeof ewayCell.value).toBe("string");
    expect(ewayCell.numFmt).toBe("@");

    // LR must be stored as string
    const lrCell = row1.getCell(4);
    expect(lrCell.value).toBe("LR-987654321012");
    expect(typeof lrCell.value).toBe("string");

    // Vehicle plate must have (hired) stripped
    const vehicleCell = row1.getCell(6);
    expect(vehicleCell.value).toBe("MH12 AB 2201");

    // Amount must be stored as number with 2 decimals
    const amountCell = row1.getCell(8);
    expect(amountCell.value).toBe(42500.5);
    expect(typeof amountCell.value).toBe("number");
    expect(amountCell.numFmt).toBe("#,##0.00");

    // Route uses "to" instead of arrow
    const routeCell = row1.getCell(7);
    expect(routeCell.value).toBe("Pune to Mumbai");

    // POD File name or MISSING
    const podCell = row1.getCell(10);
    expect(podCell.value).toBe("LR-987654321012_TRIP-1001.jpg");

    const row2 = importSheet!.getRow(3);
    expect(row2.getCell(10).value).toBe("MISSING");

    // 4. Verify Summary Sheet
    const summarySheet = reader.getWorksheet("Summary");
    expect(summarySheet).toBeDefined();
    expect(summarySheet!.getCell("A2").value).toBe("Batch ID");
    expect(summarySheet!.getCell("B2").value).toBe("batch-1234-uuid");
    expect(summarySheet!.getCell("A7").value).toBe("Total Freight (INR)");
    expect(summarySheet!.getCell("B7").value).toBe(80500.5);
    expect(summarySheet!.getCell("A10").value).toBe("Missing POD Images");
    expect(summarySheet!.getCell("B10").value).toBe(1);
  });
});

