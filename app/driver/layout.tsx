"use client";

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
    <div className="min-h-screen bg-white text-[#14181b]">
      {/* Top bar: logo mark + Haulmark on left, quiet Sign out text button on right */}
      <header className="sticky top-0 z-20 w-full border-b border-[#e3e6e8] bg-white/95 px-4 lg:px-8 xl:px-12 py-3 backdrop-blur-xs">
        <div className="mx-auto flex max-w-[480px] lg:max-w-[1280px] items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#0B4044] text-white"
              aria-hidden="true"
            >
              <svg
                className="h-4.5 w-4.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="4" />
                <path d="M7 8v8" />
                <path d="M17 8v8" />
                <path d="M7 12h10" />
              </svg>
            </div>
            <span className="text-[18px] font-bold tracking-tight text-[#0B4044]">
              Haulmark
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="text-[13px] font-medium text-[#5f6b72] hover:text-[#14181b] transition-colors focus:outline-none focus:ring-2 focus:ring-[#0B4044]/20 rounded-md px-2 py-1"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[480px] px-4 py-5 lg:max-w-[1280px] lg:px-8 xl:px-12 lg:py-10">
        {children}
      </main>
    </div>
  );
}

