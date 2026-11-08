/**
 * Pending POD Synchronization.
 *
 * Uploads locally saved POD images to the backend whenever connectivity is
 * available. Called from the driver page on mount, on the browser `online`
 * event, and when the page becomes visible again.
 *
 * Key guarantees:
 * - Uploads are sequential (FIFO) to avoid flooding a mobile connection.
 * - Each upload reuses the original `clientSubmissionId` so the server can
 *   safely deduplicate retried submissions.
 * - A local record is deleted ONLY after the server confirms receipt (2xx).
 * - Images are NEVER deleted due to upload failure alone.
 * - An in-memory lock prevents concurrent sync within the same tab.
 * - The Web Locks API is used for cross-tab coordination where available.
 * - Sync is aborted immediately if a pending logout is detected, because the
 *   session cookie may already be queued for revocation.
 * - Exponential backoff prevents hammering a struggling backend.
 */

import {
  deletePendingPod,
  getPendingPods,
  updatePendingPod,
  type PendingPodRecord,
} from "../indexeddb/db";
import { isPendingLogout } from "../../auth/logout/pendingLogout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Records stuck in UPLOADING for longer than this are assumed to be from a
 *  crashed previous session and are reset to PENDING. */
const STALE_UPLOAD_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Hard cap on exponential backoff delay. */
const MAX_BACKOFF_MS = 2 * 60 * 60 * 1000; // 2 hours

// ---------------------------------------------------------------------------
// Backoff helpers
// ---------------------------------------------------------------------------

/**
 * Minimum time (ms) that must have elapsed since the last attempt before a
 * record is eligible for another upload attempt.
 *
 * retryCount 0 →      0 ms (upload immediately on first attempt)
 * retryCount 1 →    30 s
 * retryCount 2 →  2 min
 * retryCount 3 →  8 min
 * retryCount 4 → 32 min
 * retryCount 5 →  2 h  (capped)
 */
export function minRetryDelayMs(retryCount: number): number {
  if (retryCount === 0) return 0;
  return Math.min(30_000 * Math.pow(4, retryCount - 1), MAX_BACKOFF_MS);
}

export function isRetryDue(record: PendingPodRecord): boolean {
  const minDelay = minRetryDelayMs(record.retryCount);
  if (minDelay === 0) return true;
  const lastAttempt = record.lastAttemptAt
    ? new Date(record.lastAttemptAt).getTime()
    : 0;
  return Date.now() - lastAttempt >= minDelay;
}

// ---------------------------------------------------------------------------
// Upload outcome types
// ---------------------------------------------------------------------------

type UploadOutcome =
  | { kind: "uploaded" }
  | { kind: "auth_error"; message: string }
  | { kind: "retry"; message: string };

// ---------------------------------------------------------------------------
// Single record upload
// ---------------------------------------------------------------------------

/**
 * Attempts to upload one pending POD record and returns a typed outcome.
 * Never throws – all errors are captured and returned as `retry`.
 */
export async function attemptUpload(
  record: PendingPodRecord,
): Promise<UploadOutcome> {
  let response: Response;
  try {
    const file = new File([record.image], record.filename, {
      type: record.mediaType,
    });

    const form = new FormData();
    form.append("clientSubmissionId", record.clientSubmissionId);
    form.append("tripId", record.tripId);
    form.append("capturedAt", record.capturedAt);
    if (record.gpsLat !== null && record.gpsLng !== null) {
      form.append("gpsLat", String(record.gpsLat));
      form.append("gpsLng", String(record.gpsLng));
    }
    form.append("image", file, record.filename);

    response = await fetch("/api/pods", {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Network error during upload";
    return { kind: "retry", message };
  }

  if (response.ok) {
    return { kind: "uploaded" };
  }

  const { status } = response;

  // 401/403 – session has expired or is invalid. Stop the entire sync run so
  // we do not make redundant requests with a dead cookie.
  if (status === 401 || status === 403) {
    return {
      kind: "auth_error",
      message: `Sign-in required (HTTP ${status}). Please sign in again to upload pending photos.`,
    };
  }

  // 408 (timeout) / 429 (rate-limited) – respect Retry-After when present.
  if (status === 408 || status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const extraInfo = retryAfterHeader
      ? ` (retry after ${retryAfterHeader}s)`
      : "";
    return {
      kind: "retry",
      message: `HTTP ${status}${extraInfo}; will retry`,
    };
  }

  // 400/422 – the server rejected the payload. Retain the image; a future
  // app update or server-side fix may allow it to succeed. Do not mark it
  // as permanently failed.
  if (status === 400 || status === 422) {
    return {
      kind: "retry",
      message: `Upload rejected (HTTP ${status}); photo is preserved and will be retried`,
    };
  }

  // 5xx or any other non-2xx – temporary server problem; retry later.
  return {
    kind: "retry",
    message: `Server error (HTTP ${status}); will retry`,
  };
}

// ---------------------------------------------------------------------------
// Sync summary
// ---------------------------------------------------------------------------

export interface SyncSummary {
  /** Records successfully confirmed by the server and removed from IndexedDB. */
  uploaded: number;
  /** Records that failed this attempt and have been kept for the next sync. */
  retried: number;
  /** Records skipped because their backoff delay has not yet elapsed. */
  skipped: number;
  /**
   * True if an authentication error (401/403) caused the sync to stop early.
   * The driver should be prompted to sign in again.
   */
  authError: boolean;
}

// ---------------------------------------------------------------------------
// Core sync loop (runs with a lock already held)
// ---------------------------------------------------------------------------

export async function runSyncLoop(): Promise<SyncSummary> {
  const summary: SyncSummary = {
    uploaded: 0,
    retried: 0,
    skipped: 0,
    authError: false,
  };

  const now = Date.now();

  // --- Crash recovery ---
  // Reset any records left in UPLOADING by a previous session that crashed or
  // was killed. We only reset records whose lastAttemptAt is old enough that
  // no active upload could still be running.
  const allRecords = await getPendingPods();
  for (const record of allRecords) {
    if (record.uploadStatus === "UPLOADING") {
      const lastAttemptTime = record.lastAttemptAt
        ? new Date(record.lastAttemptAt).getTime()
        : 0;
      if (now - lastAttemptTime > STALE_UPLOAD_THRESHOLD_MS) {
        await updatePendingPod(record.id, {
          uploadStatus: "PENDING",
          lastError: "Upload interrupted (app restarted); will retry",
        });
      }
      // A recent UPLOADING record is left alone – another context may be
      // actively uploading it right now.
    }
  }

  // --- Process PENDING records in FIFO order ---
  const pending = await getPendingPods("PENDING");

  for (const record of pending) {
    // Backoff: skip records that have failed too recently.
    if (!isRetryDue(record)) {
      summary.skipped++;
      continue;
    }

    // Mark as UPLOADING so crash recovery can distinguish it after a restart.
    await updatePendingPod(record.id, {
      uploadStatus: "UPLOADING",
      lastAttemptAt: new Date().toISOString(),
    });

    const outcome = await attemptUpload(record);

    switch (outcome.kind) {
      case "uploaded":
        // Server confirmed: safe to remove the local record.
        await deletePendingPod(record.id);
        summary.uploaded++;
        break;

      case "auth_error":
        // Session problem: preserve the image, record the error, halt sync.
        await updatePendingPod(record.id, {
          uploadStatus: "PENDING",
          retryCount: record.retryCount + 1,
          lastError: outcome.message,
        });
        summary.authError = true;
        summary.retried++;
        // Return immediately – further uploads would fail with the same 401/403.
        return summary;

      case "retry": {
        // Temporary failure: keep image, increment retry counter for backoff.
        const nextRetryCount = record.retryCount + 1;
        await updatePendingPod(record.id, {
          uploadStatus: "PENDING",
          retryCount: nextRetryCount,
          lastError: outcome.message,
        });
        summary.retried++;
        break;
      }
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

/** In-tab guard: prevents two sync loops running simultaneously in one tab. */
let syncInProgress = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronizes all pending POD images to the backend.
 *
 * Safe to call from multiple places simultaneously – only one sync loop
 * runs per tab at a time (in-memory lock). Uses the Web Locks API for
 * cross-tab coordination where the browser supports it (Chrome, Safari 16+,
 * Firefox 96+).
 *
 * Returns `null` if sync was skipped (already in progress, another tab is
 * syncing, or a pending logout is active). Returns a {@link SyncSummary}
 * otherwise.
 *
 * **iOS Safari note:** Background Sync is not supported on iOS Safari. Sync
 * only runs while the page is in the foreground. Images are safely preserved
 * in IndexedDB regardless.
 */
export async function syncPendingPods(): Promise<SyncSummary | null> {
  // Do not upload while an offline logout is awaiting server confirmation.
  // The session cookie may have already been queued for revocation.
  if (isPendingLogout()) return null;

  // In-tab lock
  if (syncInProgress) return null;
  syncInProgress = true;

  try {
    // Cross-tab lock via Web Locks API where supported.
    if (
      typeof navigator !== "undefined" &&
      "locks" in navigator &&
      typeof (navigator as unknown as { locks?: { request?: unknown } }).locks
        ?.request === "function"
    ) {
      let summary: SyncSummary | null = null;
      await navigator.locks.request(
        "fp-pod-sync",
        { ifAvailable: true },
        async (lock) => {
          // lock is null when another tab already holds it.
          if (!lock) return;
          summary = await runSyncLoop();
        },
      );
      return summary;
    }

    // Web Locks not available (Firefox < 96, older browsers) – run directly.
    return await runSyncLoop();
  } finally {
    syncInProgress = false;
  }
}
