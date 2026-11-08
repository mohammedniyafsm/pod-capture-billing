"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { InfoCard } from "@/src/components/InfoCard";
import { StatusBadge } from "@/src/components/StatusBadge";
import { isPendingLogout } from "@/src/lib/auth/logout/pendingLogout";
import {
  fetchJson,
  FleetProofApiError,
  formatNumber,
  type UserSession,
} from "@/src/lib/fleetproof";
import {
  deletePendingPod,
  getCachedDriverTrips,
  getPendingPods,
  requestPersistentStorage,
  saveDriverTrips,
  savePendingPod,
  updatePendingPod,
} from "@/src/lib/offline/indexeddb/db";
import { syncPendingPods } from "@/src/lib/offline/sync/podSync";
import { compressPodImage } from "@/src/lib/pods/storage/compression";

type DriverTrip = {
  id: string;
  tripCode: string;
  origin: string;
  destination: string;
  client?: { name: string } | null;
  lrNumber: string;
  goodsDescription: string;
  expectedQuantity: number | string;
  quantityUnit: string;
  status: string;
  statusReason?: string | null;
  podSubmissions: Array<{
    id: string;
    status: string;
    retakeReason: string | null;
    attemptsLeft: number | null;
  }>;
};

export default function DriverPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sessionUser, setSessionUser] = useState<UserSession | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [tripLoadError, setTripLoadError] = useState<string | null>(null);
  const [tripReloadKey, setTripReloadKey] = useState(0);
  const [isOfflineData, setIsOfflineData] = useState(false);
  /** Number of POD images currently waiting to be uploaded to the server. */
  const [pendingPodCount, setPendingPodCount] = useState(0);
  /** True while syncPendingPods() is actively running. */
  const [isSyncing, setIsSyncing] = useState(false);
  /** Set when a sync stops early because the session needs re-authentication. */
  const [syncAuthError, setSyncAuthError] = useState(false);

  /** Refreshes the displayed count of locally pending POD images. */
  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingPods("PENDING");
      setPendingPodCount(pending.length);
    } catch {
      // Non-critical: ignore IndexedDB errors during count refresh
    }
  }, []);

  /**
   * Runs the POD sync loop and updates sync-status state.
   * No-ops if already in progress (syncPendingPods() manages its own lock).
   */
  const triggerSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncAuthError(false);
    try {
      const result = await syncPendingPods();
      if (result?.authError) {
        setSyncAuthError(true);
      }
    } catch {
      // Sync errors are non-critical; images are safe in IndexedDB
    } finally {
      setIsSyncing(false);
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    const initialize = async () => {
      // If a logout is pending server-side confirmation, do NOT render driver workspace
      if (isPendingLogout()) {
        router.replace("/");
        return;
      }

      try {
        const me = await fetchJson<{ user: UserSession }>("/api/auth/me");
        if (!me.user || me.user.role !== "DRIVER") {
          // Explicit unauthorized or wrong role: clear cached snapshot and redirect
          localStorage.removeItem("fp_driver_offline_session");
          router.replace("/");
          return;
        }

        setSessionUser(me.user);
        // Keep non-sensitive driver session identity cached for offline shell display
        try {
          localStorage.setItem("fp_driver_offline_session", JSON.stringify(me.user));
        } catch {
          // LocalStorage fallback optional
        }
      } catch (error) {
        // HTTP 401 or 403 means session expired or unauthorized - DO NOT fallback to offline session!
        if (
          error instanceof FleetProofApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          localStorage.removeItem("fp_driver_offline_session");
          router.replace("/");
          setSessionUser(null);
          return;
        }

        // True network failure / offline: check if we have a saved driver session snapshot
        try {
          const cachedSession = localStorage.getItem("fp_driver_offline_session");
          if (cachedSession) {
            const parsed = JSON.parse(cachedSession) as UserSession;
            if (parsed.role === "DRIVER") {
              setSessionUser(parsed);
              return;
            }
          }
        } catch {
          // Ignore parse errors
        }
        router.replace("/");
        setSessionUser(null);
      }
    };
    void initialize();
  }, [router]);

  /**
   * Automatic POD synchronization.
   *
   * Triggered:
   * 1. On mount, after the driver session is confirmed.
   * 2. When the browser fires the `online` event (device reconnects).
   * 3. When the page becomes visible again (driver returns to the app).
   *
   * Note: Background Sync (service worker) is NOT implemented here because
   * the service worker cannot read the `fp_pending_logout_purge` localStorage
   * flag. Foreground sync covers all in-app scenarios reliably across all
   * browsers, including iOS Safari.
   */
  useEffect(() => {
    if (!sessionUser || sessionUser.role !== "DRIVER") return;

    // Initial sync on page load after session is confirmed (deferred so setState is not synchronous in effect body)
    const timer = setTimeout(() => {
      void triggerSync();
      void refreshPendingCount();
    }, 0);

    const handleOnline = () => void triggerSync();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void triggerSync();
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [sessionUser, triggerSync, refreshPendingCount]);

  useEffect(() => {
    if (!sessionUser || sessionUser.role !== "DRIVER") return;
    let active = true;

    const loadTrips = async () => {
      setIsLoading(true);
      setTripLoadError(null);
      setIsOfflineData(false);
      try {
        const payload = await fetchJson<{ trips: DriverTrip[] }>("/api/my-trips");
        const nextTrips = payload.trips ?? [];
        if (!active) return;
        setTrips(nextTrips);
        if (nextTrips[0]) {
          setSelectedTripId(nextTrips[0].id);
        } else {
          setSelectedTripId(null);
        }
        // Save minimal trip summaries for offline use
        void saveDriverTrips(sessionUser.id, nextTrips);
      } catch (error) {
        if (!active) return;
        // If HTTP 401/403, don't show cached trips - session is expired
        if (
          error instanceof FleetProofApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          router.replace("/");
          return;
        }

        // Network or server error: check if we have cached offline trips for this driver
        try {
          const cached = await getCachedDriverTrips(sessionUser.id);
          if (!active) return;
          if (cached.length > 0) {
            setTrips(cached as DriverTrip[]);
            setSelectedTripId(cached[0].id);
            setIsOfflineData(true);
            return;
          }
        } catch {
          // IndexedDB query failed, proceed to error display
        }
        setTripLoadError(
          error instanceof Error
            ? `${error.message}. No offline trips saved on this device.`
            : "Unable to load trips.",
        );
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadTrips();

    return () => {
      active = false;
    };
  }, [sessionUser, tripReloadKey, router]);

  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? trips[0] ?? null,
    [selectedTripId, trips],
  );

  useEffect(() => {
    const pending = trips.filter(
      (trip) =>
        trip.status === "AI_CHECKING" &&
        trip.podSubmissions[0]?.status === "AI_CHECKING",
    );
    if (pending.length === 0) return;

    let active = true;
    let polling = false;
    const pollStatuses = async () => {
      if (polling) return;
      polling = true;
      try {
        const updates = await Promise.all(
          pending.map(async (trip) => ({
            tripId: trip.id,
            result: await fetchJson<{
              submission: {
                id: string;
                status: string;
                verdict: string | null;
                retakeReason: string | null;
                attemptsLeft: number | null;
              };
              trip: { status: string };
            }>(`/api/pods/${encodeURIComponent(trip.podSubmissions[0].id)}/status`),
          })),
        );
        if (!active) return;
        setTrips((current) => {
          let changed = false;
          const next = current.map((trip) => {
            const update = updates.find((item) => item.tripId === trip.id);
            if (!update) return trip;
            const latest = {
              id: update.result.submission.id,
              status: update.result.submission.status,
              retakeReason: update.result.submission.retakeReason,
              attemptsLeft: update.result.submission.attemptsLeft,
            };
            if (
              trip.status === update.result.trip.status &&
              trip.podSubmissions[0]?.id === latest.id &&
              trip.podSubmissions[0]?.status === latest.status &&
              trip.podSubmissions[0]?.retakeReason === latest.retakeReason &&
              trip.podSubmissions[0]?.attemptsLeft === latest.attemptsLeft
            ) {
              return trip;
            }
            changed = true;
            return {
              ...trip,
              status: update.result.trip.status,
              podSubmissions: [latest],
            };
          });
          return changed ? next : current;
        });
        setStatus(null);
      } catch {
        if (active) {
          setStatus(
            "Verification status could not be refreshed. FleetProof will keep checking.",
          );
        }
      } finally {
        polling = false;
      }
    };

    const interval = window.setInterval(() => void pollStatuses(), 2500);
    void pollStatuses();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [trips]);

  const updateTripStatus = (tripId: string, nextStatus: string) => {
    setTrips((currentTrips) =>
      currentTrips.map((trip) =>
        trip.id === tripId ? { ...trip, status: nextStatus } : trip,
      ),
    );
  };

  const handleTripTransition = async (transition: "start" | "complete") => {
    if (!selectedTrip) return;

    setTransitioning(true);
    setStatus(null);
    try {
      const result = await fetchJson<{ status: string }>(
        `/api/trips/${selectedTrip.id}/${transition}`,
        { method: "POST" },
      );
      updateTripStatus(selectedTrip.id, result.status);
      setStatus(
        transition === "start"
          ? "Trip started. Complete the delivery when you arrive."
          : "Delivery completed. You can now capture the POD.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update trip status.");
    } finally {
      setTransitioning(false);
    }
  };

  const handleCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedTrip) return;

    setUploading(true);
    setStatus(null);

    try {
      // 1 & 2. Compress the captured photo automatically
      const compressionResult = await compressPodImage(file, {
        targetSizeBytes: 300 * 1024,
        maxDimension: 2048,
      });

      const clientSubmissionId = crypto.randomUUID();
      const localRecordId = crypto.randomUUID();
      const capturedAt = new Date().toISOString();
      const filename = file.name.replace(/\.[^/.]+$/, ".jpg") || `${selectedTrip.tripCode}.jpg`;

      // 3. Collect GPS if permission is available (timeout 2.5s so capture is not stalled)
      let gpsLat: number | null = null;
      let gpsLng: number | null = null;
      if (typeof navigator !== "undefined" && "geolocation" in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 2500,
              maximumAge: 60000,
            });
          });
          gpsLat = Number(pos.coords.latitude.toFixed(6));
          gpsLng = Number(pos.coords.longitude.toFixed(6));
        } catch {
          // GPS is optional: delivery capture proceeds even if GPS is denied/unavailable
        }
      }

      // 4. Save to IndexedDB locally BEFORE any network upload attempt
      await requestPersistentStorage();
      await savePendingPod({
        id: localRecordId,
        clientSubmissionId,
        tripId: selectedTrip.id,
        tripCode: selectedTrip.tripCode,
        image: compressionResult.blob,
        filename,
        mediaType: compressionResult.mediaType || "image/jpeg",
        capturedAt,
        gpsLat,
        gpsLng,
        uploadStatus: "PENDING",
        retryCount: 0,
        lastAttemptAt: null,
        createdAt: new Date().toISOString(),
        lastError: null,
      });
      // Update the pending count immediately so the driver sees the saved photo
      await refreshPendingCount();

      // If offline, inform driver immediately that photo is safely saved
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setStatus("No internet. Photo saved safely");
        return;
      }

      // 5. If online, attempt upload using the EXACT same clientSubmissionId
      setStatus("Photo saved on this phone");

      const compressedFile = new File(
        [compressionResult.blob],
        filename,
        { type: compressionResult.mediaType || "image/jpeg" },
      );

      const payload = new FormData();
      payload.append("clientSubmissionId", clientSubmissionId);
      payload.append("tripId", selectedTrip.id);
      payload.append("capturedAt", capturedAt);
      if (gpsLat !== null && gpsLng !== null) {
        payload.append("gpsLat", String(gpsLat));
        payload.append("gpsLng", String(gpsLng));
      }
      payload.append("image", compressedFile, compressedFile.name);

      await updatePendingPod(localRecordId, {
        uploadStatus: "UPLOADING",
        lastAttemptAt: new Date().toISOString(),
      });

      const response = await fetch("/api/pods", {
        method: "POST",
        credentials: "include",
        body: payload,
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = result?.error || "Upload failed. Photo saved safely on phone.";
        await updatePendingPod(localRecordId, {
          uploadStatus: "PENDING",
          lastError: errorMsg,
        });
        setStatus("Waiting for network. Photo saved safely");
        return;
      }

      const submission = result?.data as
        | { submissionId: string; status: string }
        | undefined;
      if (!submission?.submissionId) {
        throw new Error("POD upload was accepted without a submission ID.");
      }

      // 6. Delete or mark uploaded in IndexedDB ONLY AFTER verified server confirmation
      await deletePendingPod(localRecordId);
      await refreshPendingCount();

      setTrips((currentTrips) =>
        currentTrips.map((trip) =>
          trip.id === selectedTrip.id
            ? {
              ...trip,
              status: "AI_CHECKING",
              podSubmissions: [
                {
                  id: submission.submissionId,
                  status: submission.status,
                  retakeReason: null,
                  attemptsLeft: null,
                },
              ],
            }
            : trip,
        ),
      );
      setStatus("POD uploaded successfully. AI verification is in progress...");
    } catch (error) {
      setStatus(
        error instanceof Error && error.message.includes("IndexedDB")
          ? "Photo could not be saved. Please try again."
          : "Photo saved on this phone",
      );
    } finally {
      setUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading assigned trips">
        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="h-[320px] animate-pulse rounded-xl border border-fp-border bg-fp-surface sm:h-[420px]" aria-hidden="true" />
          <div className="h-[320px] animate-pulse rounded-xl border border-fp-border bg-fp-surface sm:h-[420px]" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (!sessionUser || sessionUser.role !== "DRIVER") {
    return (
      <div className="fp-driver-panel">
        <h2 className="m-0 text-lg font-semibold text-fp-text">Driver access required</h2>
        <p className="mt-2">Please sign in as a driver to view this section.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
      <section className="fp-driver-panel">
        {isOfflineData ? (
          <div className="fp-driver-notice fp-driver-notice-warning mb-4" role="status">
            Offline mode: Displaying cached trip data from this phone.
          </div>
        ) : null}
        {syncAuthError ? (
          <div className="fp-driver-notice fp-driver-notice-error mb-4" role="alert">
            Upload needs attention: please sign in again to upload pending photos.
          </div>
        ) : pendingPodCount > 0 ? (
          <div className="fp-driver-notice fp-driver-notice-warning mb-4" role="status">
            {isSyncing
              ? `Uploading ${pendingPodCount} pending photo${pendingPodCount > 1 ? "s" : ""}…`
              : typeof navigator !== "undefined" && !navigator.onLine
                ? `${pendingPodCount} photo${pendingPodCount > 1 ? "s" : ""} waiting for internet`
                : `${pendingPodCount} photo${pendingPodCount > 1 ? "s" : ""} pending upload`}
          </div>
        ) : null}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="fp-driver-eyebrow m-0">Assigned trip</p>
            <h2 className="fp-driver-trip-title">{selectedTrip?.tripCode ?? "No trip assigned"}</h2>
          </div>
          {selectedTrip ? <StatusBadge status={selectedTrip.status} /> : null}
        </div>

        {selectedTrip ? (
          <>
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              <InfoCard label="Vehicle" value={selectedTrip.tripCode} />
              <InfoCard label="Client" value={selectedTrip.client?.name ?? "—"} />
              <InfoCard label="Route" value={`${selectedTrip.origin} → ${selectedTrip.destination}`} />
              <InfoCard label="LR No" value={selectedTrip.lrNumber} />
              <InfoCard label="Goods" value={selectedTrip.goodsDescription} />
              <InfoCard label="Expected quantity" value={`${formatNumber(selectedTrip.expectedQuantity)} ${selectedTrip.quantityUnit}`} />
            </div>

            {selectedTrip.status === "ASSIGNED" ? (
              <button
                type="button"
                disabled={transitioning}
                onClick={() => void handleTripTransition("start")}
                className="fp-button-primary fp-driver-action fp-focus-ring"
                aria-busy={transitioning}
              >
                {transitioning ? "Starting trip..." : "Start trip"}
              </button>
            ) : selectedTrip.status === "IN_TRANSIT" ? (
              <button
                type="button"
                disabled={transitioning}
                onClick={() => void handleTripTransition("complete")}
                className="fp-button-primary fp-driver-action fp-focus-ring"
                aria-busy={transitioning}
              >
                {transitioning ? "Completing delivery..." : "Complete delivery"}
              </button>
            ) : selectedTrip.status === "POD_PENDING" ||
              selectedTrip.status === "RETAKE_REQUESTED" ? (
              <>
                {selectedTrip.podSubmissions[0]?.status === "FAILED" ? (
                  <div className="fp-driver-notice fp-driver-notice-error mb-3" role="alert">
                    <strong className="block font-semibold">Verification could not be completed</strong>
                    <p className="mt-1 text-xs">There was an issue processing the upload. Please take and upload a fresh photo.</p>
                  </div>
                ) : null}
                {selectedTrip.status === "RETAKE_REQUESTED" ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 mb-4 text-left shadow-sm">
                    <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wider mb-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                      Action Required: Upload POD Again
                    </div>
                    <p className="text-xs text-neutral-800 font-medium leading-relaxed mb-2.5">
                      The logistics office reviewed your POD document and requested a clearer photograph.
                    </p>

                    {/* Specific Reason */}
                    {selectedTrip.podSubmissions[0]?.retakeReason || selectedTrip.statusReason ? (
                      <div className="bg-white/80 rounded-lg border border-amber-200/80 p-2.5 text-xs text-neutral-700 space-y-1 mb-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
                          Reason:
                        </span>
                        <p className="m-0 font-medium text-neutral-900">
                          {selectedTrip.podSubmissions[0]?.retakeReason === "stamp_not_visible"
                            ? "Consignee stamp is not visible on the document"
                            : selectedTrip.podSubmissions[0]?.retakeReason === "signature_missing"
                            ? "Receiver signature is missing or unclear"
                            : selectedTrip.podSubmissions[0]?.retakeReason === "lr_not_visible"
                            ? "LR number is not visible"
                            : selectedTrip.podSubmissions[0]?.retakeReason === "lr_mismatch"
                            ? "LR number does not match this trip"
                            : selectedTrip.podSubmissions[0]?.retakeReason === "quantity_unreadable"
                            ? "Delivered quantity is unreadable"
                            : selectedTrip.podSubmissions[0]?.retakeReason === "blurry"
                            ? "Photograph is blurry"
                            : selectedTrip.podSubmissions[0]?.retakeReason === "cropped"
                            ? "Document corners or details are cut off"
                            : selectedTrip.podSubmissions[0]?.retakeReason || "Correction needed"}
                        </p>
                        {selectedTrip.statusReason &&
                        selectedTrip.statusReason !== selectedTrip.podSubmissions[0]?.retakeReason ? (
                          <div className="pt-1.5 mt-1 border-t border-neutral-100">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block">
                              Message from billing team:
                            </span>
                            <p className="m-0 italic text-neutral-800 mt-0.5">
                              &ldquo;{selectedTrip.statusReason}&rdquo;
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Actionable Instructions */}
                    <div className="text-[11px] text-neutral-600 space-y-1">
                      <span className="font-semibold text-neutral-800 block">What you need to do:</span>
                      <ol className="list-decimal pl-4 space-y-0.5 m-0">
                        <li>Flatten the physical signed Challan / LR in good lighting.</li>
                        <li>Ensure the consignee stamp, signature, and quantity are fully visible.</li>
                        <li>Take a clear, unblurred photo and tap the button below.</li>
                      </ol>
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="fp-button-primary fp-driver-action fp-focus-ring"
                  aria-busy={uploading}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 7h3l1.5-2h7L17 7h3v12H4z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                  {uploading
                    ? "Uploading POD..."
                    : selectedTrip.status === "RETAKE_REQUESTED"
                    ? "Upload POD Again"
                    : "Take POD photo"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleCapture}
                />
              </>
            ) : (
              <div className="fp-driver-notice">
                {selectedTrip.status === "VERIFIED"
                  ? "POD verified and approved successfully. No further action is needed."
                  : selectedTrip.status === "AI_CHECKING"
                    ? "Your POD has been received and is being verified by automated checks..."
                    : selectedTrip.status === "NEEDS_REVIEW"
                      ? "Your POD has been received and is currently under review by our billing team. No action is required right now."
                      : selectedTrip.status === "DISPUTED"
                        ? `Delivery record is under dispute (${selectedTrip.statusReason || "discrepancy detected"}). Please contact operations.`
                        : "No action is needed for this trip right now."}
              </div>
            )}

            {status ? (
              <div className="fp-driver-notice mt-4" role="status" aria-live="polite">
                {status}
              </div>
            ) : null}
          </>
        ) : tripLoadError ? (
          <div className="fp-driver-notice fp-driver-notice-error text-center">
            <p className="m-0">{tripLoadError}</p>
            <button
              type="button"
              onClick={() => setTripReloadKey((key) => key + 1)}
              className="fp-button-secondary fp-focus-ring mt-3"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="fp-driver-notice border-dashed py-10 text-center text-fp-muted">
            No assigned trip is available right now.
          </div>
        )}
      </section>

      <aside className="fp-driver-panel">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-fp-text">Trips</h3>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
            {trips.length}
          </span>
        </div>
        <div className="space-y-3">
          {trips.map((trip) => (
            <button
              key={trip.id}
              type="button"
              onClick={() => setSelectedTripId(trip.id)}
              aria-pressed={selectedTrip?.id === trip.id}
              className="fp-trip-choice fp-focus-ring"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="fp-trip-choice-name">{trip.tripCode}</span>
                <StatusBadge status={trip.status} />
              </div>
              <div className="fp-trip-choice-route">{trip.origin} → {trip.destination}</div>
              <div className="fp-trip-choice-client">{trip.client?.name ?? "Client"}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
