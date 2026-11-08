import { Suspense } from "react";
import HiredDriverUploadClient from "./HiredDriverUploadClient";

export const instant = false;

export default async function HiredDriverUploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Loading POD upload link...</p>
          </div>
        </div>
      }
    >
      <HiredDriverUploadClient token={token} />
    </Suspense>
  );
}
