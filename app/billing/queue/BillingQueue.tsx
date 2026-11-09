"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  fetchJson,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@/src/lib/fleetproof";

type Branch = { id: string; name: string };
type BillingQueueTrip = {
  id: string;
  tripCode: string;
  lrNumber: string;
  destination: string;
  freight: number | string;
  deliveredAt: string | null;
  status: string;
  createdAt: string;
  branch: { name: string };
  vehicle: { vehicleNo: string };
};
type BillingQueueGroup = {
  client: { id: string; name: string; billingCycle: string; tallyLedgerName: string };
  cycleLabel: string;
  count: number;
  totalAmount: number;
  trips: BillingQueueTrip[];
};
type QueueFilters = { client: string; cycle: string; branch: string };
type QueueData = { groups: BillingQueueGroup[] };
type PanelState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "error"; message: string; data?: T };
type ExportResult = {
  batchId: string;
  cycleLabel: string;
  tripCount: number;
  downloadUrl: string;
};

function SkeletonQueue() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading billing queue">
      {[0, 1, 2].map((item) => (
        <div className="billing-panel p-4" key={item} aria-hidden="true">
          <div className="billing-skeleton-block h-5 w-48" />
          <div className="billing-skeleton-block mt-4 h-10 w-full" />
          <div className="billing-skeleton-block mt-2 h-10 w-full" />
          <div className="billing-skeleton-block mt-2 h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

function groupKey(group: BillingQueueGroup) {
  return `${group.client.id}:${group.cycleLabel}`;
}

async function downloadFile(urlStr: string, defaultFilename: string) {
  const url = new URL(urlStr, window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error("The export download URL is not on this application.");
  }
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "The export was created, but the file could not be downloaded.",
    );
  }

  // Extract filename from Content-Disposition if present
  let filename = defaultFilename;
  const disposition = response.headers.get("Content-Disposition");
  if (disposition && disposition.includes("filename=")) {
    const match = /filename=["']?([^"';]+)["']?/.exec(disposition);
    if (match?.[1]) {
      filename = match[1];
    }
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

export default function BillingQueuePage({
  initialFilters,
}: {
  initialFilters: QueueFilters;
}) {
  const router = useRouter();
  const [queueState, setQueueState] = useState<PanelState<QueueData>>({
    status: "loading",
  });
  const [branchesState, setBranchesState] = useState<PanelState<Branch[]>>({
    status: "loading",
  });
  const [draftClient, setDraftClient] = useState(initialFilters.client);
  const [draftCycle, setDraftCycle] = useState(initialFilters.cycle);
  const [draftBranch, setDraftBranch] = useState(initialFilters.branch);
  const [filters, setFilters] = useState(initialFilters);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTrips, setSelectedTrips] = useState<Record<string, Set<string>>>({});
  const [exportingGroup, setExportingGroup] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextFilters = {
        client: params.get("client") ?? "",
        cycle: params.get("cycle") ?? "",
        branch: params.get("branch") ?? "",
      };
      setDraftClient(nextFilters.client);
      setDraftCycle(nextFilters.cycle);
      setDraftBranch(nextFilters.branch);
      setQueueState((current) => ({ status: "loading", data: current.data }));
      setFilters(nextFilters);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    let active = true;
    void fetchJson<{ branches: Branch[] }>("/api/dashboard?range=7d")
      .then((payload) => {
        if (active) setBranchesState({ status: "ready", data: payload.branches });
      })
      .catch((error: unknown) => {
        if (active) {
          setBranchesState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Unable to load branch options.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (filters.client.trim()) params.set("client", filters.client.trim());
    if (filters.cycle) params.set("cycle", filters.cycle);
    if (filters.branch) params.set("branch", filters.branch);
    void fetchJson<QueueData>(
      `/api/billing/queue${params.size ? `?${params}` : ""}`,
    )
      .then((payload) => {
        if (active) {
          setQueueState({ status: "ready", data: payload });
          setSelectedTrips({});
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setQueueState((current) => ({
            status: "error",
            message:
              error instanceof Error ? error.message : "Unable to load billing queue.",
            data: current.data,
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  const groups = queueState.data?.groups ?? [];
  const selectedCount = useMemo(
    () =>
      Object.values(selectedTrips).reduce((total, ids) => total + ids.size, 0),
    [selectedTrips],
  );

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextFilters = {
      client: draftClient.trim(),
      cycle: draftCycle,
      branch: draftBranch,
    };
    setQueueState((current) => ({ status: "loading", data: current.data }));
    setFilters(nextFilters);
    setSelectedTrips({});
    const params = new URLSearchParams();
    if (nextFilters.client) params.set("client", nextFilters.client);
    if (nextFilters.cycle) params.set("cycle", nextFilters.cycle);
    if (nextFilters.branch) params.set("branch", nextFilters.branch);
    router.push(
      `/billing/queue${params.size ? `?${params}` : ""}`,
      { scroll: false },
    );
  };

  const refreshQueue = () => {
    setQueueState((current) => ({ status: "loading", data: current.data }));
    setRefreshKey((key) => key + 1);
  };

  const toggleTrip = (group: BillingQueueGroup, tripId: string, checked: boolean) => {
    const key = groupKey(group);
    setSelectedTrips((current) => {
      const next = new Set(current[key] ?? []);
      if (checked) next.add(tripId);
      else next.delete(tripId);
      return { ...current, [key]: next };
    });
  };

  const toggleAllTrips = (group: BillingQueueGroup, checked: boolean) => {
    setSelectedTrips((current) => ({
      ...current,
      [groupKey(group)]: checked
        ? new Set(group.trips.map((trip) => trip.id))
        : new Set(),
    }));
  };

  const startDownload = async (result: ExportResult, format?: "xlsx" | "csv") => {
    setExportError(null);
    setIsDownloading(true);
    try {
      const url = format ? `${result.downloadUrl}?format=${format}` : result.downloadUrl;
      const defaultFilename = `Haulmark_Tally_${result.cycleLabel}.${format ?? "zip"}`;
      await downloadFile(url, defaultFilename);
      setExportMessage(
        `Downloaded ${result.tripCount} trip${result.tripCount === 1 ? "" : "s"} for ${result.cycleLabel}${format ? ` (${format.toUpperCase()})` : ""}.`,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "The export was created, but its file could not be downloaded.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const exportGroup = async (group: BillingQueueGroup, format?: "xlsx" | "csv") => {
    const tripIds = [...(selectedTrips[groupKey(group)] ?? [])];
    if (!tripIds.length) return;
    setExportError(null);
    setExportMessage(null);
    setExportingGroup(groupKey(group));
    let createdExport: ExportResult | null = null;
    try {
      createdExport = await fetchJson<ExportResult>("/api/billing/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripIds }),
      });
      setLastExport(createdExport);
      setQueueState((current) => ({ status: "loading", data: current.data }));
      setRefreshKey((key) => key + 1);
      setSelectedTrips({});
      await startDownload(createdExport, format);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? createdExport
            ? `Export ${createdExport.batchId} was created, but the download failed. ${error.message}`
            : error.message
          : "Unable to create the export batch.",
      );
    } finally {
      setExportingGroup(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="billing-page-heading">
        <div>
          <h1 className="billing-page-title">Billing queue</h1>
          <p className="billing-page-description">
            Select verified trips within one client billing window to create a Tally export.
          </p>
        </div>
        <button
          type="button"
          className="billing-button"
          disabled={queueState.status === "loading"}
          onClick={refreshQueue}
        >
          {queueState.status === "loading" ? "Refreshing queue…" : "Refresh queue"}
        </button>
      </div>

      <form className="billing-filter-bar" onSubmit={applyFilters}>
        <label className="billing-filter">
          <span className="billing-filter-label">Client name or ID</span>
          <input
            className="billing-input"
            type="search"
            value={draftClient}
            onChange={(event) => setDraftClient(event.target.value)}
            placeholder="Enter an exact client name or ID"
            maxLength={100}
          />
        </label>
        <label className="billing-filter">
          <span className="billing-filter-label">Billing cycle</span>
          <select
            className="billing-select"
            value={draftCycle}
            onChange={(event) => setDraftCycle(event.target.value)}
          >
            <option value="">All cycles</option>
            <option value="WEEKLY">Weekly</option>
            <option value="FORTNIGHTLY">Fortnightly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </label>
        <label className="billing-filter">
          <span className="billing-filter-label">Branch</span>
          <select
            className="billing-select"
            value={draftBranch}
            disabled={branchesState.status !== "ready"}
            onChange={(event) => setDraftBranch(event.target.value)}
          >
            <option value="">All branches</option>
            {branchesState.status === "ready"
              ? branchesState.data.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))
              : null}
          </select>
        </label>
        <button type="submit" className="billing-button billing-button-primary">
          Apply filters
        </button>
        {branchesState.status === "error" ? (
          <p className="billing-inline-error" role="alert">
            Branch options unavailable: {branchesState.message}
          </p>
        ) : null}
      </form>

      {exportError ? (
        <section className="billing-state is-error" role="alert">
          <p>{exportError}</p>
          {lastExport ? (
            <button
              type="button"
              className="billing-button"
              disabled={isDownloading}
              onClick={() => void startDownload(lastExport)}
            >
              {isDownloading ? "Downloading…" : `Retry download ${lastExport.batchId}`}
            </button>
          ) : null}
        </section>
      ) : null}
      {exportMessage ? <p className="billing-state is-success" role="status">{exportMessage}</p> : null}
      {queueState.status === "error" && queueState.data ? (
        <section className="billing-state is-error" role="alert">
          <p>{queueState.message} Showing the last loaded queue.</p>
          <button type="button" className="billing-button" onClick={refreshQueue}>Retry queue</button>
        </section>
      ) : null}

      {queueState.status === "loading" && !queueState.data ? (
        <SkeletonQueue />
      ) : queueState.status === "error" && !queueState.data ? (
        <section className="billing-state is-error" role="alert">
          <p>{queueState.message}</p>
          <button type="button" className="billing-button" onClick={refreshQueue}>Try again</button>
        </section>
      ) : groups.length === 0 ? (
        <section
          className={`billing-panel billing-empty${queueState.status === "loading" ? " is-refreshing" : ""}`}
          aria-busy={queueState.status === "loading"}
          role="status"
        >
          No verified trips are ready for billing with these filters.
        </section>
      ) : (
        <div
          className={`billing-queue-results${queueState.status === "loading" ? " is-refreshing" : ""}`}
          aria-busy={queueState.status === "loading"}
        >
          <p className="billing-selection-summary" aria-live="polite">
            {formatNumber(selectedCount)} trip{selectedCount === 1 ? "" : "s"} selected. Each client and billing window is exported separately.
          </p>
          {groups.map((group) => {
            const key = groupKey(group);
            const selected = selectedTrips[key] ?? new Set<string>();
            const allSelected =
              group.trips.length > 0 && selected.size === group.trips.length;
            const selectedAmount = group.trips
              .filter((trip) => selected.has(trip.id))
              .reduce((total, trip) => total + Number(trip.freight), 0);
            return (
              <section className="billing-panel billing-queue-group" key={key}>
                <div className="billing-panel-heading">
                  <div>
                    <h2 className="billing-panel-title">{group.client.name}</h2>
                    <p className="billing-panel-description">
                      {group.cycleLabel} · {formatNumber(group.count)} trips ·{" "}
                      {formatCurrency(group.totalAmount)} total freight
                    </p>
                    <p className="billing-panel-description">
                      Tally ledger: {group.client.tallyLedgerName}
                    </p>
                  </div>
                </div>
                <div className="billing-table-wrap">
                  <table className="billing-table">
                    <caption className="billing-sr-only">
                      Verified trips for {group.client.name}, {group.cycleLabel}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">
                          <label>
                            <span className="billing-sr-only">
                              Select all trips for {group.client.name}, {group.cycleLabel}
                            </span>
                            <input
                              className="billing-checkbox"
                              type="checkbox"
                              checked={allSelected}
                              disabled={queueState.status === "loading"}
                              onChange={(event) => toggleAllTrips(group, event.target.checked)}
                            />
                          </label>
                        </th>
                        <th scope="col">Trip</th>
                        <th scope="col">LR</th>
                        <th scope="col">Branch</th>
                        <th scope="col">Vehicle</th>
                        <th scope="col">Destination</th>
                        <th scope="col" className="billing-number">Freight</th>
                        <th scope="col">Delivered</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.trips.map((trip) => (
                        <tr key={trip.id}>
                          <td>
                            <label>
                              <span className="billing-sr-only">Select trip {trip.tripCode}</span>
                              <input
                                className="billing-checkbox"
                                type="checkbox"
                                checked={selected.has(trip.id)}
                                disabled={queueState.status === "loading"}
                                onChange={(event) => toggleTrip(group, trip.id, event.target.checked)}
                              />
                            </label>
                          </td>
                          <td className="font-medium text-neutral-900">{trip.tripCode}</td>
                          <td>{trip.lrNumber}</td>
                          <td>{trip.branch.name}</td>
                          <td>{trip.vehicle.vehicleNo}</td>
                          <td>{trip.destination}</td>
                          <td className="billing-number">{formatCurrency(trip.freight)}</td>
                          <td>{formatDate(trip.deliveredAt)}</td>
                          <td><span className="billing-status is-success">{trip.status.replaceAll("_", " ")}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="billing-batch-toolbar">
                  <span className="billing-panel-description">
                    {formatNumber(selected.size)} selected · {formatCurrency(selectedAmount)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="billing-button billing-button-primary"
                      disabled={
                        selected.size === 0 ||
                        exportingGroup !== null ||
                        queueState.status === "loading"
                      }
                      onClick={() => void exportGroup(group, "xlsx")}
                    >
                      {exportingGroup === key
                        ? "Exporting…"
                        : `Export Excel (.xlsx)`}
                    </button>
                    <button
                      type="button"
                      className="billing-button"
                      title="Download clean CSV for direct Tally import"
                      disabled={
                        selected.size === 0 ||
                        exportingGroup !== null ||
                        queueState.status === "loading"
                      }
                      onClick={() => void exportGroup(group, "csv")}
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      className="billing-button"
                      title="Download complete ZIP containing XLSX, CSV and all attached POD images"
                      disabled={
                        selected.size === 0 ||
                        exportingGroup !== null ||
                        queueState.status === "loading"
                      }
                      onClick={() => void exportGroup(group)}
                    >
                      Export ZIP (with PODs)
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
