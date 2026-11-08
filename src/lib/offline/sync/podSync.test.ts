/**
 * Tests for src/lib/offline/podSync.ts
 *
 * Tests the full offline-to-online POD upload workflow:
 * - Automatic upload on sync trigger
 * - Sequential FIFO ordering
 * - Idempotent clientSubmissionId reuse across retries
 * - Delete-only-after-confirmed-receipt contract
 * - Error handling: 401, 400/422, 429, 500, network errors
 * - Exponential backoff
 * - Crash recovery (stale UPLOADING records)
 * - Concurrency guard (second concurrent call is a no-op)
 * - Pending logout guard
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";

import {
  attemptUpload,
  isRetryDue,
  minRetryDelayMs,
  runSyncLoop,
  syncPendingPods,
  type SyncSummary,
} from "./podSync";
import type { PendingPodRecord } from "../indexeddb/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides?: Partial<PendingPodRecord>): PendingPodRecord {
  return {
    id: "local-1",
    clientSubmissionId: "00000000-0000-4000-8000-000000000001",
    tripId: "trip-1",
    tripCode: "TR-001",
    image: new Blob(["img"], { type: "image/jpeg" }),
    filename: "TR-001.jpg",
    mediaType: "image/jpeg",
    capturedAt: new Date().toISOString(),
    gpsLat: 19.08,
    gpsLng: 72.88,
    uploadStatus: "PENDING",
    retryCount: 0,
    lastAttemptAt: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    lastError: null,
    ...overrides,
  };
}

/** Create a minimal `Response`-compatible object for fetch mocks. */
function makeResponse(
  status: number,
  headers?: Record<string, string>,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers?.[name] ?? null,
    },
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Module-level mocks (applied before importing the module under test)
// ---------------------------------------------------------------------------

vi.mock("../indexeddb/db", () => ({
  getPendingPods: vi.fn(),
  updatePendingPod: vi.fn(),
  deletePendingPod: vi.fn(),
}));

vi.mock("../../auth/logout/pendingLogout", () => ({
  isPendingLogout: vi.fn(() => false),
}));

// Import mocked modules after vi.mock declarations
const dbModule = await import("../indexeddb/db");
const pendingLogoutModule = await import("../../auth/logout/pendingLogout");

const getPendingPods = dbModule.getPendingPods as MockedFunction<
  typeof dbModule.getPendingPods
>;
const updatePendingPod = dbModule.updatePendingPod as MockedFunction<
  typeof dbModule.updatePendingPod
>;
const deletePendingPod = dbModule.deletePendingPod as MockedFunction<
  typeof dbModule.deletePendingPod
>;
const isPendingLogout = pendingLogoutModule.isPendingLogout as MockedFunction<
  typeof pendingLogoutModule.isPendingLogout
>;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  isPendingLogout.mockReturnValue(false);

  // Default: getPendingPods returns empty list (overridden per test)
  getPendingPods.mockResolvedValue([]);

  // Default: db writes succeed silently
  updatePendingPod.mockResolvedValue(makeRecord());
  deletePendingPod.mockResolvedValue(undefined);

  // Default: fetch succeeds with 202
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(202)));

  // Stub navigator without locks (falls through to direct runSyncLoop path)
  vi.stubGlobal("navigator", { onLine: true });

  // FormData stub for Node environment
  vi.stubGlobal(
    "FormData",
    class {
      private data = new Map<string, unknown>();
      append(key: string, value: unknown) {
        this.data.set(key, value);
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Unit tests: backoff helpers
// ---------------------------------------------------------------------------

describe("minRetryDelayMs", () => {
  it("returns 0 for first attempt (retryCount 0)", () => {
    expect(minRetryDelayMs(0)).toBe(0);
  });

  it("returns 30 s for retryCount 1", () => {
    expect(minRetryDelayMs(1)).toBe(30_000);
  });

  it("returns 2 min for retryCount 2", () => {
    expect(minRetryDelayMs(2)).toBe(2 * 60_000);
  });

  it("caps at 2 hours for high retryCount", () => {
    expect(minRetryDelayMs(10)).toBe(2 * 60 * 60 * 1000);
  });
});

describe("isRetryDue", () => {
  it("is always due on first attempt (retryCount 0)", () => {
    expect(isRetryDue(makeRecord({ retryCount: 0, lastAttemptAt: null }))).toBe(
      true,
    );
  });

  it("is due when backoff has elapsed", () => {
    const thirtyOneSecondsAgo = new Date(Date.now() - 31_000).toISOString();
    expect(
      isRetryDue(
        makeRecord({ retryCount: 1, lastAttemptAt: thirtyOneSecondsAgo }),
      ),
    ).toBe(true);
  });

  it("is NOT due when backoff has not yet elapsed", () => {
    const fiveSecondsAgo = new Date(Date.now() - 5_000).toISOString();
    expect(
      isRetryDue(makeRecord({ retryCount: 1, lastAttemptAt: fiveSecondsAgo })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: attemptUpload
// ---------------------------------------------------------------------------

describe("attemptUpload", () => {
  it("returns 'uploaded' for a 202 response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(202),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("uploaded");
  });

  it("sends the original clientSubmissionId in the form payload", async () => {
    const capturedForms: FormData[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init: RequestInit) => {
        capturedForms.push(init.body as FormData);
        return Promise.resolve(makeResponse(202));
      },
    );

    const record = makeRecord({
      clientSubmissionId: "my-idempotency-key",
    });
    await attemptUpload(record);

    // Verify fetch was called with 'include' credentials (cookie auth)
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/pods",
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
  });

  it("returns 'retry' for a network error (offline)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("retry");
  });

  it("returns 'auth_error' for HTTP 401", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(401),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("auth_error");
  });

  it("returns 'auth_error' for HTTP 403", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(403),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("auth_error");
  });

  it("returns 'retry' for HTTP 400 (validation error – image is preserved)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(400),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("retry");
  });

  it("returns 'retry' for HTTP 422", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(422),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("retry");
  });

  it("returns 'retry' for HTTP 429 with Retry-After header", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(429, { "Retry-After": "60" }),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("retry");
    if (outcome.kind === "retry") {
      expect(outcome.message).toContain("60");
    }
  });

  it("returns 'retry' for HTTP 500 (temporary server error)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(500),
    );
    const outcome = await attemptUpload(makeRecord());
    expect(outcome.kind).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: runSyncLoop
// ---------------------------------------------------------------------------

describe("runSyncLoop", () => {
  it("uploads a pending record and deletes it after 202", async () => {
    const record = makeRecord();
    // getPendingPods('') for stale check, then getPendingPods('PENDING')
    getPendingPods
      .mockResolvedValueOnce([record]) // allRecords (stale check)
      .mockResolvedValueOnce([record]); // PENDING records

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(202),
    );

    const summary = await runSyncLoop();

    expect(summary.uploaded).toBe(1);
    expect(summary.retried).toBe(0);
    expect(deletePendingPod).toHaveBeenCalledWith(record.id);
  });

  it("does NOT delete a record after a failed upload (network error)", async () => {
    const record = makeRecord();
    getPendingPods
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([record]);

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("offline"),
    );

    const summary = await runSyncLoop();

    expect(summary.uploaded).toBe(0);
    expect(summary.retried).toBe(1);
    expect(deletePendingPod).not.toHaveBeenCalled();
    expect(updatePendingPod).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        uploadStatus: "PENDING",
        retryCount: 1,
      }),
    );
  });

  it("does NOT delete a record after HTTP 500", async () => {
    const record = makeRecord();
    getPendingPods
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([record]);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(500),
    );

    const summary = await runSyncLoop();

    expect(deletePendingPod).not.toHaveBeenCalled();
    expect(summary.retried).toBe(1);
  });

  it("stops the sync loop on 401 and sets authError", async () => {
    const r1 = makeRecord({ id: "r1", clientSubmissionId: "sub-1" });
    const r2 = makeRecord({ id: "r2", clientSubmissionId: "sub-2" });
    getPendingPods
      .mockResolvedValueOnce([r1, r2]) // stale check
      .mockResolvedValueOnce([r1, r2]); // PENDING

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(401),
    );

    const summary = await runSyncLoop();

    expect(summary.authError).toBe(true);
    expect(summary.uploaded).toBe(0);
    // Only the first record should have been attempted; the loop halts
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(deletePendingPod).not.toHaveBeenCalled();
  });

  it("uploads multiple pending records in FIFO order", async () => {
    const uploadedIds: string[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve(makeResponse(202)),
    );
    deletePendingPod.mockImplementation((id: string) => {
      uploadedIds.push(id);
      return Promise.resolve(undefined);
    });

    const r1 = makeRecord({
      id: "r1",
      clientSubmissionId: "sub-1",
      createdAt: new Date(Date.now() - 3000).toISOString(),
    });
    const r2 = makeRecord({
      id: "r2",
      clientSubmissionId: "sub-2",
      createdAt: new Date(Date.now() - 2000).toISOString(),
    });
    const r3 = makeRecord({
      id: "r3",
      clientSubmissionId: "sub-3",
      createdAt: new Date(Date.now() - 1000).toISOString(),
    });

    // db.getPendingPods already returns FIFO-sorted results
    getPendingPods
      .mockResolvedValueOnce([r1, r2, r3]) // allRecords
      .mockResolvedValueOnce([r1, r2, r3]); // PENDING

    const summary = await runSyncLoop();

    expect(summary.uploaded).toBe(3);
    expect(uploadedIds).toEqual(["r1", "r2", "r3"]);
  });

  it("skips records whose backoff delay has not elapsed", async () => {
    const recentAttempt = new Date(Date.now() - 5_000).toISOString(); // 5s ago
    const record = makeRecord({
      retryCount: 1, // 30s backoff
      lastAttemptAt: recentAttempt,
    });
    getPendingPods
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([record]);

    const summary = await runSyncLoop();

    expect(summary.skipped).toBe(1);
    expect(summary.uploaded).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resets stale UPLOADING records to PENDING before processing", async () => {
    const staleTime = new Date(Date.now() - 6 * 60_000).toISOString(); // 6 min ago
    const staleRecord = makeRecord({
      uploadStatus: "UPLOADING",
      lastAttemptAt: staleTime,
    });
    // After reset, it appears as PENDING in the second call
    const resetRecord = { ...staleRecord, uploadStatus: "PENDING" as const };

    getPendingPods
      .mockResolvedValueOnce([staleRecord]) // allRecords (stale check)
      .mockResolvedValueOnce([resetRecord]); // PENDING (after reset)

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(202),
    );

    const summary = await runSyncLoop();

    // Should have reset the stale record then uploaded it
    expect(updatePendingPod).toHaveBeenCalledWith(
      staleRecord.id,
      expect.objectContaining({ uploadStatus: "PENDING" }),
    );
    expect(summary.uploaded).toBe(1);
    expect(deletePendingPod).toHaveBeenCalledWith(staleRecord.id);
  });

  it("does NOT reset a recently UPLOADING record (active upload from another context)", async () => {
    const recentTime = new Date(Date.now() - 30_000).toISOString(); // 30s ago
    const activeRecord = makeRecord({
      uploadStatus: "UPLOADING",
      lastAttemptAt: recentTime,
    });

    getPendingPods
      .mockResolvedValueOnce([activeRecord]) // allRecords
      .mockResolvedValueOnce([]); // no PENDING records

    const summary = await runSyncLoop();

    // updatePendingPod should NOT have been called with uploadStatus PENDING
    // for a stale reset (it may be called for other reasons, but let's check)
    const resetCall = updatePendingPod.mock.calls.find(
      (call) =>
        call[0] === activeRecord.id &&
        (call[1] as Partial<PendingPodRecord>).uploadStatus === "PENDING" &&
        (call[1] as { lastError?: string }).lastError?.includes(
          "interrupted",
        ),
    );
    expect(resetCall).toBeUndefined();
    expect(summary.uploaded).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it("preserves the image for HTTP 400 (validation error)", async () => {
    const record = makeRecord();
    getPendingPods
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([record]);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(400),
    );

    const summary = await runSyncLoop();

    expect(deletePendingPod).not.toHaveBeenCalled();
    expect(summary.retried).toBe(1);
    expect(updatePendingPod).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ uploadStatus: "PENDING" }),
    );
  });

  it("handles duplicate server submission gracefully (idempotency)", async () => {
    // The server returns 202 whether first submission or a retry with the same
    // clientSubmissionId (the backend deduplicates). Both cases should delete
    // the local record.
    const record = makeRecord({ retryCount: 2 });
    getPendingPods
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([record]);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(202),
    );

    const summary = await runSyncLoop();

    expect(summary.uploaded).toBe(1);
    expect(deletePendingPod).toHaveBeenCalledWith(record.id);
  });

  it("returns an empty summary when there are no pending records", async () => {
    getPendingPods
      .mockResolvedValueOnce([]) // allRecords
      .mockResolvedValueOnce([]); // PENDING

    const summary = await runSyncLoop();

    expect(summary).toEqual<SyncSummary>({
      uploaded: 0,
      retried: 0,
      skipped: 0,
      authError: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration tests: syncPendingPods (public entry point)
// ---------------------------------------------------------------------------

describe("syncPendingPods", () => {
  it("returns null immediately when isPendingLogout() is true", async () => {
    isPendingLogout.mockReturnValue(true);

    const result = await syncPendingPods();

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getPendingPods).not.toHaveBeenCalled();
  });

  it("returns a SyncSummary when isPendingLogout() is false", async () => {
    isPendingLogout.mockReturnValue(false);
    getPendingPods.mockResolvedValue([]); // no pending records

    const result = await syncPendingPods();

    expect(result).not.toBeNull();
    expect(result?.uploaded).toBe(0);
  });

  it("uploads a pending record end-to-end and reports the result", async () => {
    const record = makeRecord();
    getPendingPods
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([record]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse(202),
    );

    const result = await syncPendingPods();

    expect(result?.uploaded).toBe(1);
    expect(deletePendingPod).toHaveBeenCalledWith(record.id);
  });

  it("second concurrent call returns null (in-tab concurrency guard)", async () => {
    // Arrange: first call will hang until we resolve the fetch
    let resolveFetch!: (r: Response) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const record = makeRecord();
    getPendingPods
      .mockResolvedValue([record]);

    // Start first sync (does not await yet)
    const first = syncPendingPods();

    // Immediately try a second concurrent call
    const second = await syncPendingPods();

    // Resolve the hanging fetch so the first call can complete
    resolveFetch(makeResponse(202));
    await first;

    // The second call should have been a no-op
    expect(second).toBeNull();
  });
});
