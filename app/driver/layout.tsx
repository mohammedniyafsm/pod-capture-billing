"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { setPendingLogout } from "@/src/lib/auth/logout/pendingLogout";
import { clearCachedDriverTrips } from "@/src/lib/offline/indexeddb/db";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const handleLogout = async () => {
    let serverRevoked = false;
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      serverRevoked = res.ok;
    } catch {
      // Offline: network unavailable
      serverRevoked = false;
    }
    try {
      // Clear cached trips and offline session snapshot on logout
      // (Pending PODs in IndexedDB are preserved!)
      await clearCachedDriverTrips();
      localStorage.removeItem("fp_driver_offline_session");
      if (!serverRevoked) {
        // Flag that an offline logout occurred so reconnect does not silently restore the old session
        setPendingLogout();
      }
    } catch {
      // Storage cleanup fallback
    }
    if (!serverRevoked && typeof navigator !== "undefined" && !navigator.onLine) {
      alert("Signed out locally on this device. When online, reconnect to update server session.");
    }
    router.replace("/");
  };

  return (
    <main className="fp-driver-shell">
      <div className="fp-driver-container">
        <header className="fp-driver-header">
          <div>
            <p className="fp-driver-brand-caption m-0">FleetProof</p>
            <h1 className="fp-driver-header-title">Driver workspace</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="fp-button-secondary fp-focus-ring">
              Home
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="fp-button-secondary fp-focus-ring"
            >
              Sign out
            </button>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
