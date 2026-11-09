import { Suspense } from "react";
import HiredDriverUploadClient from "./HiredDriverUploadClient";

export const instant = false;

function HaulmarkNavbar() {
  return (
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
      </div>
    </header>
  );
}

export default async function HiredDriverUploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="min-h-screen bg-white text-[#14181b]">
      <HaulmarkNavbar />
      <main className="mx-auto w-full max-w-[480px] px-4 py-5 lg:max-w-[1280px] lg:px-8 xl:px-12 lg:py-10">
        <Suspense
          fallback={
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-[#0B4044] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium text-[#5f6b72]">Loading POD upload link...</p>
            </div>
          }
        >
          <HiredDriverUploadClient token={token} />
        </Suspense>
      </main>
    </div>
  );
}
