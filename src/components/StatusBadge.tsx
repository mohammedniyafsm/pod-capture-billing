import { statusBadgeClass } from "@/src/lib/fleetproof";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`fp-status-badge ring-1 ${statusBadgeClass(status)}`}
    >
      {status}
    </span>
  );
}
