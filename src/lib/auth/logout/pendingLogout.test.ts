import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingLogout,
  isPendingLogout,
  PENDING_LOGOUT_KEY,
  setPendingLogout,
} from "./pendingLogout";

// In-memory mock for localStorage in Node test runner
const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockStorage.set(key, val),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

describe("flushPendingLogout & pending logout lifecycle", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as unknown as { localStorage: typeof localStorageMock; window: unknown }).localStorage = localStorageMock;
    (globalThis as unknown as { localStorage: typeof localStorageMock; window: unknown }).window = globalThis;
    localStorageMock.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns true immediately if no logout is pending", async () => {
    const result = await flushPendingLogout();
    expect(result).toBe(true);
    expect(isPendingLogout()).toBe(false);
  });

  it("removes pending flag when logout request succeeds (response.ok)", async () => {
    setPendingLogout();
    expect(isPendingLogout()).toBe(true);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);

    const result = await flushPendingLogout();
    expect(result).toBe(true);
    expect(isPendingLogout()).toBe(false);
    expect(localStorageMock.getItem(PENDING_LOGOUT_KEY)).toBeNull();
  });

  it("keeps pending flag when network request throws (offline)", async () => {
    setPendingLogout();
    expect(isPendingLogout()).toBe(true);

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await flushPendingLogout();
    expect(result).toBe(false);
    expect(isPendingLogout()).toBe(true);
    expect(localStorageMock.getItem(PENDING_LOGOUT_KEY)).toBe("true");
  });

  it("keeps pending flag when server returns 500 error", async () => {
    setPendingLogout();
    expect(isPendingLogout()).toBe(true);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await flushPendingLogout();
    expect(result).toBe(false);
    expect(isPendingLogout()).toBe(true);
    expect(localStorageMock.getItem(PENDING_LOGOUT_KEY)).toBe("true");
  });

  it("retries and succeeds when connectivity is restored", async () => {
    setPendingLogout();

    // 1st attempt: offline
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError("Network error"));
    const firstAttempt = await flushPendingLogout();
    expect(firstAttempt).toBe(false);
    expect(isPendingLogout()).toBe(true);

    // 2nd attempt: back online
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 204,
    } as Response);
    const secondAttempt = await flushPendingLogout();
    expect(secondAttempt).toBe(true);
    expect(isPendingLogout()).toBe(false);
  });
});
