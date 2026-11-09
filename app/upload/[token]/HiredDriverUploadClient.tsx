"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { compressPodImage } from "@/src/lib/pods/storage/compression";
import {
  deletePendingPod,
  getPendingPods,
  requestPersistentStorage,
  savePendingPod,
  updatePendingPod,
} from "@/src/lib/offline/indexeddb/db";
import { buildSegments, VoiceLanguage } from "@/src/lib/voice/hybrid";
import { HybridSegmentPlayer } from "@/src/lib/voice/player";

type DriverLanguage = VoiceLanguage;

type UploadLinkData = {
  valid: boolean;
  status: "ACTIVE" | "EXPIRED" | "USED" | "REVOKED";
  expiresAt: string;
  trip: {
    id: string;
    tripCode: string;
    lrNumber: string;
    origin: string;
    destination: string;
    clientName: string;
    vehicleNo: string;
  };
};

export default function HiredDriverUploadClient({ token }: { token: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [linkData, setLinkData] = useState<UploadLinkData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form submission & state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Language & Voice
  const [language, setLanguage] = useState<DriverLanguage>("Hindi");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const playerRef = useRef<HybridSegmentPlayer | null>(null);

  // Offline indicator & pending count
  const [isOffline, setIsOffline] = useState(false);
  const [pendingPodCount, setPendingPodCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingPods("PENDING");
      setPendingPodCount(pending.length);
    } catch {
      // IndexedDB optional
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    setIsOffline(typeof navigator !== "undefined" && !navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void refreshPendingCount();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshPendingCount]);

  // Fetch token metadata on mount
  useEffect(() => {
    let active = true;
    async function verifyToken() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/upload/${token}`);
        const data = await res.json();
        if (!active) return;

        if (res.ok && data.valid) {
          setLinkData(data);
        } else {
          setLinkData(data);
          setLoadError(data.error || "This upload link is no longer active.");
        }
      } catch {
        if (active) {
          setLoadError("Network error checking link. Please check your internet connection.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    const timer = setTimeout(() => {
      void verifyToken();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token]);

  // Clean up preview object URL
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Voice playback control
  const stopAudio = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.cancel();
      playerRef.current = null;
    }
    setIsPlayingAudio(false);
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  const speakInstruction = () => {
    if (!linkData?.trip) return;
    if (isPlayingAudio) {
      stopAudio();
      return;
    }

    setVoiceNotice(null);
    setIsPlayingAudio(true);

    const tripContext = {
      id: linkData.trip.id,
      tripCode: linkData.trip.tripCode,
      client: { name: linkData.trip.clientName },
      origin: linkData.trip.origin,
      destination: linkData.trip.destination,
      vehicleNo: linkData.trip.vehicleNo,
      status: "POD_PENDING",
    };

    const segments = buildSegments(tripContext, "POD_PENDING", language);
    const player = new HybridSegmentPlayer();
    playerRef.current = player;

    player.playSegments(segments, language, {
      onStart: () => setIsPlayingAudio(true),
      onEnd: () => {
        setIsPlayingAudio(false);
        playerRef.current = null;
      },
      onError: (msg: string) => {
        setIsPlayingAudio(false);
        playerRef.current = null;
        setVoiceNotice(msg);
      },
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("Please select a valid image file (JPEG, PNG, WebP).");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadError(null);
  };

  const handleRetake = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !linkData?.trip) {
      setUploadError("Please capture or select a photo of the POD first.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadProgressText("Optimizing photo quality for AI verification…");

    try {
      const compressionResult = await compressPodImage(selectedFile, {
        targetSizeBytes: 300 * 1024,
        maxDimension: 2048,
      });

      const clientSubmissionId = crypto.randomUUID();
      const localRecordId = crypto.randomUUID();
      const capturedAt = new Date().toISOString();
      const filename = selectedFile.name.replace(/\.[^/.]+$/, ".jpg") || `${linkData.trip.tripCode}.jpg`;

      // GPS metadata if permitted
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

      // Offline storage first (IndexedDB)
      await requestPersistentStorage();
      await savePendingPod({
        id: localRecordId,
        clientSubmissionId,
        tripId: linkData.trip.id,
        tripCode: linkData.trip.tripCode,
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
        setUploadProgressText(null);
        setUploadSuccess(true);
        return;
      }

      setUploadProgressText("Uploading POD to Haulmark…");

      const compressedFile = new File(
        [compressionResult.blob],
        filename,
        { type: compressionResult.mediaType || "image/jpeg" },
      );

      const formData = new FormData();
      formData.append("clientSubmissionId", clientSubmissionId);
      formData.append("capturedAt", capturedAt);
      if (gpsLat !== null && gpsLng !== null) {
        formData.append("gpsLat", String(gpsLat));
        formData.append("gpsLng", String(gpsLng));
      }
      formData.append("image", compressedFile, compressedFile.name);

      await updatePendingPod(localRecordId, {
        uploadStatus: "UPLOADING",
        lastAttemptAt: new Date().toISOString(),
      });

      const res = await fetch(`/api/upload/${token}`, {
        method: "POST",
        body: formData,
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || `Upload failed (Status ${res.status})`);
      }

      await deletePendingPod(localRecordId);
      await refreshPendingCount();
      setUploadSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed. Photo saved on phone.";
      setUploadError(msg);
    } finally {
      setUploading(false);
      setUploadProgressText(null);
    }
  };

  // 1. Loading state
  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-[#0B4044] border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-[#5f6b72]">Verifying secure upload link…</p>
      </div>
    );
  }

  // 2. Success state
  if (uploadSuccess) {
    return (
      <div className="w-full max-w-[480px] mx-auto py-6 sm:py-10 space-y-5">
        <div className="w-full bg-white border border-[#e3e6e8] rounded-[10px] p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 bg-[#f3f7f7] text-[#0B4044] border border-[#0B4044]/20 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
            ✓
          </div>
          <div className="space-y-1.5">
            <h1 className="text-base font-semibold text-neutral-900">
              {isOffline ? "Photo Saved on Phone" : "POD Uploaded Successfully"}
            </h1>
            <p className="text-xs text-[#5f6b72] leading-relaxed">
              {isOffline
                ? "No network connection. Your photo has been safely saved on this device and will upload as soon as you are back online."
                : `Your Proof of Delivery for Trip ${linkData?.trip.tripCode} has been received and queued for automated verification.`}
            </p>
          </div>
          <div className="bg-[#f8faf9] rounded-[10px] p-4 text-xs text-[#5f6b72] space-y-2 text-left border border-[#e3e6e8]">
            <div className="flex justify-between">
              <span>LR Number:</span>
              <span className="font-mono font-medium text-neutral-900">{linkData?.trip.lrNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Vehicle:</span>
              <span className="font-mono font-medium text-neutral-900">{linkData?.trip.vehicleNo}</span>
            </div>
            <div className="flex justify-between">
              <span>Client:</span>
              <span className="font-medium text-neutral-900 truncate max-w-[200px]">{linkData?.trip.clientName}</span>
            </div>
          </div>
          <p className="text-[11px] text-[#5f6b72]">
            You can safely close this window now.
          </p>
        </div>
        <div className="text-center text-[11px] text-[#5f6b72]">
          Haulmark Logistics Management
        </div>
      </div>
    );
  }

  // 3. Inactive / Expired / Revoked state
  if (!linkData || !linkData.valid || loadError) {
    let title = "Upload Link Inactive";
    let desc = loadError || "This upload link is no longer valid or has expired.";
    let badgeStyle = "bg-[#f8faf9] text-[#5f6b72] border-[#e3e6e8]";

    if (linkData?.status === "EXPIRED") {
      title = "Upload Link Expired";
      desc = "This link was valid for 48 hours and has expired. Please contact the logistics billing team to receive a fresh upload link.";
      badgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
    } else if (linkData?.status === "USED") {
      title = "POD Already Submitted";
      desc = "A Proof of Delivery document has already been submitted using this link. If a retake was requested, please ask the billing coordinator for a new link.";
      badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200";
    } else if (linkData?.status === "REVOKED") {
      title = "Upload Link Revoked";
      desc = "This link was cancelled by the logistics operations team. Please contact the billing coordinator if you need to submit a POD.";
      badgeStyle = "bg-neutral-100 text-neutral-600 border-[#e3e6e8]";
    }

    return (
      <div className="w-full max-w-[480px] mx-auto py-6 sm:py-10 space-y-5">
        <div className="w-full bg-white border border-[#e3e6e8] rounded-[10px] p-6 sm:p-8 text-center space-y-5">
          <div className={`w-12 h-12 rounded-full border flex items-center justify-center mx-auto text-xl font-bold ${badgeStyle}`}>
            !
          </div>
          <div className="space-y-1.5">
            <h1 className="text-base font-semibold text-neutral-900">{title}</h1>
            <p className="text-xs text-[#5f6b72] leading-relaxed">{desc}</p>
          </div>
          {linkData?.trip && (
            <div className="bg-[#f8faf9] rounded-[10px] p-4 text-xs text-[#5f6b72] space-y-2 text-left border border-[#e3e6e8]">
              <div className="flex justify-between">
                <span>Trip:</span>
                <span className="font-semibold text-neutral-900">{linkData.trip.tripCode}</span>
              </div>
              <div className="flex justify-between">
                <span>LR Number:</span>
                <span className="font-mono text-neutral-900">{linkData.trip.lrNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Vehicle:</span>
                <span className="font-mono text-neutral-900">{linkData.trip.vehicleNo}</span>
              </div>
            </div>
          )}
          <div className="pt-2">
            <p className="text-[11px] text-[#5f6b72]">Haulmark Digital Logistics Management</p>
          </div>
        </div>
      </div>
    );
  }

  const greeting = language === "Hindi" ? "नमस्ते" : language === "Marathi" ? "नमस्कार" : "Hello";

  // 4. Active upload form matching Driver Page style
  return (
    <div className="space-y-6">
      {/* Offline Banner */}
      {isOffline ? (
        <div
          role="status"
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

      {/* Pending Photos notice */}
      {pendingPodCount > 0 ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[10px] border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-[12px] font-medium text-neutral-700"
        >
          <svg className="h-3.5 w-3.5 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{pendingPodCount} photo{pendingPodCount > 1 ? "s" : ""} saved on phone waiting for network</span>
        </div>
      ) : null}

      {/* Header with Greeting & Language Switcher */}
      <div className="flex items-center justify-between pb-3 border-b border-[#e3e6e8]">
        <p className="text-[15px] font-normal text-[#14181b]">
          {greeting}, <span className="font-semibold">Driver</span>
        </p>
        <div className="flex items-center gap-1.5 text-[12px]" aria-label="Language options">
          {(["Hindi", "Marathi", "English"] as const).map((lang, idx) => (
            <span key={lang} className="flex items-center gap-1.5">
              {idx > 0 && <span className="text-[#e3e6e8] select-none">·</span>}
              <button
                type="button"
                onClick={() => {
                  stopAudio();
                  setLanguage(lang);
                }}
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

      {/* Current Trip Section */}
      <section aria-labelledby="hired-trip-heading" className="space-y-4">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-[#5f6b72] uppercase">
            Delivery Proof
          </span>
          <div className="mt-1 flex items-center justify-between gap-3">
            <h1
              id="hired-trip-heading"
              className="text-[26px] font-semibold tracking-tight text-[#14181b]"
            >
              {linkData.trip.tripCode}
            </h1>
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
          </div>

          <div className="mt-1.5 flex items-center gap-2 text-[14px] font-medium text-[#14181b]">
            <svg className="h-4 w-4 text-[#0B4044] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
            </svg>
            <span>{linkData.trip.origin}</span>
            <span className="text-[#5f6b72]">→</span>
            <span>{linkData.trip.destination}</span>
          </div>
        </div>

        {/* Trip Key Details (Grid layout matching Driver App) */}
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
              <p className="font-medium text-[#14181b]">{linkData.trip.vehicleNo}</p>
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
              <p className="font-medium text-[#14181b] truncate max-w-[140px]" title={linkData.trip.clientName}>
                {linkData.trip.clientName}
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
              <p className="font-medium text-[#14181b]">{linkData.trip.lrNumber}</p>
            </div>
          </div>
        </div>

        {/* Upload Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />

          {/* Photo Preview if chosen */}
          {previewUrl ? (
            <div className="space-y-2.5">
              <div className="relative w-full aspect-[3/4] max-h-80 rounded-[10px] overflow-hidden bg-neutral-100 border border-[#e3e6e8]">
                <Image
                  src={previewUrl}
                  alt="POD Preview"
                  fill
                  unoptimized
                  className="object-contain"
                />
              </div>
              <button
                type="button"
                onClick={handleRetake}
                disabled={uploading}
                className="flex h-11 w-full items-center justify-center rounded-[8px] border border-[#e3e6e8] bg-white text-[13px] font-medium text-[#14181b] hover:bg-neutral-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0B4044]/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Retake Photo
              </button>
            </div>
          ) : null}

          {/* The Big Action: 64px Teal Button + Audio Speaker Button */}
          <div className="flex items-center gap-2.5">
            {!previewUrl ? (
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-16 flex-1 items-center justify-center gap-3 rounded-[10px] bg-[#0B4044] text-[17px] font-semibold text-white shadow-xs transition-colors hover:bg-[#083235] active:bg-[#062527] focus:outline-none focus:ring-3 focus:ring-[#0B4044]/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Photograph POD</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={uploading}
                className="flex h-16 flex-1 items-center justify-center gap-3 rounded-[10px] bg-[#0B4044] text-[17px] font-semibold text-white shadow-xs transition-colors hover:bg-[#083235] active:bg-[#062527] focus:outline-none focus:ring-3 focus:ring-[#0B4044]/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <svg className="h-5 w-5 animate-spin text-white" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span>Uploading POD…</span>
                  </>
                ) : (
                  <span>Submit POD</span>
                )}
              </button>
            )}

            {/* 🔊 Audio prompt button */}
            <button
              type="button"
              onClick={speakInstruction}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[10px] border border-[#e3e6e8] bg-white text-[#0B4044] transition-colors hover:bg-neutral-50 active:bg-neutral-100 focus:outline-none focus:ring-3 focus:ring-[#0B4044]/20"
              aria-label={isPlayingAudio ? "Stop spoken instruction" : `Listen to instruction in ${language}`}
              title={isPlayingAudio ? "Stop spoken instruction" : `Listen to instruction in ${language}`}
            >
              {isPlayingAudio ? (
                <svg className="h-6 w-6 text-[#0B4044]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>
          </div>

          {voiceNotice ? (
            <div
              role="alert"
              className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
            >
              {voiceNotice}
            </div>
          ) : null}

          {uploadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-[10px] text-xs text-red-700" role="alert">
              {uploadError}
            </div>
          )}

          {uploadProgressText && (
            <div className="p-3 bg-[#f3f7f7] border border-[#0B4044]/30 rounded-[10px] text-xs text-[#0B4044] flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin text-[#0B4044]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>{uploadProgressText}</span>
            </div>
          )}
        </form>
      </section>

      <div className="pt-8 text-center text-[11px] text-[#5f6b72]">
        Haulmark Logistics Platform • Secure Driver Upload
      </div>
    </div>
  );
}
