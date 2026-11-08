/**
 * Pending Logout Manager for Offline Sign-Out Reliability.
 *
 * Ensures that when a driver signs out offline:
 * 1. The pending purge flag persists in storage until the server confirms revocation with HTTP 200/204.
 * 2. While pending, `/api/auth/me` is blocked to prevent resurrecting Driver A's lingering cookie.
 * 3. Any direct visit to `/driver` or `/` forces a purge attempt first.
 * 4. Only upon confirmed server revocation (`response.ok`) is the flag removed.
 */

export const PENDING_LOGOUT_KEY = "fp_pending_logout_purge";

export function isPendingLogout(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PENDING_LOGOUT_KEY) === "true";
  } catch {
    return false;
  }
}

export function setPendingLogout(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PENDING_LOGOUT_KEY, "true");
  } catch {
    // Storage quota fallback
  }
}

export function clearPendingLogoutFlag(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    // Storage fallback
  }
}

/**
 * Attempts to flush a pending logout with the backend.
 * Returns true ONLY if the backend confirmed logout (`response.ok`).
 * If the request fails, network is down, or server returns 500, the flag is KEPT and returns false.
 */
export async function flushPendingLogout(): Promise<boolean> {
  if (typeof window === "undefined" || !isPendingLogout()) {
    return true;
  }

  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      clearPendingLogoutFlag();
      return true;
    }
    // Server returned an error (e.g. 500) -> keep pending flag
    return false;
  } catch {
    // Network down / offline -> keep pending flag
    return false;
  }
}

