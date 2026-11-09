"use client";

import { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import { formatCurrency, formatNumber } from "@/src/lib/fleetproof";

type PreviewRow = {
  rowNumber: number;
  status: "READY" | "DUPLICATE" | "ERROR";
  reason?: string;
  tripCode: string;
  client: string;
  vehicleNo: string;
  origin: string;
  destination: string;
  freight: string | number;
  lrNumber: string;
  ewayBillNo: string;
  isHired: boolean;
};

type PreviewResponse = {
  preview: boolean;
  filename: string;
  counts: {
    total: number;
    ready: number;
    duplicates: number;
    errors: number;
  };
  rows: PreviewRow[];
  errors: Array<{ row: number; reason: string }>;
};

type ImportResponse = {
  success: boolean;
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
  filename: string;
};

const SAMPLE_CSV_CONTENT = `trip_code,client,vehicle_no,is_hired,origin,destination,freight,lr_number,eway_bill_no,goods,quantity,unit,branch,driver_phone
TRIP-SAMPLE-001,Sahyadri Cements Ltd,MH20 EL 4521,false,Chhatrapati Sambhajinagar,Mumbai,34500,LR-SMP-001,261199990001,Portland Pozzolana Cement,25,tonnes,Chh. Sambhajinagar,9000000001
TRIP-SAMPLE-002,KisanAgro Foods & Grains,MH20 FN 6101,true,Jalna,Kolhapur,36000,LR-SMP-002,261199990002,Refined Wheat Flour,500,bags,Chh. Sambhajinagar,9876543210`;

export default function TripImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV_CONTENT], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sample_trips_import.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadErrors = () => {
    if (!importResult && !previewData) return;
    const errors = importResult?.errors ?? previewData?.errors ?? [];
    if (errors.length === 0) return;

    let csv = "row_number,reason\n";
    for (const err of errors) {
      csv += `${err.row},"${err.reason.replace(/"/g, '""')}"\n`;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `import_errors_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const processFile = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith(".csv")) {
      setErrorMessage("Only .csv files are supported.");
      return;
    }
    if (selectedFile.size > 2 * 1024 * 1024) {
      setErrorMessage("File exceeds 2 MB limit.");
      return;
    }

    setFile(selectedFile);
    setErrorMessage(null);
    setPreviewData(null);
    setImportResult(null);

    const text = await selectedFile.text();
    setCsvContent(text);

    // Run preview validation immediately
    setIsValidating(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/trips/import?preview=true", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Validation failed.");
      }
      setPreviewData(data);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to preview CSV file.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      void processFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void processFile(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmImport = async () => {
    if (!file && !csvContent) return;
    setIsImporting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      }

      const res = await fetch("/api/trips/import", {
        method: "POST",
        body: file ? formData : csvContent,
        headers: file ? undefined : { "Content-Type": "text/csv" },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed.");
      }

      setImportResult(data);
      setPreviewData(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to complete import.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setCsvContent(null);
    setPreviewData(null);
    setImportResult(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="billing-page-heading">
        <div>
          <h1 className="billing-page-title">Daily trip import</h1>
          <p className="billing-page-description">
            Upload and validate daily dispatch CSV files before importing them into Haulmark.
          </p>
        </div>
        <button
          type="button"
          className="billing-button"
          onClick={handleDownloadSample}
        >
          Download sample CSV
        </button>
      </div>

      {/* Error state alert */}
      {errorMessage ? (
        <section className="billing-state is-error" role="alert">
          <p>{errorMessage}</p>
          <button type="button" className="billing-button mt-2" onClick={() => setErrorMessage(null)}>
            Dismiss
          </button>
        </section>
      ) : null}

      {/* Upload Box (when not yet confirmed) */}
      {!importResult ? (
        <section className="billing-panel p-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-[10px] p-8 text-center transition-colors ${
              isDragging ? "border-[#0B4044] bg-[#f3f7f7]" : "border-[#e3e6e8] bg-white hover:border-[#0B4044]/50"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="mx-auto flex max-w-sm flex-col items-center justify-center">
              <div className="mb-3 rounded-full bg-[#f3f7f7] p-3 text-[#0B4044]">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-neutral-900">
                {file ? file.name : "Drag & drop your CSV file here, or browse"}
              </p>
              <p className="mt-1 text-xs text-[#5f6b72]">
                Max 2 MB · Up to 1,000 trips · UTF-8 formatted CSV
              </p>
              <button
                type="button"
                className="billing-button billing-button-primary mt-4"
                disabled={isValidating || isImporting}
                onClick={() => fileInputRef.current?.click()}
              >
                {isValidating ? "Validating CSV…" : file ? "Choose different file" : "Browse files"}
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-[#e3e6e8] pt-4 text-xs text-[#5f6b72]">
            <span className="font-semibold text-neutral-900">Required CSV columns:</span>{" "}
            <code>trip_code, client, vehicle_no, is_hired, origin, destination, freight, lr_number, eway_bill_no, goods, quantity, unit, branch, driver_phone</code>
          </div>
        </section>
      ) : null}

      {/* Preview Section */}
      {previewData && !importResult ? (
        <section className="billing-panel space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e3e6e8] pb-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-900">
                File Validation Preview: {previewData.filename}
              </h2>
              <div className="mt-1 flex items-center gap-4 text-xs">
                <span className="font-medium text-emerald-700">
                  {formatNumber(previewData.counts.ready)} ready to import
                </span>
                <span className="font-medium text-amber-700">
                  {formatNumber(previewData.counts.duplicates)} duplicates (will be skipped)
                </span>
                <span className="font-medium text-red-700">
                  {formatNumber(previewData.counts.errors)} errors
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="billing-button"
                onClick={handleReset}
                disabled={isImporting}
              >
                Cancel
              </button>
              {previewData.counts.errors > 0 ? (
                <button
                  type="button"
                  className="billing-button"
                  onClick={handleDownloadErrors}
                >
                  Download error rows
                </button>
              ) : null}
              <button
                type="button"
                className="billing-button billing-button-primary"
                disabled={previewData.counts.ready === 0 || isImporting}
                onClick={() => void handleConfirmImport()}
              >
                {isImporting
                  ? "Importing trips…"
                  : `Import ${previewData.counts.ready} trip${previewData.counts.ready === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          {/* Table of Preview Rows */}
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Status</th>
                  <th scope="col">Trip Code</th>
                  <th scope="col">Client</th>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Hired</th>
                  <th scope="col">LR Number</th>
                  <th scope="col">E-way Bill</th>
                  <th scope="col">Route</th>
                  <th scope="col" className="billing-number">Freight</th>
                  <th scope="col">Diagnostic / Reason</th>
                </tr>
              </thead>
              <tbody>
                {previewData.rows.slice(0, 50).map((r) => (
                  <tr key={r.rowNumber} className={r.status === "ERROR" ? "bg-red-50/30" : undefined}>
                    <td className="font-medium text-neutral-900">{r.rowNumber}</td>
                    <td>
                      <span
                        className={`billing-status ${
                          r.status === "READY"
                            ? "is-success"
                            : r.status === "DUPLICATE"
                              ? "is-warning"
                              : "is-danger"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="font-medium text-neutral-900">{r.tripCode}</td>
                    <td>{r.client}</td>
                    <td>{r.vehicleNo}</td>
                    <td>{r.isHired ? "Yes" : "No"}</td>
                    <td>{r.lrNumber}</td>
                    <td>{r.ewayBillNo}</td>
                    <td>{r.origin} → {r.destination}</td>
                    <td className="billing-number">{r.freight ? formatCurrency(r.freight) : "—"}</td>
                    <td className="text-xs text-[#5f6b72] max-w-xs truncate" title={r.reason}>
                      {r.reason || "Valid"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewData.rows.length > 50 ? (
            <p className="text-xs text-[#5f6b72] text-center pt-2">
              Showing first 50 rows of {formatNumber(previewData.rows.length)} total rows.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Completed Import Result View */}
      {importResult ? (
        <section className="billing-panel space-y-4 p-6">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4">
            <h2 className="text-base font-semibold text-emerald-900">
              Import Completed Successfully
            </h2>
            <p className="mt-1 text-xs text-emerald-800">
              {formatNumber(importResult.imported)} trips created in Haulmark database.{" "}
              {importResult.skipped > 0 ? `${formatNumber(importResult.skipped)} duplicate rows were safely skipped.` : ""}
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="billing-button billing-button-primary"
                onClick={handleReset}
              >
                Import another CSV
              </button>
              {importResult.errors.length > 0 ? (
                <button
                  type="button"
                  className="billing-button"
                  onClick={handleDownloadErrors}
                >
                  Download {importResult.errors.length} error row{importResult.errors.length === 1 ? "" : "s"} as CSV
                </button>
              ) : null}
            </div>
            <a
              href="/billing/trips"
              className="billing-button"
            >
              View imported trips →
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}

