"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  fetchJson,
  formatCurrency,
  formatDate,
  formatNumber,
} from "@/src/lib/fleetproof";

type Branch = { id: string; name: string };
type Client = { id: string; name: string };

type TripListItem = {
  id: string;
  tripCode: string;
  lrNumber: string;
  origin: string;
  destination: string;
  freight: number;
  status: string;
  isHired: boolean;
  createdAt: string;
  deliveredAt: string | null;
  client: Client | null;
  branch: Branch | null;
  vehicle: { vehicleNo: string; isHired: boolean } | null;
  driver: { id: string; name: string; phone: string | null } | null;
  driverPhone?: string | null;
  latestPod: {
    id: string;
    status: string;
    uploadedAt: string;
    attemptNo: number;
  } | null;
  latestUploadLink: {
    id: string;
    expiresAt: string;
    usedAt: string | null;
  } | null;
};

type PodSubmissionDetail = {
  id: string;
  attemptNo: number;
  uploadedAt: string;
  status: string;
  retakeReason: string | null;
  imageUrl?: { url: string; expiresInSeconds: number };
  extraction?: {
    verdict: string;
    reasons: string[];
    fields: Record<string, unknown>;
  } | null;
};

type TripDetail = {
  id: string;
  tripCode: string;
  lrNumber: string;
  ewayBillNo: string;
  origin: string;
  destination: string;
  goodsDescription: string;
  freight: number;
  expectedQuantity: number;
  deliveredQuantity: number | null;
  quantityUnit: string;
  status: string;
  statusReason: string | null;
  isHired: boolean;
  createdAt: string;
  startedAt: string | null;
  deliveredAt: string | null;
  podReceivedAt: string | null;
  verifiedAt: string | null;
  invoicedAt: string | null;
  client: { id: string; name: string; tallyLedgerName?: string } | null;
  branch: Branch | null;
  vehicle: { vehicleNo: string; isHired: boolean } | null;
  driver: { id: string; name: string; phone: string | null } | null;
  driverPhone?: string | null;
  podSubmissions: PodSubmissionDetail[];
  uploadLink?: {
    id?: string;
    status: "NOT_GENERATED" | "ACTIVE" | "EXPIRED" | "USED" | "REVOKED";
    expiresAt: string | null;
    usedAt: string | null;
  };
};

type FilterState = {
  search: string;
  clientId: string;
  branchId: string;
  vehicleType: string;
  podStatus: string;
  preset: string;
  from: string;
  to: string;
  page: number;
};

function statusBadgeClass(status: string) {
  switch (status) {
    case "VERIFIED":
    case "INVOICED":
      return "billing-status is-success";
    case "NEEDS_REVIEW":
    case "POD_PENDING":
    case "ASSIGNED":
    case "IN_TRANSIT":
      return "billing-status is-warning";
    case "RETAKE_REQUESTED":
    case "DISPUTED":
      return "billing-status is-danger";
    default:
      return "billing-status";
  }
}

function displayStatus(status: string) {
  return status.replace(/_/g, " ");
}

function shortenCity(city: string): string {
  const trimmed = city.trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes("chhatrapati sambhajinagar") || lower.includes("sambhajinagar") || lower.includes("aurangabad")) {
    return "Sambhajinagar";
  }
  return trimmed;
}

function formatRoute(origin: string, destination: string): string {
  const o = shortenCity(origin);
  const d = shortenCity(destination);
  return `${o} → ${d}`;
}

function formatTripDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTripFreight(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return String(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(num);
}

export default function TripsManagementPage({
  initialFilters,
}: {
  initialFilters: FilterState;
}) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    totalCount: 0,
    totalPages: 1,
    hasMore: false,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected trip for drawer detail view
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [detailTrip, setDetailTrip] = useState<TripDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Hired driver link action states
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [linkActionLoading, setLinkActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const applyPreset = (preset: string) => {
    const now = new Date();
    let from = "";
    let to = "";

    if (preset === "TODAY") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      from = start.toISOString();
      to = end.toISOString();
    } else if (preset === "LAST_7D") {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      from = start.toISOString();
      to = now.toISOString();
    } else if (preset === "LAST_30D") {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      from = start.toISOString();
      to = now.toISOString();
    } else if (preset === "THIS_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      from = start.toISOString();
      to = now.toISOString();
    } else if (preset === "LAST_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      from = start.toISOString();
      to = end.toISOString();
    } else if (preset === "THIS_YEAR") {
      const start = new Date(now.getFullYear(), 0, 1);
      from = start.toISOString();
      to = now.toISOString();
    }

    setFilters((prev) => ({
      ...prev,
      preset,
      from,
      to,
      page: 1,
    }));
  };

  // Fetch Trips
  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.clientId) params.set("clientId", filters.clientId);
      if (filters.branchId) params.set("branchId", filters.branchId);
      if (filters.vehicleType && filters.vehicleType !== "ALL") {
        params.set("vehicleType", filters.vehicleType);
      }
      if (filters.podStatus) params.set("podStatus", filters.podStatus);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      params.set("page", String(filters.page));
      params.set("limit", "20");

      const res = await fetchJson<{
        trips: TripListItem[];
        pagination: typeof pagination;
        meta: { branches: Branch[]; clients: Client[] };
      }>(`/api/trips?${params.toString()}`);

      setTrips(res.trips);
      setPagination(res.pagination);
      setBranches(res.meta.branches);
      setClients(res.meta.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trips.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchTrips();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchTrips]);

  // Fetch Detail for Drawer
  const fetchTripDetail = useCallback(async (tripId: string, preserveGeneratedUrl = false) => {
    setDetailLoading(true);
    setDetailError(null);
    if (!preserveGeneratedUrl) {
      setGeneratedUrl(null);
    }
    try {
      const res = await fetchJson<{ trip: TripDetail }>(`/api/trips/${tripId}`);
      setDetailTrip(res.trip);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "Unable to load trip details.",
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openTripDetail = (id: string) => {
    setSelectedTripId(id);
    void fetchTripDetail(id);
  };

  const closeTripDetail = () => {
    setSelectedTripId(null);
    setDetailTrip(null);
    setGeneratedUrl(null);
  };

  // Generate Link
  const handleGenerateLink = async () => {
    if (!detailTrip) return;
    setLinkActionLoading(true);
    try {
      const res = await fetchJson<{
        success: boolean;
        link: { id: string; uploadUrl: string; expiresAt: string };
      }>(`/api/trips/${detailTrip.id}/upload-link`, {
        method: "POST",
      });

      setGeneratedUrl(res.link.uploadUrl);
      showToast("Hired driver upload link generated!");
      // Refresh details while preserving the raw URL in memory
      await fetchTripDetail(detailTrip.id, true);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to generate link.",
        "error",
      );
    } finally {
      setLinkActionLoading(false);
    }
  };

  // Revoke Link
  const handleRevokeLink = async () => {
    if (!detailTrip) return;
    if (!window.confirm("Are you sure you want to revoke this upload link?")) {
      return;
    }
    setLinkActionLoading(true);
    try {
      await fetchJson<{ success: boolean }>(
        `/api/trips/${detailTrip.id}/upload-link/revoke`,
        { method: "POST" },
      );
      setGeneratedUrl(null);
      showToast("Upload link revoked.");
      await fetchTripDetail(detailTrip.id);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to revoke link.",
        "error",
      );
    } finally {
      setLinkActionLoading(false);
    }
  };

  // Copy Link
  const handleCopyLink = async (url: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("Upload link copied to clipboard!");
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        showToast("Upload link copied to clipboard!");
      }
    } catch {
      showToast("Could not copy automatically. Please copy manually.", "error");
    }
  };

  // WhatsApp share
  const getWhatsAppShareUrl = (tripCode: string, url: string) => {
    const text = encodeURIComponent(
      `Please upload the signed POD for trip ${tripCode} using this secure link: ${url}`,
    );
    return `https://wa.me/?text=${text}`;
  };

  const clearFilters = () => {
    setFilters({
      search: "",
      clientId: "",
      branchId: "",
      vehicleType: "ALL",
      podStatus: "",
      preset: "ALL",
      from: "",
      to: "",
      page: 1,
    });
  };

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-xs font-semibold shadow-lg transition-all ${
            toastMessage.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {toastMessage.text}
        </div>
      ) : null}

      {/* Page Header matching Overview, Review, Queue */}
      <div className="billing-page-heading">
        <div>
          <h1 className="billing-page-title">Trips management</h1>
          <p className="billing-page-description">
            Search, filter, and manage fleet trips, POD submissions, and hired-driver upload links.
          </p>
        </div>
        <button
          type="button"
          className="billing-button"
          disabled={loading}
          onClick={() => void fetchTrips()}
        >
          {loading ? "Refreshing trips…" : "Refresh trips"}
        </button>
      </div>

      {/* Filter Bar using established billing-filter-bar and billing-select */}
      <div className="billing-filter-bar" aria-label="Trip filters">
        <label className="billing-filter">
          <span className="billing-filter-label">Search</span>
          <input
            type="text"
            className="billing-input"
            placeholder="Trip, LR, Vehicle, Client…"
            value={filters.search}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))
            }
          />
        </label>

        <label className="billing-filter">
          <span className="billing-filter-label">Client</span>
          <select
            className="billing-select"
            value={filters.clientId}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, clientId: e.target.value, page: 1 }))
            }
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="billing-filter">
          <span className="billing-filter-label">Branch</span>
          <select
            className="billing-select"
            value={filters.branchId}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, branchId: e.target.value, page: 1 }))
            }
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="billing-filter">
          <span className="billing-filter-label">Vehicle type</span>
          <select
            className="billing-select"
            value={filters.vehicleType}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, vehicleType: e.target.value, page: 1 }))
            }
          >
            <option value="ALL">All vehicles</option>
            <option value="OWN">Own vehicle</option>
            <option value="HIRED">Hired vehicle</option>
          </select>
        </label>

        <label className="billing-filter">
          <span className="billing-filter-label">POD status</span>
          <select
            className="billing-select"
            value={filters.podStatus}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, podStatus: e.target.value, page: 1 }))
            }
          >
            <option value="">All statuses</option>
            <option value="POD_PENDING">POD Pending</option>
            <option value="AI_CHECKING">AI Checking</option>
            <option value="VERIFIED">Verified</option>
            <option value="EXPORTED">Exported</option>
            <option value="NEEDS_REVIEW">Needs Review</option>
            <option value="RETAKE_REQUESTED">Retake Requested</option>
            <option value="INVOICED">Invoiced</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_TRANSIT">In Transit</option>
          </select>
        </label>

        <label className="billing-filter">
          <span className="billing-filter-label">Date preset</span>
          <select
            className="billing-select"
            value={filters.preset}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="ALL">All time</option>
            <option value="TODAY">Today</option>
            <option value="LAST_7D">Last 7 days</option>
            <option value="LAST_30D">Last 30 days</option>
            <option value="THIS_MONTH">This month</option>
            <option value="LAST_MONTH">Last month</option>
            <option value="THIS_YEAR">This year</option>
          </select>
        </label>

        <div className="flex items-end pb-0.5">
          <button
            type="button"
            className="billing-button"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Trips Content Table Area */}
      {error ? (
        <section className="billing-state is-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="billing-button mt-2"
            onClick={() => void fetchTrips()}
          >
            Try again
          </button>
        </section>
      ) : loading && trips.length === 0 ? (
        <div className="billing-panel" role="status" aria-label="Loading trips">
          {[0, 1, 2, 3, 4].map((item) => (
            <div className="billing-review-row" key={item} aria-hidden="true">
              <div className="billing-skeleton-block h-6 w-full" />
              <div className="billing-skeleton-block h-5 w-full" />
              <div className="billing-skeleton-block h-5 w-full" />
              <div className="billing-skeleton-block h-6 w-16" />
            </div>
          ))}
        </div>
      ) : trips.length === 0 ? (
        <section className="billing-panel billing-empty" role="status">
          No trips match your filter criteria. Try adjusting your search or clearing filters.
        </section>
      ) : (
        <section
          className={`billing-panel${loading ? " is-refreshing" : ""}`}
          aria-label="Trips list"
          aria-busy={loading}
        >
          <div className="billing-panel-heading">
            <div>
              <h2 className="billing-panel-title">All Trips</h2>
              <p className="billing-panel-description">
                Showing{" "}
                {pagination.totalCount === 0
                  ? 0
                  : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(
                      pagination.page * pagination.limit,
                      pagination.totalCount,
                    )}`}{" "}
                of {formatNumber(pagination.totalCount)} trips across branches
              </p>
            </div>
          </div>

          <div className="billing-table-wrap">
            <table className="billing-table is-fixed" style={{ minWidth: "100%", width: "100%" }}>
              <caption className="billing-sr-only">Fleet trips listing</caption>
              <colgroup>
                <col style={{ width: "13%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "80px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Trip</th>
                  <th scope="col">LR No</th>
                  <th scope="col">Client</th>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Type</th>
                  <th scope="col">Driver</th>
                  <th scope="col">Route</th>
                  <th scope="col">Trip Date</th>
                  <th scope="col" className="billing-number">Freight</th>
                  <th scope="col">POD Status</th>
                  <th scope="col" style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => {
                  const driverName = trip.isHired
                    ? trip.driverPhone
                      ? `Hired: ${trip.driverPhone}`
                      : "Hired Driver"
                    : trip.driver?.name ?? "Unassigned";
                  const routeSummary = formatRoute(trip.origin, trip.destination);
                  const fullRoute = `${trip.origin} → ${trip.destination}`;

                  return (
                    <tr
                      key={trip.id}
                      onClick={() => openTripDetail(trip.id)}
                      className="cursor-pointer hover:bg-neutral-50"
                    >
                      <td>
                        <span
                          className="billing-cell-truncate font-semibold text-neutral-900"
                          title={trip.tripCode}
                        >
                          {trip.tripCode}
                        </span>
                      </td>
                      <td>
                        <span
                          className="billing-cell-truncate font-mono text-[11px]"
                          title={trip.lrNumber}
                        >
                          {trip.lrNumber}
                        </span>
                      </td>
                      <td>
                        <span
                          className="billing-cell-truncate font-medium text-neutral-900"
                          title={trip.client?.name ?? "—"}
                        >
                          {trip.client?.name ?? "—"}
                        </span>
                      </td>
                      <td>
                        <span
                          className="billing-cell-truncate font-mono text-[11px]"
                          title={trip.vehicle?.vehicleNo ?? "—"}
                        >
                          {trip.vehicle?.vehicleNo ?? "—"}
                        </span>
                      </td>
                      <td>
                        <span className="billing-muted font-medium">
                          {trip.isHired ? "Hired" : "Own"}
                        </span>
                      </td>
                      <td>
                        <span
                          className="billing-cell-truncate"
                          title={driverName}
                        >
                          {driverName}
                        </span>
                      </td>
                      <td>
                        <span
                          className="billing-cell-truncate"
                          title={fullRoute}
                        >
                          {routeSummary}
                        </span>
                      </td>
                      <td className="billing-muted whitespace-nowrap">
                        {formatTripDate(trip.createdAt)}
                      </td>
                      <td className="billing-number font-medium whitespace-nowrap">
                        {formatTripFreight(trip.freight)}
                      </td>
                      <td>
                        <span className={statusBadgeClass(trip.status)}>
                          {displayStatus(trip.status)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="billing-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTripDetail(trip.id);
                          }}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Toolbar */}
          <div className="billing-batch-toolbar">
            <span className="billing-selection-summary">
              Showing{" "}
              {pagination.totalCount === 0
                ? 0
                : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(
                    pagination.page * pagination.limit,
                    pagination.totalCount,
                  )}`}{" "}
              of {formatNumber(pagination.totalCount)} trips (Page {pagination.page} of{" "}
              {Math.max(1, pagination.totalPages)})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="billing-button"
                disabled={pagination.page <= 1 || loading}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, page: prev.page - 1 }))
                }
              >
                Previous
              </button>
              <button
                type="button"
                className="billing-button"
                disabled={
                  pagination.page >= pagination.totalPages ||
                  !pagination.hasMore ||
                  loading
                }
                onClick={() =>
                  setFilters((prev) => ({ ...prev, page: prev.page + 1 }))
                }
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Trip Details Slide-Over Drawer using existing billing-dialog-overlay and billing-review-panel */}
      {selectedTripId ? (
        <div className="billing-dialog-overlay">
          <button
            type="button"
            className="billing-review-backdrop"
            aria-label="Close trip details"
            onClick={closeTripDetail}
          />
          <aside
            className="billing-review-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Trip details panel"
          >
            {/* Header */}
            <div className="billing-review-panel-header">
              <div>
                <span className="billing-nav-label" style={{ margin: 0 }}>
                  Trip Details
                </span>
                <h2 className="billing-panel-title" style={{ fontSize: "16px", marginTop: "4px" }}>
                  {detailTrip?.tripCode ?? "Loading trip…"}
                </h2>
              </div>
              <button
                type="button"
                className="billing-button"
                onClick={closeTripDetail}
                aria-label="Close panel"
              >
                Close
              </button>
            </div>

            {/* Content */}
            {detailLoading ? (
              <div className="billing-empty" role="status">
                Loading trip information…
              </div>
            ) : detailError ? (
              <section className="billing-state is-error mt-4" role="alert">
                <p>{detailError}</p>
                <button
                  type="button"
                  className="billing-button mt-2"
                  onClick={() => void fetchTripDetail(selectedTripId)}
                >
                  Try again
                </button>
              </section>
            ) : detailTrip ? (
              <div className="space-y-4 pt-4">
                {/* Trip Info Card */}
                <div className="billing-panel p-4 text-xs">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <span className="billing-muted block text-[10px] uppercase font-semibold">
                        Status
                      </span>
                      <span className={statusBadgeClass(detailTrip.status)} style={{ marginTop: "4px" }}>
                        {displayStatus(detailTrip.status)}
                      </span>
                    </div>
                    <div>
                      <span className="billing-muted block text-[10px] uppercase font-semibold">
                        Freight
                      </span>
                      <strong className="mt-1 block text-neutral-900">
                        {formatCurrency(detailTrip.freight)}
                      </strong>
                    </div>
                    <div>
                      <span className="billing-muted block text-[10px] uppercase font-semibold">
                        Vehicle Type
                      </span>
                      <span className="mt-1 block font-medium text-neutral-800">
                        {detailTrip.isHired ? "Hired Vehicle" : "Company Owned"}
                      </span>
                    </div>
                    <div>
                      <span className="billing-muted block text-[10px] uppercase font-semibold">
                        Vehicle No
                      </span>
                      <span className="mt-1 block font-mono font-medium text-neutral-900">
                        {detailTrip.vehicle?.vehicleNo ?? "—"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 border-t border-neutral-100 pt-3 sm:grid-cols-2">
                    <div>
                      <span className="billing-muted">Client: </span>
                      <strong className="text-neutral-900">{detailTrip.client?.name ?? "—"}</strong>
                    </div>
                    <div>
                      <span className="billing-muted">Branch: </span>
                      <strong className="text-neutral-900">{detailTrip.branch?.name ?? "—"}</strong>
                    </div>
                    <div>
                      <span className="billing-muted">LR Number: </span>
                      <strong className="font-mono text-neutral-900">{detailTrip.lrNumber}</strong>
                    </div>
                    <div>
                      <span className="billing-muted">E-Way Bill: </span>
                      <span className="font-mono text-neutral-800">{detailTrip.ewayBillNo || "—"}</span>
                    </div>
                    <div className="border-t border-neutral-100 pt-3 sm:col-span-2">
                      <div className="flex items-center justify-between pb-1">
                        <span className="billing-muted text-[10px] uppercase font-semibold">
                          Driver & Contact
                        </span>
                        <span
                          className={`billing-status ${
                            detailTrip.isHired ? "is-warning" : "is-success"
                          }`}
                        >
                          {detailTrip.isHired ? "External Hired Fleet" : "Company Fleet"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                        <div>
                          <span className="billing-muted">Driver Name: </span>
                          <span className="font-medium text-neutral-900">
                            {detailTrip.driver?.name ?? (detailTrip.isHired ? "External Hired Driver" : "Unassigned")}
                          </span>
                        </div>
                        <div>
                          <span className="billing-muted">Contact Phone: </span>
                          <span className="font-mono text-neutral-900">
                            {detailTrip.driver?.phone ?? detailTrip.driverPhone ?? "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <span className="billing-muted">Route: </span>
                      <span className="text-neutral-800">
                        {detailTrip.origin} → {detailTrip.destination}
                      </span>
                    </div>
                    <div>
                      <span className="billing-muted">Goods & Expected: </span>
                      <span className="text-neutral-800">
                        {detailTrip.goodsDescription} ({formatNumber(detailTrip.expectedQuantity)} {detailTrip.quantityUnit})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Hired Driver POD Upload Link Section (Strictly for Hired Vehicles) */}
                {detailTrip.isHired ? (
                  <div className="billing-panel p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="billing-panel-title">
                        Hired Driver POD Upload
                      </h3>
                      <span
                        className={`billing-status ${
                          detailTrip.uploadLink?.status === "ACTIVE"
                            ? "is-success"
                            : detailTrip.uploadLink?.status === "USED"
                            ? "is-success"
                            : detailTrip.uploadLink?.status === "EXPIRED" ||
                              detailTrip.uploadLink?.status === "REVOKED"
                            ? "is-warning"
                            : ""
                        }`}
                      >
                        {detailTrip.uploadLink?.status === "NOT_GENERATED"
                          ? "NOT GENERATED"
                          : detailTrip.uploadLink?.status ?? "NOT GENERATED"}
                      </span>
                    </div>

                    <p className="billing-panel-description">
                      {detailTrip.uploadLink?.status === "NOT_GENERATED"
                        ? "Generate a secure upload link and share it with the hired driver to submit the POD."
                        : "Shareable 48-hour secure upload link for the external hired driver."}
                    </p>

                    {/* Newly Generated URL state */}
                    {generatedUrl ? (
                      <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                            Secure Upload Link (Active)
                          </label>
                          {detailTrip.uploadLink?.expiresAt ? (
                            <span className="billing-muted text-[10px]">
                              Expires {formatDate(detailTrip.uploadLink.expiresAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={generatedUrl}
                            className="billing-input font-mono text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() => handleCopyLink(generatedUrl)}
                            className="billing-button billing-button-primary shrink-0"
                          >
                            Copy Link
                          </button>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <a
                            href={getWhatsAppShareUrl(detailTrip.tripCode, generatedUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="billing-button shrink-0"
                            style={{ borderColor: "#16a34a", color: "#166534" }}
                          >
                            <span>Share via WhatsApp</span>
                          </a>
                          <button
                            type="button"
                            disabled={linkActionLoading}
                            onClick={handleRevokeLink}
                            className="billing-button billing-button-danger shrink-0"
                          >
                            Revoke Link
                          </button>
                        </div>
                      </div>
                    ) : detailTrip.uploadLink?.status === "ACTIVE" ? (
                      <div className="mt-3 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-xs">
                        <p className="font-medium text-neutral-800">
                          An active upload link exists for this trip (expires{" "}
                          {formatDate(detailTrip.uploadLink.expiresAt!)}).
                        </p>
                        <p className="billing-muted text-[11px]">
                          For security, raw tokens are not stored in the database. If you need to re-share, click below to revoke the existing link and generate a fresh one.
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={linkActionLoading}
                            onClick={handleGenerateLink}
                            className="billing-button billing-button-primary"
                          >
                            {linkActionLoading ? "Working…" : "Regenerate New Link"}
                          </button>
                          <button
                            type="button"
                            disabled={linkActionLoading}
                            onClick={handleRevokeLink}
                            className="billing-button billing-button-danger"
                          >
                            Revoke Link
                          </button>
                        </div>
                      </div>
                    ) : detailTrip.uploadLink?.status === "USED" ? (
                      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 text-xs">
                        <p className="font-semibold text-neutral-900">POD Submitted via Link</p>
                        <p className="billing-muted text-[11px] mt-0.5">
                          The driver has submitted the proof of delivery. This upload link is now closed.
                        </p>
                        {detailTrip.status === "RETAKE_REQUESTED" ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              disabled={linkActionLoading}
                              onClick={handleGenerateLink}
                              className="billing-button billing-button-primary"
                            >
                              Generate Replacement Link (Retake)
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center justify-between">
                        <span className="billing-muted text-xs">
                          {detailTrip.uploadLink?.status === "EXPIRED"
                            ? "Previous link expired."
                            : detailTrip.uploadLink?.status === "REVOKED"
                            ? "Previous link revoked."
                            : "No upload link generated yet."}
                        </span>
                        <button
                          type="button"
                          disabled={linkActionLoading}
                          onClick={handleGenerateLink}
                          className="billing-button billing-button-primary"
                        >
                          {linkActionLoading
                            ? "Generating…"
                            : detailTrip.uploadLink?.status === "NOT_GENERATED"
                            ? "Generate Upload Link"
                            : "Generate New Link"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* POD Submissions & Verification Results */}
                <div className="space-y-3">
                  <div className="billing-panel-heading" style={{ padding: 0 }}>
                    <h3 className="billing-panel-title">
                      POD Submissions ({detailTrip.podSubmissions.length})
                    </h3>
                  </div>

                  {detailTrip.podSubmissions.length === 0 ? (
                    <div className="billing-panel billing-empty">
                      No POD has been uploaded for this trip yet.
                    </div>
                  ) : (
                    detailTrip.podSubmissions.map((sub) => (
                      <div key={sub.id} className="billing-panel p-4 text-xs space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-neutral-900">
                            Attempt #{sub.attemptNo}
                          </span>
                          <span className={statusBadgeClass(sub.status)}>
                            {displayStatus(sub.status)}
                          </span>
                        </div>

                        {sub.imageUrl ? (
                          <div className="billing-preview-wrap">
                            <Image
                              src={sub.imageUrl.url}
                              alt={`POD Attempt #${sub.attemptNo}`}
                              width={480}
                              height={360}
                              className="billing-preview-image"
                              unoptimized
                            />
                          </div>
                        ) : null}

                        {/* AI Extraction Findings */}
                        {sub.extraction ? (
                          <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-neutral-700">AI Verdict:</span>
                              <span
                                className={`font-bold ${
                                  sub.extraction.verdict === "VERIFIED"
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                                }`}
                              >
                                {sub.extraction.verdict}
                              </span>
                            </div>
                            {sub.extraction.reasons.length > 0 ? (
                              <p className="billing-muted mt-1 text-[10px]">
                                Flags: {sub.extraction.reasons.join(", ")}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
