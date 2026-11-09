"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson, formatDate, formatNumber } from "@/src/lib/fleetproof";
import { useBillingWorkspace } from "../BillingWorkspace";

type Branch = { id: string; name: string };
type Extraction = {
  verdict: string;
  reasons: string[];
  fields: Record<string, unknown>;
  confidences: Record<string, number>;
};
type ReviewTrip = {
  id: string;
  tripCode: string;
  status: string;
  isHired: boolean;
  goodsDescription: string;
  lrNumber: string;
  quantityUnit: string;
  expectedQuantity: number | string;
  deliveredQuantity: number | string | null;
  retakeCount: number;
  consigneeName?: string | null;
  consigneePhone?: string | null;
  deliveredAt: string | null;
  createdAt: string;
  client: { name: string } | null;
  branch: Branch | null;
  vehicle: { vehicleNo: string; isHired: boolean } | null;
  driverPhone?: string | null;
  driver?: { id: string; name: string; phone: string | null } | null;
  podSubmissions: Array<{
    id: string;
    attemptNo: number;
    uploadedAt: string;
    capturedAt: string;
    sourceFilename?: string;
    sizeKb?: number;
    gpsLat?: number | null;
    gpsLng?: number | null;
    imageUrl: { url: string; expiresInSeconds: number };
    extraction: Extraction | null;
  }>;
};
type ReviewHistory = {
  id: string;
  action: string;
  note: string | null;
  at: string;
  reviewer: { name: string };
  fieldChanges: Record<string, unknown>;
};
type ReviewDetail = { trip: ReviewTrip; history: ReviewHistory[] };
type PodImageUrl = { url: string; expiresInSeconds: number };
type EditableField =
  | "lr_number"
  | "consignee_stamp_present"
  | "signature_present"
  | "remarks_text"
  | "image_readable"
  | "blurry"
  | "cropped"
  | "delivery_date"
  | "quantity_received"
  | "quantity_unit"
  | "goods_description"
  | "has_shortage_or_damage_remark"
  | "retake_hint";
type ReviewForm = Record<EditableField, string | boolean>;
type ReviewFilters = { reason: string; branch: string; search?: string; page?: number };
type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};
type PanelState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "error"; message: string; data?: T };

const reviewReasons = [
  "stamp_not_visible",
  "signature_missing",
  "blurry",
  "cropped",
  "lr_not_visible",
  "lr_mismatch",
  "quantity_unreadable",
  "ai_unavailable",
  "retake_limit",
  "shortage_remark",
  "damage",
  "low_confidence",
  "quantity_mismatch",
  "quantity_unit_unreadable",
  "quantity_unit_mismatch",
  "goods_unreadable",
  "goods_mismatch",
  "delivery_date_unreadable",
  "delivery_date_invalid",
  "delivery_date_mismatch",
] as const;
const editableLabels: Record<EditableField, string> = {
  lr_number: "LR number",
  consignee_stamp_present: "Consignee stamp present",
  signature_present: "Signature present",
  remarks_text: "Remarks",
  image_readable: "Image readable",
  blurry: "Image is blurry",
  cropped: "Image is cropped",
  delivery_date: "Delivery date",
  quantity_received: "Quantity received",
  quantity_unit: "Quantity unit",
  goods_description: "Goods description",
  has_shortage_or_damage_remark: "Shortage or damage remark",
  retake_hint: "Retake hint",
};
const editableFields = Object.keys(editableLabels) as EditableField[];
const editableFieldSet: ReadonlySet<string> = new Set(editableFields);

function extractFieldValue(val: unknown): unknown {
  if (val !== null && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("value" in obj) return obj.value;
    if ("present" in obj) return obj.present;
  }
  return val;
}

function extractFieldUnit(val: unknown): string | null {
  if (val !== null && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.unit === "string") return obj.unit;
  }
  return null;
}

function displayReason(reason: string) {
  return reason.replaceAll("_", " ");
}

function confidencePresentation(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  const percentage = Math.round(value * 100);
  const level = value >= 0.85 ? "High" : value >= 0.5 ? "Medium" : "Low";
  return { percentage, level };
}

function correctedFields(detail: ReviewDetail) {
  const rawFields = detail.trip.podSubmissions.at(-1)?.extraction?.fields ?? {};
  const fields: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(rawFields)) {
    if (key === "consignee_stamp") {
      fields.consignee_stamp_present = extractFieldValue(val);
    } else if (key === "signature") {
      fields.signature_present = extractFieldValue(val);
    } else if (key === "quantity_received") {
      fields.quantity_received = extractFieldValue(val);
      const unit = extractFieldUnit(val);
      if (unit && !rawFields.quantity_unit) {
        fields.quantity_unit = unit;
      }
    } else {
      fields[key] = extractFieldValue(val);
    }
  }

  for (const action of detail.history) {
    if (action.action !== "CORRECT_FIELDS") continue;
    for (const [field, change] of Object.entries(action.fieldChanges)) {
      if (
        editableFieldSet.has(field) &&
        typeof change === "object" &&
        change !== null &&
        "after" in change
      ) {
        fields[field] = change.after;
      }
    }
  }
  return fields;
}

function initialForm(detail: ReviewDetail): ReviewForm {
  const fields = correctedFields(detail);
  const value = (key: EditableField) => fields[key];
  return {
    lr_number: typeof value("lr_number") === "string" ? value("lr_number") as string : "",
    consignee_stamp_present: value("consignee_stamp_present") === true,
    signature_present: value("signature_present") === true,
    remarks_text: typeof value("remarks_text") === "string" ? value("remarks_text") as string : "",
    image_readable: value("image_readable") === true,
    blurry: value("blurry") === true,
    cropped: value("cropped") === true,
    delivery_date: typeof value("delivery_date") === "string" ? value("delivery_date") as string : "",
    quantity_received:
      typeof value("quantity_received") === "number" ||
      typeof value("quantity_received") === "string"
        ? String(value("quantity_received"))
        : "",
    quantity_unit: typeof value("quantity_unit") === "string" ? value("quantity_unit") as string : "",
    goods_description: typeof value("goods_description") === "string" ? value("goods_description") as string : "",
    has_shortage_or_damage_remark: value("has_shortage_or_damage_remark") === true,
    retake_hint: typeof value("retake_hint") === "string" ? value("retake_hint") as string : "",
  };
}

function formatAction(action: string) {
  return action.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function isBooleanField(field: EditableField): boolean {
  return (
    field === "consignee_stamp_present" ||
    field === "signature_present" ||
    field === "image_readable" ||
    field === "blurry" ||
    field === "cropped" ||
    field === "has_shortage_or_damage_remark"
  );
}

function SkeletonList() {
  return (
    <div className="billing-panel" role="status" aria-label="Loading review cases">
      {[0, 1, 2, 3].map((item) => (
        <div className="billing-review-row" key={item} aria-hidden="true">
          <div className="billing-skeleton-block h-12 w-full" />
          <div className="billing-skeleton-block h-10 w-full" />
          <div className="billing-skeleton-block h-10 w-full" />
          <div className="billing-skeleton-block h-9 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function ReviewPage({
  initialFilters,
}: {
  initialFilters: ReviewFilters;
}) {
  const router = useRouter();
  const { refreshReviewCount } = useBillingWorkspace();
  const [tripsState, setTripsState] = useState<PanelState<ReviewTrip[]>>({
    status: "loading",
  });
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: initialFilters.page ?? 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [branchesState, setBranchesState] = useState<PanelState<Branch[]>>({
    status: "loading",
  });
  const [reason, setReason] = useState(initialFilters.reason);
  const [branch, setBranch] = useState(initialFilters.branch);
  const [search, setSearch] = useState(initialFilters.search ?? "");
  const [page, setPage] = useState(initialFilters.page ?? 1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<PanelState<ReviewDetail>>({
    status: "loading",
  });
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [editedFields, setEditedFields] = useState<Set<EditableField>>(new Set());
  const [note, setNote] = useState("");
  const [retakeReason, setRetakeReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageReloading, setImageReloading] = useState(false);
  const [imageReloadError, setImageReloadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextReason = params.get("reason") ?? "";
      const nextBranch = params.get("branch") ?? "";
      const nextSearch = params.get("search") ?? "";
      const parsedPage = Number(params.get("page"));
      const nextPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
      setReason(nextReason);
      setBranch(nextBranch);
      setSearch(nextSearch);
      setPage(nextPage);
      setTripsState((current) => ({ status: "loading", data: current.data }));
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
              error instanceof Error ? error.message : "Unable to load branches.",
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
    if (reason) params.set("reason", reason);
    if (branch) params.set("branch", branch);
    if (search.trim()) params.set("search", search.trim());
    if (page > 1) params.set("page", String(page));
    params.set("limit", "10");

    void fetchJson<{ trips: ReviewTrip[]; pagination?: PaginationInfo }>(
      `/api/review?${params}`,
    )
      .then((payload) => {
        if (active) {
          setTripsState({ status: "ready", data: payload.trips });
          if (payload.pagination) {
            setPagination(payload.pagination);
          } else {
            setPagination({
              page,
              limit: 10,
              total: payload.trips.length,
              totalPages: Math.max(1, Math.ceil(payload.trips.length / 10)),
              hasNextPage: false,
              hasPreviousPage: page > 1,
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setTripsState((current) => ({
            status: "error",
            message:
              error instanceof Error ? error.message : "Unable to load review queue.",
            data: current.data,
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [branch, reason, search, page, refreshKey]);

  useEffect(() => {
    if (!selectedTripId) return;
    let active = true;
    void fetchJson<ReviewDetail>(`/api/review/${encodeURIComponent(selectedTripId)}`)
      .then((detail) => {
        if (!active) return;
        setDetailState({ status: "ready", data: detail });
        setForm(initialForm(detail));
        setEditedFields(new Set());
        setImageError(false);
        setImageReloadError(null);
        setZoom(1);
        setRotation(0);
      })
      .catch((error: unknown) => {
        if (active) {
          setDetailState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Unable to load trip details.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [selectedTripId]);

  useEffect(() => {
    if (!selectedTripId) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary',
      ) ?? [];
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!submittingRef.current) setSelectedTripId(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...focusable()];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [selectedTripId]);

  const openTrip = (id: string) => {
    setActionError(null);
    setActionMessage(null);
    setImageError(false);
    setImageReloadError(null);
    setNote("");
    setRetakeReason("");
    setDetailState({ status: "loading" });
    setSelectedTripId(id);
  };

  const closeTrip = () => {
    if (isSubmitting) return;
    setSelectedTripId(null);
    setActionError(null);
    setActionMessage(null);
    setForm(null);
    setNote("");
    setRetakeReason("");
  };

  const editField = (field: EditableField, value: string | boolean) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
    setEditedFields((current) => new Set(current).add(field));
  };

  const refreshList = () => {
    setTripsState((current) => ({ status: "loading", data: current.data }));
    setRefreshKey((key) => key + 1);
  };

  const syncUrl = (nextReason: string, nextBranch: string, nextSearch: string, nextPage: number) => {
    const params = new URLSearchParams();
    if (nextReason) params.set("reason", nextReason);
    if (nextBranch) params.set("branch", nextBranch);
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (nextPage > 1) params.set("page", String(nextPage));
    router.push(
      `/billing/review${params.size ? `?${params}` : ""}`,
      { scroll: false },
    );
  };

  const updateFilters = (nextReason: string, nextBranch: string, nextSearch = search) => {
    setReason(nextReason);
    setBranch(nextBranch);
    setSearch(nextSearch);
    setPage(1);
    setTripsState((current) => ({ status: "loading", data: current.data }));
    syncUrl(nextReason, nextBranch, nextSearch, 1);
  };

  const changePage = (nextPage: number) => {
    setPage(nextPage);
    setTripsState((current) => ({ status: "loading", data: current.data }));
    syncUrl(reason, branch, search, nextPage);
  };

  const reloadPodImage = async (submissionId: string) => {
    setImageReloading(true);
    setImageReloadError(null);
    try {
      const imageUrl = await fetchJson<PodImageUrl>(
        `/api/pods/${encodeURIComponent(submissionId)}/image-url`,
      );
      setDetailState((current) => {
        if (current.status !== "ready") return current;
        return {
          status: "ready",
          data: {
            ...current.data,
            trip: {
              ...current.data.trip,
              podSubmissions: current.data.trip.podSubmissions.map((submission) =>
                submission.id === submissionId
                  ? { ...submission, imageUrl }
                  : submission,
              ),
            },
          },
        };
      });
      setImageError(false);
    } catch (error) {
      setImageReloadError(
        error instanceof Error ? error.message : "Unable to reload the POD image.",
      );
    } finally {
      setImageReloading(false);
    }
  };

  const submitReviewAction = async (
    payload: Record<string, unknown>,
    keepOpen: boolean,
  ) => {
    if (!selectedTripId) return;
    setActionError(null);
    setActionMessage(null);
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await fetchJson(`/api/review/${encodeURIComponent(selectedTripId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refreshReviewCount();
      setActionMessage("Review action saved.");
      // If we are about to leave the last item on page > 1, adjust page back
      if (!keepOpen && tripsState.data && tripsState.data.length <= 1 && page > 1) {
        changePage(page - 1);
      } else {
        refreshList();
      }
      if (keepOpen) {
        setDetailState({ status: "loading" });
        void fetchJson<ReviewDetail>(`/api/review/${encodeURIComponent(selectedTripId)}`)
          .then((detail) => {
            setDetailState({ status: "ready", data: detail });
            setForm(initialForm(detail));
            setEditedFields(new Set());
            setImageError(false);
            setImageReloadError(null);
            setZoom(1);
            setRotation(0);
          })
          .catch((error: unknown) => {
            setDetailState({
              status: "error",
              message:
                error instanceof Error ? error.message : "Unable to refresh trip details.",
            });
          });
      } else {
        setSelectedTripId(null);
        setForm(null);
        setNote("");
        setRetakeReason("");
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to save the review action.",
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const saveCorrections = () => {
    if (!form || editedFields.size === 0) {
      setActionError("Change at least one extracted field before saving.");
      return;
    }

    const fields: Record<string, string | number | boolean | null> = {};
    for (const field of editedFields) {
      const value = form[field];
      if (field === "quantity_received") {
        const quantity = String(value).trim();
        if (!quantity) {
          fields.quantity_received = null;
          continue;
        }
        const parsedQuantity = Number(quantity);
        if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
          setActionError("Enter a valid non-negative delivered quantity.");
          return;
        }
        fields.quantity_received = parsedQuantity;
        const unit = String(form.quantity_unit).trim();
        if (!unit) {
          setActionError("Enter the confirmed quantity unit with the quantity.");
          return;
        }
        fields.quantity_unit = unit;
        continue;
      }
      if (isBooleanField(field)) {
        fields[field] = value === true;
      } else {
        const text = String(value).trim();
        fields[field] = field === "remarks_text" ? text : text || null;
      }
    }
    void submitReviewAction({ action: "correct_fields", fields, note: note.trim() || undefined }, true);
  };

  const activeDetail = detailState.status === "ready" ? detailState.data : null;
  const latestSubmission = activeDetail?.trip.podSubmissions.at(-1) ?? null;
  const extraction = latestSubmission?.extraction ?? null;
  const reviewedFields = activeDetail ? correctedFields(activeDetail) : null;

  return (
    <div className="space-y-4">
      <div className="billing-page-heading">
        <div>
          <h1 className="billing-page-title">POD review</h1>
          <p className="billing-page-description">
            Inspect AI exceptions and record a verified decision.
          </p>
        </div>
        <button
          type="button"
          className="billing-button"
          disabled={tripsState.status === "loading"}
          onClick={refreshList}
        >
          {tripsState.status === "loading" ? "Refreshing queue…" : "Refresh queue"}
        </button>
      </div>

      <div className="billing-filter-bar" aria-label="Review filters">
        <label className="billing-filter">
          <span className="billing-filter-label">Search</span>
          <input
            type="text"
            className="billing-input"
            placeholder="Trip, LR, Vehicle, Client…"
            value={search}
            onChange={(event) => updateFilters(reason, branch, event.target.value)}
          />
        </label>
        <label className="billing-filter">
          <span className="billing-filter-label">Review reason</span>
          <select
            className="billing-select"
            value={reason}
            onChange={(event) => updateFilters(event.target.value, branch, search)}
          >
            <option value="">All reasons</option>
            {reviewReasons.map((item) => (
              <option value={item} key={item}>{displayReason(item)}</option>
            ))}
          </select>
        </label>
        <label className="billing-filter">
          <span className="billing-filter-label">Branch</span>
          <select
            className="billing-select"
            value={branch}
            disabled={branchesState.status !== "ready"}
            onChange={(event) => updateFilters(reason, event.target.value, search)}
          >
            <option value="">All branches</option>
            {branchesState.status === "ready"
              ? branchesState.data.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))
              : null}
          </select>
        </label>
        {(reason || branch || search) ? (
          <div className="flex items-end pb-0.5">
            <button
              type="button"
              className="billing-button"
              onClick={() => updateFilters("", "", "")}
            >
              Clear filters
            </button>
          </div>
        ) : null}
        {branchesState.status === "error" ? (
          <p className="billing-inline-error" role="alert">
            Branch filters unavailable: {branchesState.message}
          </p>
        ) : null}
      </div>

      {tripsState.status === "error" ? (
        <section className="billing-state is-error" role="alert">
          <p>
            {tripsState.message}
            {tripsState.data ? " Showing the last loaded review queue." : ""}
          </p>
          <button type="button" className="billing-button" onClick={refreshList}>Try again</button>
        </section>
      ) : null}
      {tripsState.status === "loading" && !tripsState.data ? (
        <SkeletonList />
      ) : !tripsState.data ? (
        <section className="billing-state is-error" role="alert">
          <p>{tripsState.status === "error" ? tripsState.message : "Review queue is unavailable."}</p>
          <button type="button" className="billing-button" onClick={refreshList}>Try again</button>
        </section>
      ) : tripsState.data.length === 0 ? (
        <section className="billing-panel billing-empty" role="status">
          No trips match these filters. Trips with a manual review verdict will appear here.
        </section>
      ) : (
        <section
          className={`billing-panel${tripsState.status === "loading" ? " is-refreshing" : ""}`}
          aria-label="Trips awaiting POD review"
          aria-busy={tripsState.status === "loading"}
        >
          {tripsState.data.map((trip) => {
            const latest = trip.podSubmissions.at(-1);
            const currentExtraction = latest?.extraction;
            return (
              <article className="billing-review-row" key={trip.id}>
                <div className="billing-review-main">
                  <h2 className="billing-review-trip">{trip.tripCode}</h2>
                  <p className="billing-review-subline">
                    {trip.client?.name ?? "Client"} · {trip.branch?.name ?? "Branch"} ·{" "}
                    {trip.vehicle?.vehicleNo ?? "Vehicle"}
                  </p>
                  <p className="billing-review-subline">
                    LR {trip.lrNumber} · Expected {formatNumber(trip.expectedQuantity)} {trip.quantityUnit}
                  </p>
                </div>
                <div>
                  <span className="billing-status is-danger">{currentExtraction?.verdict ?? "NEEDS REVIEW"}</span>
                  <p className="billing-review-subline">
                    {currentExtraction?.reasons.length
                      ? currentExtraction.reasons.map(displayReason).join(", ")
                      : "No AI reason was recorded"}
                  </p>
                </div>
                <div>
                  <p className="billing-review-subline">
                    Goods: {trip.goodsDescription}
                  </p>
                  <p className="billing-review-subline">
                    Delivered quantity: {trip.deliveredQuantity === null
                      ? "Not confirmed"
                      : `${formatNumber(trip.deliveredQuantity)} ${trip.quantityUnit}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="billing-button billing-button-primary"
                  onClick={() => openTrip(trip.id)}
                >
                  Inspect
                </button>
              </article>
            );
          })}
        </section>
      )}

      {/* Pagination Toolbar */}
      {tripsState.data && tripsState.data.length > 0 ? (
        <div className="billing-batch-toolbar">
          <span className="billing-selection-summary">
            Showing{" "}
            {pagination.total === 0
              ? 0
              : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(
                  pagination.page * pagination.limit,
                  pagination.total,
                )}`}{" "}
            of {formatNumber(pagination.total)} reviews (Page {pagination.page} of{" "}
            {Math.max(1, pagination.totalPages)})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="billing-button"
              disabled={pagination.page <= 1 || tripsState.status === "loading"}
              onClick={() => changePage(pagination.page - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="billing-button"
              disabled={
                pagination.page >= pagination.totalPages ||
                !pagination.hasNextPage ||
                tripsState.status === "loading"
              }
              onClick={() => changePage(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {selectedTripId ? (
        <div className="billing-dialog-overlay">
          <button
            type="button"
            className="billing-review-backdrop"
            aria-label="Close POD review"
            onClick={closeTrip}
          />
          <aside
            ref={dialogRef}
            className="billing-review-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="billing-review-title"
          >
            <header className="billing-review-panel-header">
              <div>
                <h2 id="billing-review-title" className="billing-panel-title">
                  {activeDetail?.trip.tripCode ?? "POD review details"}
                </h2>
                <p className="billing-panel-description">
                  Inspect the submitted POD, AI fields and review history.
                </p>
              </div>
              <button type="button" className="billing-button" onClick={closeTrip} disabled={isSubmitting}>
                Close
              </button>
            </header>

            {detailState.status === "loading" ? (
              <div className="billing-review-vertical-stack" role="status" aria-label="Loading trip details">
                <div className="billing-panel h-48 animate-pulse" />
                <div className="billing-panel h-80 animate-pulse" />
                <div className="billing-panel h-80 animate-pulse" />
                <div className="billing-panel h-48 animate-pulse" />
              </div>
            ) : detailState.status === "error" ? (
              <section className="billing-state is-error mt-4" role="alert">
                <p>{detailState.message}</p>
                <button
                  type="button"
                  className="billing-button"
                  onClick={() => openTrip(selectedTripId)}
                >
                  Retry
                </button>
              </section>
            ) : activeDetail ? (
              <>
                <div className="billing-review-vertical-stack">
                  {/* Section 1: Trip and submission information */}
                  <section className="billing-panel">
                    <div className="billing-panel-heading">
                      <div>
                        <h3 className="billing-panel-title">Trip & Submitter Information</h3>
                        <p className="billing-panel-description">
                          Verified operational metadata and upload attribution
                        </p>
                      </div>
                      <span
                        className={`billing-status ${
                          activeDetail.trip.isHired ? "is-warning" : "is-success"
                        }`}
                      >
                        {activeDetail.trip.isHired ? "Hired Fleet" : "Company Own Fleet"}
                      </span>
                    </div>

                    <div className="p-4 pt-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">Trip Code</span>
                        <span className="billing-ai-value font-semibold">{activeDetail.trip.tripCode}</span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">LR Number</span>
                        <span className="billing-ai-value font-mono font-medium">{activeDetail.trip.lrNumber}</span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">Client</span>
                        <span className="billing-ai-value">{activeDetail.trip.client?.name ?? "—"}</span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">Vehicle</span>
                        <span className="billing-ai-value font-mono">{activeDetail.trip.vehicle?.vehicleNo ?? "—"}</span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">Driver / Submitter</span>
                        <span className="billing-ai-value">
                          {activeDetail.trip.driver?.name ??
                            (activeDetail.trip.isHired ? "External Hired Driver" : "Unassigned")}
                        </span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">Driver Phone</span>
                        <span className="billing-ai-value font-mono">
                          {activeDetail.trip.driver?.phone ?? activeDetail.trip.driverPhone ?? "—"}
                        </span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">Consignee</span>
                        <span className="billing-ai-value">
                          {activeDetail.trip.consigneeName || "—"}
                          {activeDetail.trip.consigneePhone ? ` (${activeDetail.trip.consigneePhone})` : ""}
                        </span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">Delivery Date & Time</span>
                        <span className="billing-ai-value">
                          {activeDetail.trip.deliveredAt ? formatDate(activeDetail.trip.deliveredAt) : "Not recorded"}
                        </span>
                      </div>
                      <div className="billing-ai-card">
                        <span className="billing-ai-label">POD Uploaded Date & Time</span>
                        <span className="billing-ai-value font-medium text-blue-700">
                          {latestSubmission ? formatDate(latestSubmission.uploadedAt) : "—"}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Section 2: AI Extraction */}
                  <section className="billing-panel">
                    <div className="billing-panel-heading">
                      <div>
                        <h3 className="billing-panel-title">AI Extraction</h3>
                        <p className="billing-panel-description">
                          Automated document parsing with confidence indicators
                        </p>
                      </div>
                    </div>

                    {/* Verdict & Reasons Header Bar */}
                    <div className="billing-ai-verdict-box">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                          AI Verdict:
                        </span>
                        <span
                          className={`billing-status ${
                            extraction?.verdict === "VERIFIED"
                              ? "is-success"
                              : extraction?.verdict === "RETAKE"
                              ? "is-danger"
                              : "is-warning"
                          }`}
                        >
                          {extraction?.verdict ?? "UNAVAILABLE"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-neutral-600 font-medium">
                          {extraction?.reasons && extraction.reasons.length > 0
                            ? extraction.reasons.map(displayReason).join(", ")
                            : "No anomalies detected"}
                        </span>
                      </div>
                    </div>

                    {/* Extracted Fields in a Responsive 2-column Grid */}
                    <div className="billing-ai-grid mt-3">
                      {[
                        ["lr_number", "LR Number"],
                        ["delivery_date", "Delivery Date"],
                        ["consignee_stamp_present", "Consignee Stamp"],
                        ["signature_present", "Signature"],
                        ["quantity_received", "Quantity Received"],
                        ["quantity_unit", "Quantity Unit"],
                        ["goods_description", "Goods Description"],
                      ].map(([field, label]) => {
                        const rawValue =
                          extraction?.fields[field] ??
                          (field === "consignee_stamp_present"
                            ? extraction?.fields.consignee_stamp
                            : field === "signature_present"
                            ? extraction?.fields.signature
                            : field === "quantity_unit"
                            ? extractFieldUnit(extraction?.fields.quantity_received)
                            : undefined);

                        const value = extractFieldValue(rawValue);
                        const reviewedValue = reviewedFields?.[field];
                        const isCorrected =
                          reviewedValue !== undefined &&
                          reviewedValue !== value;
                        const confidence =
                          extraction?.confidences[field] ??
                          (field === "consignee_stamp_present"
                            ? extraction?.confidences.consignee_stamp
                            : field === "signature_present"
                            ? extraction?.confidences.signature
                            : undefined);
                        const confidenceInfo =
                          typeof confidence === "number"
                            ? confidencePresentation(confidence)
                            : null;
                        const isFullWidth = field === "goods_description";

                        return (
                          <div
                            key={field}
                            className={`billing-ai-card ${
                              isFullWidth ? "is-full" : ""
                            }`}
                          >
                            <span className="billing-ai-label">{label}</span>
                            <div className="billing-ai-value mt-0.5">
                              {typeof value === "boolean" ? (
                                <span
                                  className={`inline-flex items-center gap-1 font-semibold ${
                                    value ? "text-emerald-700" : "text-rose-600"
                                  }`}
                                >
                                  {value ? "✓ Present" : "✕ Missing"}
                                </span>
                              ) : value === null ||
                                value === undefined ||
                                value === "" ? (
                                <span className="text-neutral-400 font-normal italic">
                                  Not detected
                                </span>
                              ) : (
                                <span className="font-semibold text-neutral-900">{String(value)}</span>
                              )}

                              {isCorrected ? (
                                <div className="billing-corrected-value mt-1">
                                  Corrected to:{" "}
                                  <strong>
                                    {typeof reviewedValue === "boolean"
                                      ? reviewedValue
                                        ? "Yes"
                                        : "No"
                                      : String(reviewedValue ?? "Not detected")}
                                  </strong>
                                </div>
                              ) : null}
                            </div>
                            {confidenceInfo ? (
                              <div className="pt-1 mt-1 border-t border-neutral-100">
                                <span
                                  className={`billing-confidence is-${confidenceInfo.level.toLowerCase()}`}
                                >
                                  {confidenceInfo.level} confidence · {confidenceInfo.percentage}%
                                </span>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}

                      {/* Full-width Remarks Section */}
                      <div className="billing-ai-card is-full">
                        <span className="billing-ai-label">Remarks</span>
                        <div className="billing-ai-value mt-1 text-neutral-800">
                          {extraction?.fields.remarks_text ? (
                            <p className="whitespace-pre-wrap leading-relaxed m-0">
                              {String(extraction.fields.remarks_text)}
                            </p>
                          ) : (
                            <span className="text-neutral-400 font-normal italic">
                              No delivery remarks recorded on POD
                            </span>
                          )}
                          {reviewedFields?.remarks_text !== undefined &&
                          reviewedFields.remarks_text !== extraction?.fields.remarks_text ? (
                            <div className="billing-corrected-value mt-1.5 pt-1 border-t border-neutral-100">
                              Corrected remarks: <strong>{String(reviewedFields.remarks_text)}</strong>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Section 3: Submitted POD Preview */}
                  <section className="billing-panel">
                    <div className="billing-panel-heading">
                      <div>
                        <h3 className="billing-panel-title">Submitted POD Document</h3>
                        <p className="billing-panel-description">
                          Attempt {latestSubmission?.attemptNo ?? "—"} · Uploaded{" "}
                          {formatDate(latestSubmission?.uploadedAt)}
                          {latestSubmission?.sizeKb ? ` · ${(latestSubmission.sizeKb).toFixed(0)} KB` : ""}
                        </p>
                      </div>
                      {latestSubmission ? (
                        <a
                          className="billing-button"
                          href={latestSubmission.imageUrl.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open original image ↗
                        </a>
                      ) : null}
                    </div>
                    <div className="px-4 pb-4">
                      {latestSubmission && !imageError ? (
                        <div className="billing-preview-wrap">
                          <Image
                            key={latestSubmission.imageUrl.url}
                            src={latestSubmission.imageUrl.url}
                            alt={`Proof of delivery for trip ${activeDetail.trip.tripCode}, attempt ${latestSubmission.attemptNo}`}
                            width={560}
                            height={700}
                            unoptimized
                            className="billing-preview-image"
                            onError={() => setImageError(true)}
                            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                          />
                        </div>
                      ) : (
                        <div className="billing-empty">
                          {imageError
                            ? "The signed POD image could not be loaded or may have expired."
                            : "No POD image is available for this trip."}
                        </div>
                      )}
                      {latestSubmission && imageError ? (
                        <button
                          type="button"
                          className="billing-button mt-3"
                          disabled={imageReloading}
                          onClick={() => void reloadPodImage(latestSubmission.id)}
                        >
                          {imageReloading ? "Reloading image…" : "Reload POD image"}
                        </button>
                      ) : null}
                      {imageReloadError ? (
                        <p className="billing-inline-error" role="alert">
                          {imageReloadError}
                        </p>
                      ) : null}
                      {latestSubmission ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="billing-button"
                              onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}
                            >
                              Zoom in ({Math.round(zoom * 100)}%)
                            </button>
                            <button
                              type="button"
                              className="billing-button"
                              onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
                            >
                              Zoom out
                            </button>
                            <button
                              type="button"
                              className="billing-button"
                              onClick={() => setRotation((value) => (value + 90) % 360)}
                            >
                              Rotate 90°
                            </button>
                          </div>
                          <span className="text-[11px] text-neutral-500">
                            Submitter: {activeDetail.trip.driver?.name ?? (activeDetail.trip.isHired ? "Hired Driver" : "Driver")}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {/* Section 4: Trip Record / Expected vs Extracted Comparison */}
                  <section className="billing-panel">
                    <div className="billing-panel-heading">
                      <div>
                        <h3 className="billing-panel-title">Trip Record & Extraction Comparison</h3>
                        <p className="billing-panel-description">
                          Side-by-side reconciliation between recorded trip requirements and extracted proof
                        </p>
                      </div>
                    </div>
                    <div className="p-4 pt-1">
                      <div className="billing-table-wrap">
                        <table className="billing-table">
                          <thead>
                            <tr>
                              <th scope="col" style={{ width: "25%" }}>Field</th>
                              <th scope="col" style={{ width: "37%" }}>AI Extracted</th>
                              <th scope="col" style={{ width: "38%" }}>Trip Record (Expected)</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td><strong className="text-neutral-900">LR Number</strong></td>
                              <td>
                                <span className="font-mono">
                                  {extractFieldValue(extraction?.fields.lr_number) ? String(extractFieldValue(extraction?.fields.lr_number)) : "Not detected"}
                                </span>
                              </td>
                              <td><span className="font-mono">{activeDetail.trip.lrNumber}</span></td>
                            </tr>
                            <tr>
                              <td><strong className="text-neutral-900">Quantity</strong></td>
                              <td>
                                <span>
                                  {extractFieldValue(extraction?.fields.quantity_received) !== undefined && extractFieldValue(extraction?.fields.quantity_received) !== null
                                    ? `${extractFieldValue(extraction?.fields.quantity_received)} ${extractFieldValue(extraction?.fields.quantity_unit) ?? extractFieldUnit(extraction?.fields.quantity_received) ?? ""}`
                                    : "Not detected"}
                                </span>
                              </td>
                              <td>
                                <span>
                                  {formatNumber(activeDetail.trip.expectedQuantity)} {activeDetail.trip.quantityUnit} (Expected)
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td><strong className="text-neutral-900">Delivered Quantity</strong></td>
                              <td>
                                <span className="text-neutral-600">
                                  {extractFieldValue(extraction?.fields.quantity_received) !== undefined && extractFieldValue(extraction?.fields.quantity_received) !== null
                                    ? `${extractFieldValue(extraction?.fields.quantity_received)} (Extracted - unconfirmed)`
                                    : "Not detected"}
                                </span>
                              </td>
                              <td>
                                <span className={activeDetail.trip.deliveredQuantity !== null ? "font-semibold text-emerald-700" : "text-amber-700 font-medium"}>
                                  {activeDetail.trip.deliveredQuantity === null
                                    ? "Not confirmed (Requires executive confirmation)"
                                    : `${formatNumber(activeDetail.trip.deliveredQuantity)} ${activeDetail.trip.quantityUnit}`}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td><strong className="text-neutral-900">Goods Description</strong></td>
                              <td><span>{extractFieldValue(extraction?.fields.goods_description) ? String(extractFieldValue(extraction?.fields.goods_description)) : "Not detected"}</span></td>
                              <td><span>{activeDetail.trip.goodsDescription}</span></td>
                            </tr>
                            <tr>
                              <td><strong className="text-neutral-900">Consignee</strong></td>
                              <td><span>Verified by stamp/signature</span></td>
                              <td><span>{activeDetail.trip.consigneeName || "—"}</span></td>
                            </tr>
                            <tr>
                              <td><strong className="text-neutral-900">Retake Attempts</strong></td>
                              <td><span>Attempt {latestSubmission?.attemptNo ?? 1}</span></td>
                              <td><span>{activeDetail.trip.retakeCount} of 2 max retakes used</span></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>

                  {/* Feedback notifications */}
                  {actionError ? <p className="billing-state is-error" role="alert">{actionError}</p> : null}
                  {actionMessage ? <p className="billing-state is-success" role="status">{actionMessage}</p> : null}

                  {/* Section 5: Review Decision */}
                  <section className="billing-panel">
                    <div className="billing-panel-heading">
                      <div>
                        <h3 className="billing-panel-title">Review Decision & Driver Feedback</h3>
                        <p className="billing-panel-description">
                          Take verification action and provide actionable feedback explaining any issues.
                        </p>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Decision Note Textarea */}
                      <label className="block space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="billing-filter-label">
                            Decision note / Message for driver
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            Required for dispute, remark, or retake &quot;Other&quot;
                          </span>
                        </div>
                        <textarea
                          className="billing-textarea w-full"
                          rows={3}
                          value={note}
                          maxLength={1000}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="Explain why you are approving with remark, requesting a retake, or marking this POD as disputed..."
                        />
                      </label>

                      {/* Request Retake Box */}
                      <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                            Request Driver Retake
                          </span>
                          <span className="text-[11px] text-amber-700">
                            {2 - activeDetail.trip.retakeCount} retakes remaining
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600">
                          Select the specific issue with the proof of delivery so the driver understands what to correct:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[
                            ["stamp_not_visible", "Consignee stamp is not visible"],
                            ["signature_missing", "Signature is missing or unclear"],
                            ["lr_not_visible", "LR number is not visible"],
                            ["lr_mismatch", "LR number does not match trip"],
                            ["quantity_unreadable", "Quantity is unreadable"],
                            ["blurry", "POD photograph is blurry"],
                            ["cropped", "Important details are cropped / cut off"],
                          ].map(([rKey, rLabel]) => (
                            <label
                              key={rKey}
                              className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer transition ${
                                retakeReason === rKey
                                  ? "border-blue-600 bg-blue-50 font-medium text-blue-900"
                                  : "border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700"
                              }`}
                            >
                              <input
                                type="radio"
                                name="retakeReasonOption"
                                value={rKey}
                                checked={retakeReason === rKey}
                                onChange={() => setRetakeReason(rKey)}
                                className="accent-blue-600"
                              />
                              <span>{rLabel}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            className="billing-button shrink-0"
                            style={{ borderColor: "#d97706", color: "#b45309" }}
                            disabled={isSubmitting || !retakeReason || (retakeReason === "other" && !note.trim())}
                            onClick={() => void submitReviewAction({
                              action: "request_retake",
                              reason: retakeReason,
                              note: note.trim() || undefined,
                            }, false)}
                          >
                            Send Retake Request to Driver
                          </button>
                        </div>
                      </div>

                      {/* Primary Actions Grid */}
                      <div className="pt-2">
                        <span className="billing-filter-label block mb-2">Other Verification Actions</span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <button
                            type="button"
                            className="billing-button billing-button-primary justify-center"
                            disabled={isSubmitting || activeDetail.trip.deliveredQuantity === null}
                            title={activeDetail.trip.deliveredQuantity === null
                              ? "Confirm delivered quantity in field corrections before approving."
                              : undefined}
                            onClick={() => void submitReviewAction({ action: "approve", note: note.trim() || undefined }, false)}
                          >
                            Approve Clean
                          </button>
                          <button
                            type="button"
                            className="billing-button justify-center"
                            disabled={isSubmitting || activeDetail.trip.deliveredQuantity === null || !note.trim()}
                            title={!note.trim() ? "Decision note required for remark" : undefined}
                            onClick={() => void submitReviewAction({ action: "approve_with_remark", note: note.trim() }, false)}
                          >
                            Approve with Remark
                          </button>
                          <button
                            type="button"
                            className="billing-button billing-button-danger justify-center"
                            disabled={isSubmitting || !note.trim()}
                            title={!note.trim() ? "Decision note required to dispute" : undefined}
                            onClick={() => void submitReviewAction({ action: "mark_disputed", note: note.trim() }, false)}
                          >
                            Mark Disputed
                          </button>
                        </div>
                      </div>

                      {activeDetail.trip.deliveredQuantity === null ? (
                        <div className="rounded border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-800">
                          ⚠️ <strong>Action Required:</strong> Confirm the actual delivered quantity and unit in the &quot;Correct extracted fields&quot; section below before approving this trip for invoicing.
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>

                <details className="billing-panel billing-corrections mt-4">
                  <summary className="billing-panel-heading billing-correction-summary">
                    <span>
                      <strong className="billing-panel-title">Correct extracted fields</strong>
                      <span className="billing-panel-description">Changes are recorded; the original AI extraction is preserved.</span>
                    </span>
                  </summary>
                  <div className="billing-correction-grid">
                    {editableFields.map((field) => (
                      <label className="billing-filter" key={field}>
                        <span className="billing-filter-label">{editableLabels[field]}</span>
                        {isBooleanField(field) ? (
                          <span className="billing-toggle-row">
                            <input
                              className="billing-checkbox"
                              type="checkbox"
                              checked={form?.[field] === true}
                              onChange={(event) => editField(field, event.target.checked)}
                            />
                            <span>{form?.[field] === true ? "Yes" : "No"}</span>
                          </span>
                        ) : field === "quantity_received" ? (
                          <input
                            className="billing-input"
                            type="number"
                            min="0"
                            step="any"
                            value={typeof form?.[field] === "string" ? form[field] : ""}
                            onChange={(event) => editField(field, event.target.value)}
                          />
                        ) : (
                          <input
                            className="billing-input"
                            type="text"
                            value={typeof form?.[field] === "string" ? form[field] : ""}
                            maxLength={
                              field === "remarks_text"
                                ? 1000
                                : field === "quantity_unit"
                                  ? 40
                                  : field === "lr_number" || field === "delivery_date"
                                    ? 100
                                    : 500
                            }
                            onChange={(event) => editField(field, event.target.value)}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="billing-batch-toolbar">
                    <span className="billing-panel-description">
                      {editedFields.size} field{editedFields.size === 1 ? "" : "s"} changed
                    </span>
                    <button
                      type="button"
                      className="billing-button billing-button-primary"
                      disabled={isSubmitting || editedFields.size === 0}
                      onClick={saveCorrections}
                    >
                      {isSubmitting ? "Saving…" : "Save corrections"}
                    </button>
                  </div>
                </details>

                <section className="billing-panel mt-4">
                  <div className="billing-panel-heading">
                    <div>
                      <h3 className="billing-panel-title">Review history</h3>
                      <p className="billing-panel-description">Recorded actions for this trip.</p>
                    </div>
                  </div>
                  {activeDetail.history.length ? (
                    activeDetail.history.map((item) => (
                      <article className="billing-history-item" key={item.id}>
                        <strong>{formatAction(item.action)}</strong> · {item.reviewer.name} · {formatDate(item.at)}
                        {item.note ? <p className="billing-review-subline">{item.note}</p> : null}
                        {Object.entries(item.fieldChanges).length ? (
                          <ul className="billing-history-changes">
                            {Object.entries(item.fieldChanges).map(([field, change]) => (
                              <li key={field}>
                                <span>{field.replaceAll("_", " ")}: </span>
                                {typeof change === "object" && change !== null && "before" in change && "after" in change
                                  ? `${String(change.before ?? "—")} → ${String(change.after ?? "—")}`
                                  : JSON.stringify(change)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <p className="billing-empty">No prior review actions.</p>
                  )}
                </section>
              </>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
