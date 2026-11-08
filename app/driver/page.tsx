"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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

type DriverLanguage = "Hindi" | "Marathi" | "English";

type DriverTrip = {
  id: string;
  tripCode: string;
  vehicleNo?: string;
  origin: string;
  destination: string;
  client?: { name: string } | null;
  lrNumber: string;
  goodsDescription: string;
  expectedQuantity: number | string;
  quantityUnit: string;
  status: string;
  statusReason?: string | null;
  retakeCount?: number;
  podSubmissions: Array<{
    id: string;
    status: string;
    retakeReason: string | null;
    attemptsLeft: number | null;
  }>;
};

/* -------------------------------------------------------------------------- */
/* Status Badge with Icon + Label (Color is never used alone)                 */
/* -------------------------------------------------------------------------- */
function DriverStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "VERIFIED":
      return (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800"
        >
          <svg className="h-3 w-3 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Verified
        </span>
      );
    case "RETAKE_REQUESTED":
      return (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900"
        >
          <svg className="h-3 w-3 text-amber-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Retake needed
        </span>
      );
    case "NEEDS_REVIEW":
      return (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-800"
        >
          <svg className="h-3 w-3 text-orange-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
          Needs review
        </span>
      );
    case "AI_CHECKING":
      return (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800"
        >
          <svg className="h-3 w-3 animate-spin text-sky-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Checking...
        </span>
      );
    case "POD_PENDING":
      return (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-700"
        >
          <svg className="h-3 w-3 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Photo pending
        </span>
      );
    case "IN_TRANSIT":
      return (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-700"
        >
          <svg className="h-3 w-3 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
            <path d="M15 18H9" />
            <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
            <circle cx="17" cy="18" r="2" />
            <circle cx="7" cy="18" r="2" />
          </svg>
          In transit
        </span>
      );
    case "ASSIGNED":
    default:
      return (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-700"
        >
          <svg className="h-3 w-3 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Assigned
        </span>
      );
  }
}

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
  const [pendingPodCount, setPendingPodCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncAuthError, setSyncAuthError] = useState(false);

  // Language state (Hindi / Marathi / English)
  const [language, setLanguage] = useState<DriverLanguage>("Hindi");

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingPods("PENDING");
      setPendingPodCount(pending.length);
    } catch {
      // Non-critical
    }
  }, []);

  const triggerSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncAuthError(false);
    try {
      const result = await syncPendingPods();
      if (result?.authError) {
        setSyncAuthError(true);
      }
    } catch {
      // Sync errors non-critical
    } finally {
      setIsSyncing(false);
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  // Auth initialize
  useEffect(() => {
    const initialize = async () => {
      if (isPendingLogout()) {
        router.replace("/");
        return;
      }

      try {
        const me = await fetchJson<{ user: UserSession }>("/api/auth/me");
        if (!me.user || me.user.role !== "DRIVER") {
          localStorage.removeItem("fp_driver_offline_session");
          router.replace("/");
          return;
        }

        setSessionUser(me.user);
        if (me.user.language === "Marathi") setLanguage("Marathi");
        else if (me.user.language === "English") setLanguage("English");
        else setLanguage("Hindi");

        try {
          localStorage.setItem("fp_driver_offline_session", JSON.stringify(me.user));
        } catch {
          // LocalStorage fallback optional
        }
      } catch (error) {
        if (
          error instanceof FleetProofApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          localStorage.removeItem("fp_driver_offline_session");
          router.replace("/");
          setSessionUser(null);
          return;
        }

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

  // Sync listener
  useEffect(() => {
    if (!sessionUser || sessionUser.role !== "DRIVER") return;

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

  // Load trips
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
        void saveDriverTrips(sessionUser.id, nextTrips);
      } catch (error) {
        if (!active) return;
        if (
          error instanceof FleetProofApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          router.replace("/");
          return;
        }

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
          // Proceed to error display
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

  // Polling for AI_CHECKING
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
        setTrips((currentTrips) =>
          currentTrips.map((trip) => {
            const match = updates.find((item) => item.tripId === trip.id);
            if (!match) return trip;
            return {
              ...trip,
              status: match.result.trip.status,
              podSubmissions: [
                {
                  id: match.result.submission.id,
                  status: match.result.submission.status,
                  retakeReason: match.result.submission.retakeReason,
                  attemptsLeft: match.result.submission.attemptsLeft,
                },
              ],
            };
          }),
        );
      } catch {
        // Polling failure non-fatal
      } finally {
        polling = false;
      }
    };

    const intervalId = setInterval(() => {
      void pollStatuses();
    }, 3000);

    return () => {
      active = false;
      clearInterval(intervalId);
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
          ? "Trip started. Tap Complete Delivery upon arrival."
          : "Delivery completed. Please photograph the signed POD.",
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
      const compressionResult = await compressPodImage(file, {
        targetSizeBytes: 300 * 1024,
        maxDimension: 2048,
      });

      const clientSubmissionId = crypto.randomUUID();
      const localRecordId = crypto.randomUUID();
      const capturedAt = new Date().toISOString();
      const filename = file.name.replace(/\.[^/.]+$/, ".jpg") || `${selectedTrip.tripCode}.jpg`;

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
          // GPS optional
        }
      }

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
      await refreshPendingCount();

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setStatus("No internet. Photo saved safely on your phone and will upload automatically.");
        return;
      }

      setStatus("Photo saved on this phone. Uploading...");

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
        setStatus("Waiting for network. Photo saved safely on phone.");
        return;
      }

      const submission = result?.data as
        | { submissionId: string; status: string }
        | undefined;
      if (!submission?.submissionId) {
        throw new Error("POD upload was accepted without a submission ID.");
      }

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
      setStatus("POD uploaded successfully. Automatic verification in progress...");
    } catch (error) {
      setStatus(
        error instanceof Error && error.message.includes("IndexedDB")
          ? "Photo could not be saved. Please try again."
          : "Photo saved on this phone.",
      );
    } finally {
      setUploading(false);
    }
  };

  /* -------------------------------------------------------------------------- */
  /* Voice Prompt (Web SpeechSynthesis API in hi-IN / mr-IN / en-IN)             */
  /* -------------------------------------------------------------------------- */
  const speakCurrentInstruction = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!selectedTrip) return;

    let text = "";
    if (selectedTrip.status === "ASSIGNED") {
      text =
        language === "Hindi"
          ? "यात्रा शुरू करने के लिए स्टार्ट ट्रिप बटन दबाएं।"
          : language === "Marathi"
          ? "प्रवास सुरू करण्यासाठी स्टार्ट ट्रिप बटण दाबा."
          : "Tap Start Trip to begin your journey.";
    } else if (selectedTrip.status === "IN_TRANSIT") {
      text =
        language === "Hindi"
          ? "सामान पहुंचाने के बाद कंप्लीट डिलीवरी बटन दबाएं।"
          : language === "Marathi"
          ? "डिलिव्हरी पूर्ण झाल्यावर कम्प्लीट डिलिव्हरी बटण दाबा."
          : "Tap Complete Delivery when you reach the destination.";
    } else if (selectedTrip.status === "VERIFIED") {
      text =
        language === "Hindi"
          ? "पीओडी सत्यापित हो चुका है। अब कुछ करने की आवश्यकता नहीं है।"
          : language === "Marathi"
          ? "पीओडी पडताळणी झाली आहे. पुढील कोणतीही कृती आवश्यक नाही."
          : "POD verified. Nothing more to do.";
    } else if (selectedTrip.status === "RETAKE_REQUESTED") {
      text =
        language === "Hindi"
          ? "फ़ोटो स्पष्ट नहीं है। कृपया स्टैम्प और हस्ताक्षर के साथ दोबारा फ़ोटो लें।"
          : language === "Marathi"
          ? "फोटो स्पष्ट नाही. कृपया शिक्का आणि सहीसह पुन्हा फोटो काढा."
          : "The photo was not clear. Please photograph the POD again with stamp and signature visible.";
    } else {
      text =
        language === "Hindi"
          ? "कृपया हस्ताक्षरित डिलीवरी चालान की साफ़ फ़ोटो खींचें और अपलोड करें।"
          : language === "Marathi"
          ? "कृपया सही केलेल्या पोहोच पावतीचा स्पष्ट फोटो काढून अपलोड करा."
          : "Please take a clear photograph of the signed POD document.";
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language === "Hindi" ? "hi-IN" : language === "Marathi" ? "mr-IN" : "en-IN";
      window.speechSynthesis.speak(utterance);
    } catch {
      // SpeechSynthesis error non-critical
    }
  };

  // Human retake reason translation
  const getRetakeReasonText = (reason: string | null | undefined): string => {
    switch (reason) {
      case "stamp_not_visible":
        return "Consignee stamp is not visible";
      case "signature_missing":
        return "Receiver signature is missing";
      case "lr_not_visible":
        return "LR number is not visible";
      case "lr_mismatch":
        return "LR number does not match this trip";
      case "quantity_unreadable":
        return "Delivered quantity is unreadable";
      case "blurry":
        return "Photograph is blurry";
      case "cropped":
        return "Document edges or corners are cut off";
      default:
        return reason || "Correction needed";
    }
  };

  // Loading skeleton state
  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading assigned trips">
        {/* Greeting Skeleton */}
        <div className="flex items-center justify-between pb-2 border-b border-[#e3e6e8]">
          <div className="h-5 w-32 animate-pulse rounded bg-neutral-200" />
          <div className="h-4 w-28 animate-pulse rounded bg-neutral-100" />
        </div>

        {/* 2-Column Responsive Skeleton Grid on Desktop */}
        <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] lg:gap-12 lg:items-start">
          {/* Current Trip Skeleton */}
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-neutral-200" />
              <div className="h-8 w-44 animate-pulse rounded bg-neutral-200" />
              <div className="h-4 w-36 animate-pulse rounded bg-neutral-100" />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 py-3 border-y border-[#e3e6e8]">
              <div className="h-8 animate-pulse rounded bg-neutral-100" />
              <div className="h-8 animate-pulse rounded bg-neutral-100" />
              <div className="h-8 animate-pulse rounded bg-neutral-100" />
              <div className="h-8 animate-pulse rounded bg-neutral-100" />
              <div className="h-8 col-span-2 lg:col-span-2 animate-pulse rounded bg-neutral-100" />
            </div>

            <div className="h-16 animate-pulse rounded-[10px] bg-neutral-200" />
          </div>

          {/* List Skeleton */}
          <div className="space-y-3 pt-4 lg:pt-1 border-t lg:border-t-0 border-[#e3e6e8]">
            <div className="h-4 w-24 animate-pulse rounded bg-neutral-200" />
            <div className="h-14 animate-pulse rounded bg-neutral-100" />
            <div className="h-14 animate-pulse rounded bg-neutral-100" />
            <div className="h-14 animate-pulse rounded bg-neutral-100" />
          </div>
        </div>
      </div>
    );
  }

  // Not signed in state
  if (!sessionUser || sessionUser.role !== "DRIVER") {
    return (
      <div className="py-12 text-center">
        <h2 className="text-base font-semibold text-[#14181b]">Driver access required</h2>
        <p className="mt-1 text-sm text-[#5f6b72]">Please sign in as a driver to view your trips.</p>
      </div>
    );
  }

  const greeting =
    language === "Hindi" ? "नमस्ते" : language === "Marathi" ? "नमस्कार" : "Hello";

  const isOffline =
    (typeof navigator !== "undefined" && !navigator.onLine) || isOfflineData;

  const retakeLimitReached =
    Boolean(
      selectedTrip &&
        (selectedTrip.retakeCount && selectedTrip.retakeCount >= 2) ||
        selectedTrip?.status === "NEEDS_REVIEW" ||
        selectedTrip?.podSubmissions[0]?.attemptsLeft === 0,
    );

  return (
    <div className="space-y-6">
      {/* Offline Alert Banner */}
      {isOffline ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2.5 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[12px] font-medium text-amber-900"
        >
          <svg className="h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span>No network. Photos are saved on your phone and will upload automatically.</span>
        </div>
      ) : null}

      {/* Sync Error Notice */}
      {syncAuthError ? (
        <div
          role="alert"
          className="rounded-[10px] border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-medium text-rose-800"
        >
          Upload needs attention: please sign in again to upload pending photos.
        </div>
      ) : null}

      {/* Pending Photos Status */}
      {pendingPodCount > 0 ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[10px] border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-[12px] font-medium text-neutral-700"
        >
          {isSyncing ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin text-[#0B4044]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>Uploading {pendingPodCount} saved photo{pendingPodCount > 1 ? "s" : ""}...</span>
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{pendingPodCount} photo{pendingPodCount > 1 ? "s" : ""} saved on phone waiting for network</span>
            </>
          )}
        </div>
      ) : null}

      {/* 2. Greeting line + Language switcher */}
      <div className="flex items-center justify-between pb-3 border-b border-[#e3e6e8]">
        <p className="text-[15px] font-normal text-[#14181b]">
          {greeting}, <span className="font-semibold">{sessionUser.name || "Driver"}</span>
        </p>
        <div className="flex items-center gap-1.5 text-[12px]" aria-label="Language options">
          {(["Hindi", "Marathi", "English"] as const).map((lang, idx) => (
            <span key={lang} className="flex items-center gap-1.5">
              {idx > 0 && <span className="text-[#e3e6e8] select-none">·</span>}
              <button
                type="button"
                onClick={() => setLanguage(lang)}
                className={`transition-colors py-0.5 px-1 focus:outline-none ${
                  language === lang
                    ? "font-semibold text-[#0B4044] underline underline-offset-4"
                    : "text-[#5f6b72] hover:text-[#14181b]"
                }`}
              >
                {lang === "Hindi" ? "हिंदी" : lang === "Marathi" ? "मराठी" : "English"}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 2-Column Responsive Layout on Desktop (Left: Current Trip, Right: My trips sticky) */}
      <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] lg:gap-12 lg:items-start">
        {/* 3. Current Trip Section (Left Column on Desktop) */}
        <div className="min-w-0">
          {selectedTrip ? (
            <section aria-labelledby="current-trip-heading" className="space-y-4">
              <div>
                <span className="text-[11px] font-semibold tracking-wider text-[#5f6b72] uppercase">
                  Current trip
                </span>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <h1
                    id="current-trip-heading"
                    className="text-[26px] font-semibold tracking-tight text-[#14181b]"
                  >
                    {selectedTrip.tripCode}
                  </h1>
                  <DriverStatusBadge status={selectedTrip.status} />
                </div>

                {/* Route row with icon */}
                <div className="mt-1.5 flex items-center gap-2 text-[14px] font-medium text-[#14181b]">
                  <svg className="h-4 w-4 text-[#0B4044] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
                  </svg>
                  <span>{selectedTrip.origin}</span>
                  <span className="text-[#5f6b72]">→</span>
                  <span>{selectedTrip.destination}</span>
                </div>
              </div>

              {/* Key Details: 2-column on mobile, 3-column on desktop (no boxed cards!) */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3.5 border-y border-[#e3e6e8] py-4 text-[13px]">
                {/* Vehicle Number */}
                <div className="flex items-start gap-2">
                  <svg className="h-4 w-4 text-[#5f6b72] mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
                    <path d="M15 18H9" />
                    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
                    <circle cx="17" cy="18" r="2" />
                    <circle cx="7" cy="18" r="2" />
                  </svg>
                  <div>
                    <p className="text-[11px] text-[#5f6b72]">Vehicle</p>
                    <p className="font-medium text-[#14181b]">{selectedTrip.vehicleNo || "—"}</p>
                  </div>
                </div>

                {/* Client */}
                <div className="flex items-start gap-2">
                  <svg className="h-4 w-4 text-[#5f6b72] mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                    <path d="M9 22v-4h6v4" />
                    <path d="M8 6h.01" />
                    <path d="M16 6h.01" />
                    <path d="M8 10h.01" />
                    <path d="M16 10h.01" />
                    <path d="M8 14h.01" />
                    <path d="M16 14h.01" />
                  </svg>
                  <div>
                    <p className="text-[11px] text-[#5f6b72]">Client</p>
                    <p className="font-medium text-[#14181b] truncate max-w-[140px]" title={selectedTrip.client?.name ?? "—"}>
                      {selectedTrip.client?.name ?? "—"}
                    </p>
                  </div>
                </div>

                {/* LR Number */}
                <div className="flex items-start gap-2">
                  <svg className="h-4 w-4 text-[#5f6b72] mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  <div>
                    <p className="text-[11px] text-[#5f6b72]">LR number</p>
                    <p className="font-medium text-[#14181b]">{selectedTrip.lrNumber}</p>
                  </div>
                </div>

                {/* Expected Quantity */}
                <div className="flex items-start gap-2">
                  <svg className="h-4 w-4 text-[#5f6b72] mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  <div>
                    <p className="text-[11px] text-[#5f6b72]">Quantity</p>
                    <p className="font-medium text-[#14181b]">
                      {formatNumber(selectedTrip.expectedQuantity)} {selectedTrip.quantityUnit}
                    </p>
                  </div>
                </div>

                {/* Goods Description */}
                <div className="col-span-2 lg:col-span-2 flex items-start gap-2">
                  <svg className="h-4 w-4 text-[#5f6b72] mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  <div>
                    <p className="text-[11px] text-[#5f6b72]">Goods</p>
                    <p className="font-medium text-[#14181b]">{selectedTrip.goodsDescription}</p>
                  </div>
                </div>
              </div>

              {/* 4. THE MAIN ACTION */}
              <div>
                {/* Case A: Trip is Verified */}
                {selectedTrip.status === "VERIFIED" ? (
                  <div
                    role="status"
                    className="flex items-center gap-3 rounded-[10px] border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-900"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-emerald-900">POD verified</p>
                      <p className="text-[12px] text-emerald-700">Nothing more to do for this trip.</p>
                    </div>
                  </div>
                ) : retakeLimitReached ? (
                  /* Case B: Retake limit reached / In office review */
                  <div
                    role="status"
                    className="flex items-center gap-3 rounded-[10px] border border-orange-200 bg-orange-50/70 p-4 text-orange-950"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700">
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-orange-950">Under Office Review</p>
                      <p className="text-[12px] text-orange-800">
                        Maximum photo attempts reached. The office team is manually reviewing your delivery proof.
                      </p>
                    </div>
                  </div>
                ) : selectedTrip.status === "AI_CHECKING" ? (
                  /* Case C: Automated checking in progress */
                  <div
                    role="status"
                    className="flex items-center gap-3 rounded-[10px] border border-sky-200 bg-sky-50/70 p-4 text-sky-950"
                  >
                    <svg className="h-5 w-5 animate-spin text-sky-600 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <div>
                      <p className="text-[14px] font-semibold text-sky-950">Verifying POD Photo</p>
                      <p className="text-[12px] text-sky-800">Automatic checks are reviewing stamp and signature...</p>
                    </div>
                  </div>
                ) : (
                  /* Case D: Actionable Button (Photograph POD / Start Trip / Complete Delivery) */
                  <div className="space-y-3">
                    {/* Retake Alert Message if requested */}
                    {selectedTrip.status === "RETAKE_REQUESTED" ? (
                      <div
                        role="alert"
                        className="rounded-[10px] border border-amber-300 bg-amber-50 p-3.5 text-left text-amber-950"
                      >
                        <div className="flex items-center gap-2 font-semibold text-[13px] text-amber-900">
                          <svg className="h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span>
                            Photo Retake Needed (Retake {Math.min(2, (selectedTrip.retakeCount ?? 0) + 1)} of 2)
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] text-amber-800">
                          Reason: <strong className="font-medium text-amber-950">{getRetakeReasonText(selectedTrip.podSubmissions[0]?.retakeReason || selectedTrip.statusReason)}</strong>
                        </p>
                        {selectedTrip.statusReason &&
                        selectedTrip.statusReason !== selectedTrip.podSubmissions[0]?.retakeReason ? (
                          <p className="mt-1 text-[11px] italic text-amber-700">
                            &ldquo;{selectedTrip.statusReason}&rdquo;
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Primary Button + Voice Prompt Button */}
                    <div className="flex items-center gap-2.5">
                      {selectedTrip.status === "ASSIGNED" ? (
                        <button
                          type="button"
                          disabled={transitioning}
                          onClick={() => void handleTripTransition("start")}
                          className="flex h-16 flex-1 items-center justify-center gap-2.5 rounded-[10px] bg-[#0B4044] text-[16px] font-semibold text-white shadow-xs transition-colors hover:bg-[#083235] active:bg-[#062527] focus:outline-none focus:ring-3 focus:ring-[#0B4044]/20 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-busy={transitioning}
                        >
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                          <span>{transitioning ? "Starting trip..." : "Start Trip"}</span>
                        </button>
                      ) : selectedTrip.status === "IN_TRANSIT" ? (
                        <button
                          type="button"
                          disabled={transitioning}
                          onClick={() => void handleTripTransition("complete")}
                          className="flex h-16 flex-1 items-center justify-center gap-2.5 rounded-[10px] bg-[#0B4044] text-[16px] font-semibold text-white shadow-xs transition-colors hover:bg-[#083235] active:bg-[#062527] focus:outline-none focus:ring-3 focus:ring-[#0B4044]/20 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-busy={transitioning}
                        >
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>{transitioning ? "Completing delivery..." : "Complete Delivery"}</span>
                        </button>
                      ) : (
                        /* Default POD Capture Button (At least 64px tall, teal, camera icon) */
                        <button
                          type="button"
                          disabled={uploading}
                          onClick={() => fileInputRef.current?.click()}
                          className="flex h-16 flex-1 items-center justify-center gap-3 rounded-[10px] bg-[#0B4044] text-[17px] font-semibold text-white shadow-xs transition-colors hover:bg-[#083235] active:bg-[#062527] focus:outline-none focus:ring-3 focus:ring-[#0B4044]/20 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-busy={uploading}
                        >
                          {uploading ? (
                            <>
                              <svg className="h-5 w-5 animate-spin text-white" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                              </svg>
                              <span>Uploading POD...</span>
                            </>
                          ) : (
                            <>
                              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                <circle cx="12" cy="13" r="4" />
                              </svg>
                              <span>{selectedTrip.status === "RETAKE_REQUESTED" ? "Retake POD Photo" : "Photograph POD"}</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* 🔊 Voice Prompt Button */}
                      <button
                        type="button"
                        onClick={speakCurrentInstruction}
                        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[10px] border border-[#e3e6e8] bg-white text-[#0B4044] transition-colors hover:bg-neutral-50 active:bg-neutral-100 focus:outline-none focus:ring-3 focus:ring-[#0B4044]/20"
                        aria-label={`Listen to instruction in ${language}`}
                        title={`Listen to instruction in ${language}`}
                      >
                        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                      </button>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      className="hidden"
                      onChange={handleCapture}
                    />
                  </div>
                )}

                {/* Status Feedback Notice */}
                {status ? (
                  <div
                    className="mt-3 rounded-[8px] border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] font-medium text-neutral-800"
                    role="status"
                    aria-live="polite"
                  >
                    {status}
                  </div>
                ) : null}
              </div>
            </section>
          ) : tripLoadError ? (
            /* Error State with Try Again Button */
            <div className="py-12 text-center border border-red-200 bg-red-50/50 rounded-[10px] p-6">
              <p className="text-[14px] font-medium text-red-800">{tripLoadError}</p>
              <button
                type="button"
                onClick={() => setTripReloadKey((key) => key + 1)}
                className="mt-3 inline-flex h-10 items-center justify-center rounded-[8px] bg-white border border-red-300 px-4 text-[13px] font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                Try again
              </button>
            </div>
          ) : (
            /* Empty State */
            <div className="py-12 text-center border border-dashed border-[#e3e6e8] rounded-[10px] p-6">
              <svg className="mx-auto h-8 w-8 text-[#5f6b72]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              <p className="mt-2 text-[14px] font-medium text-[#14181b]">No trips assigned yet</p>
              <p className="mt-0.5 text-[12px] text-[#5f6b72]">When you receive an assignment, it will appear here.</p>
            </div>
          )}
        </div>

        {/* 5. "My trips" list (Right Column on Desktop, Sticky) */}
        {trips.length > 0 ? (
          <aside
            aria-labelledby="my-trips-heading"
            className="pt-2 lg:pt-0 lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-1"
          >
            <div className="flex items-center justify-between pb-2">
              <h2 id="my-trips-heading" className="text-[14px] font-semibold text-[#14181b]">
                My trips
              </h2>
              <span className="text-[12px] font-medium text-[#5f6b72]">
                {trips.length} {trips.length === 1 ? "trip" : "trips"}
              </span>
            </div>

            <div className="border-t border-[#e3e6e8] divide-y divide-[#e3e6e8]" role="list">
              {trips.map((trip) => {
                const isSelected = selectedTrip?.id === trip.id;
                return (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => {
                      setSelectedTripId(trip.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    aria-pressed={isSelected}
                    className={`flex w-full min-h-[56px] items-center justify-between py-3.5 text-left transition-colors focus:outline-none focus:bg-neutral-50 ${
                      isSelected
                        ? "border-l-4 border-[#0B4044] pl-3 pr-1"
                        : "pl-2 pr-1 hover:bg-neutral-50/70"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <p className={`text-[14px] font-semibold ${isSelected ? "text-[#0B4044]" : "text-[#14181b]"}`}>
                        {trip.tripCode}
                      </p>
                      <p className="text-[12px] font-medium text-[#5f6b72]">
                        {trip.origin} → {trip.destination}
                      </p>
                      <p className="text-[11px] text-[#5f6b72] truncate max-w-[190px]">
                        {trip.client?.name ?? "Client"}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <DriverStatusBadge status={trip.status} />
                      <svg
                        className="h-4 w-4 text-[#5f6b72]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
