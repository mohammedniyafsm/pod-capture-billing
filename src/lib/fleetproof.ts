export type Role = "DRIVER" | "BILLING_EXEC";

export type UserSession = {
  id: string;
  name: string;
  role: Role;
  phone?: string | null;
  email?: string | null;
  language?: string | null;
  branchId?: string | null;
};

export class FleetProofApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "FleetProofApiError";
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new FleetProofApiError(
      typeof payload?.error === "string"
        ? payload.error
        : "Request failed. Please try again.",
      response.status,
      typeof payload?.code === "string" ? payload.code : undefined,
    );
  }

  return payload as T;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numberValue)) return String(value);
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(numberValue);
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numberValue)) return String(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(numberValue);
}

export function statusBadgeClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized.includes("VERIFIED")) return "bg-emerald-100 text-emerald-700 ring-emerald-200";
  if (normalized.includes("RETAKE") || normalized.includes("REVIEW")) return "bg-amber-100 text-amber-700 ring-amber-200";
  if (normalized.includes("DISPUTED") || normalized.includes("EXPORTED")) return "bg-slate-200 text-slate-700 ring-slate-300";
  if (normalized.includes("POD") || normalized.includes("IN_TRANSIT")) return "bg-sky-100 text-sky-700 ring-sky-200";
  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}
