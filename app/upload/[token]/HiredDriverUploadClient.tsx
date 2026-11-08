"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { compressPodImage } from "@/src/lib/pods/storage/compression";

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

  // Form submission & retry state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

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

  // Clean up preview object URL on unmount or file change
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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
    setSubmissionId(null); // Reset clientSubmissionId when a genuinely new photo is picked
    setUploadError(null);
  };

  const handleRetake = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setSubmissionId(null); // Reset clientSubmissionId when retaking
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !linkData || !linkData.valid) return;

    setUploading(true);
    setUploadError(null);
    setUploadProgressText("Optimizing image for fast upload...");

    try {
      // 1. Client-side compression
      let fileToUpload: Blob = selectedFile;
      try {
        const compressed = await compressPodImage(selectedFile);
        fileToUpload = compressed.blob;
      } catch {
        // Fallback to original file if compression fails in browser
        fileToUpload = selectedFile;
      }

      setUploadProgressText("Getting GPS location (optional)...");
      let latitude: number | null = null;
      let longitude: number | null = null;

      try {
        if (typeof navigator !== "undefined" && "geolocation" in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 4000,
              enableHighAccuracy: true,
            });
          });
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        }
      } catch {
        // GPS failure is non-fatal; external driver uploads work without GPS
      }

      setUploadProgressText("Uploading Proof of Delivery...");

      // Ensure stable clientSubmissionId across retries for the same image attempt
      const activeSubmissionId = submissionId || crypto.randomUUID();
      if (!submissionId) {
        setSubmissionId(activeSubmissionId);
      }

      // 2. Prepare FormData according to parsePodUploadRequest contract
      const formData = new FormData();
      formData.append(
        "image",
        fileToUpload,
        selectedFile.name.endsWith(".jpg") || selectedFile.name.endsWith(".jpeg")
          ? selectedFile.name
          : "pod_capture.jpg"
      );
      formData.append("tripId", linkData.trip.id);
      formData.append("clientSubmissionId", activeSubmissionId);
      formData.append("capturedAt", new Date().toISOString());

      if (
        latitude !== null &&
        longitude !== null &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude)
      ) {
        formData.append("gpsLat", latitude.toString());
        formData.append("gpsLng", longitude.toString());
      }

      const res = await fetch(`/api/upload/${token}`, {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || `Upload failed (Status ${res.status})`);
      }

      setUploadSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setUploadError(msg);
    } finally {
      setUploading(false);
      setUploadProgressText(null);
    }
  };

  // 1. Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f4] text-neutral-800 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-medium text-neutral-500">Verifying secure upload link…</p>
        </div>
      </div>
    );
  }

  // 2. Success state
  if (uploadSuccess) {
    return (
      <div className="min-h-screen bg-[#f5f5f4] text-neutral-900 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white border border-neutral-200 rounded-xl p-6 sm:p-8 text-center shadow-sm space-y-5">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
            ✓
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-neutral-900">POD Uploaded Successfully</h1>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Your Proof of Delivery for Trip{" "}
              <strong className="font-semibold text-neutral-900">{linkData?.trip.tripCode}</strong> has been received and queued for automated verification.
            </p>
          </div>
          <div className="bg-neutral-50 rounded-lg p-4 text-xs text-neutral-600 space-y-1.5 text-left border border-neutral-200/80">
            <div className="flex justify-between">
              <span className="text-neutral-500">LR Number:</span>
              <span className="font-mono font-medium text-neutral-900">{linkData?.trip.lrNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Vehicle:</span>
              <span className="font-mono font-medium text-neutral-900">{linkData?.trip.vehicleNo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Client:</span>
              <span className="font-medium text-neutral-900 truncate max-w-[200px]">{linkData?.trip.clientName}</span>
            </div>
          </div>
          <p className="text-[11px] text-neutral-400">
            You can safely close this window now.
          </p>
        </div>
        <div className="mt-6 text-center text-[11px] text-neutral-400">
          FleetProof Logistics Management
        </div>
      </div>
    );
  }

  // 3. Invalid / Expired / Revoked / Used state
  if (!linkData || !linkData.valid || loadError) {
    let title = "Upload Link Inactive";
    let desc = loadError || "This upload link is no longer valid or has expired.";
    let badgeClass = "bg-amber-50 text-amber-700 border-amber-200";

    if (linkData?.status === "EXPIRED") {
      title = "Upload Link Expired";
      desc = "This link was valid for 48 hours and has expired. Please contact the logistics billing team to receive a fresh upload link.";
      badgeClass = "bg-rose-50 text-rose-700 border-rose-200";
    } else if (linkData?.status === "USED") {
      title = "POD Already Submitted";
      desc = "A Proof of Delivery document has already been submitted using this link. If a retake was requested, please ask the billing coordinator for a new link.";
      badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
    } else if (linkData?.status === "REVOKED") {
      title = "Upload Link Revoked";
      desc = "This link was cancelled by the logistics operations team. Please contact the billing coordinator if you need to submit a POD.";
      badgeClass = "bg-neutral-100 text-neutral-600 border-neutral-300";
    }

    return (
      <div className="min-h-screen bg-[#f5f5f4] text-neutral-900 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white border border-neutral-200 rounded-xl p-6 sm:p-8 text-center shadow-sm space-y-5">
          <div className={`w-12 h-12 rounded-full border flex items-center justify-center mx-auto text-xl font-bold ${badgeClass}`}>
            !
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-neutral-900">{title}</h1>
            <p className="text-xs text-neutral-600 leading-relaxed">{desc}</p>
          </div>
          {linkData?.trip && (
            <div className="bg-neutral-50 rounded-lg p-4 text-xs text-neutral-600 space-y-1.5 text-left border border-neutral-200/80">
              <div className="flex justify-between">
                <span className="text-neutral-500">Trip:</span>
                <span className="font-semibold text-neutral-900">{linkData.trip.tripCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">LR Number:</span>
                <span className="font-mono text-neutral-900">{linkData.trip.lrNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Vehicle:</span>
                <span className="font-mono text-neutral-900">{linkData.trip.vehicleNo}</span>
              </div>
            </div>
          )}
          <div className="pt-2">
            <p className="text-[11px] text-neutral-400">FleetProof Digital Logistics Management</p>
          </div>
        </div>
      </div>
    );
  }

  // 4. Active upload form
  return (
    <div className="min-h-screen bg-[#f5f5f4] text-neutral-900 flex flex-col justify-between p-4 sm:p-6">
      <div className="w-full max-w-md mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <span className="fp-brand-mark">FP</span>
            <div>
              <span className="text-[10px] font-bold tracking-wider uppercase text-blue-600 block leading-none">
                FleetProof
              </span>
              <h1 className="text-base font-bold text-neutral-900 leading-tight">Proof of Delivery</h1>
            </div>
          </div>
          <span className="billing-status is-success text-[10px]">
            Link Active
          </span>
        </div>

        {/* Trip Context Card */}
        <div className="bg-white border border-neutral-200 rounded-xl p-4 text-xs shadow-sm space-y-2.5">
          <div className="flex justify-between items-center pb-2 border-b border-neutral-100">
            <div>
              <span className="text-[10px] uppercase font-semibold text-neutral-500 block">Trip Code</span>
              <span className="text-sm font-bold text-neutral-900">{linkData.trip.tripCode}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-semibold text-neutral-500 block">LR Number</span>
              <span className="font-mono font-semibold text-neutral-900">{linkData.trip.lrNumber}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-neutral-700">
            <div>
              <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Route</span>
              <span className="truncate block font-medium">{linkData.trip.origin} → {linkData.trip.destination}</span>
            </div>
            <div>
              <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Vehicle</span>
              <span className="font-mono font-medium text-neutral-900">{linkData.trip.vehicleNo}</span>
            </div>
            <div className="col-span-2 pt-1 border-t border-neutral-50">
              <span className="text-neutral-500 block text-[10px] uppercase font-semibold">Client</span>
              <span className="truncate block font-medium text-neutral-900">{linkData.trip.clientName}</span>
            </div>
          </div>
        </div>

        {/* Upload Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 shadow-sm space-y-3.5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700">
                Photograph Signed Delivery Challan / LR
              </label>
              <p className="text-[11px] text-neutral-500 mt-1">
                Take a clear, flat photo showing the consignee stamp, signature, and quantity clearly.
              </p>
            </div>

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
              disabled={uploading}
            />

            {/* Image Preview / Selector Area */}
            {!previewUrl ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full py-10 px-4 border-2 border-dashed border-neutral-300 hover:border-blue-500 rounded-xl flex flex-col items-center justify-center gap-2 bg-neutral-50 hover:bg-blue-50/30 transition text-neutral-600"
              >
                <div className="w-11 h-11 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center text-xl">
                  📷
                </div>
                <span className="text-xs font-semibold text-neutral-900">Tap to Take Photo / Choose File</span>
                <span className="text-[10px] text-neutral-500">Supports JPEG, PNG, WebP up to 15MB</span>
              </button>
            ) : (
              <div className="space-y-2.5">
                <div className="relative w-full aspect-[3/4] max-h-80 rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200">
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
                  className="billing-button w-full justify-center text-xs"
                >
                  Retake Photo
                </button>
              </div>
            )}

            {uploadError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {uploadError}
              </div>
            )}

            {uploadProgressText && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span>{uploadProgressText}</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className={`w-full py-3 px-4 rounded-lg font-semibold text-xs tracking-wide uppercase transition flex items-center justify-center gap-2 shadow-sm ${
              !selectedFile || uploading
                ? "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-[0.99]"
            }`}
          >
            {uploading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Submitting POD…
              </>
            ) : (
              "Submit Proof of Delivery"
            )}
          </button>
        </form>
      </div>

      <div className="py-4 text-center text-[10px] text-neutral-400">
        FleetProof Logistics Platform • Secure Driver Upload
      </div>
    </div>
  );
}

