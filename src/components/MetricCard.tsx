import Link from "next/link";

type MetricCardProps = {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "success" | "warning" | "primary";
  href?: string;
};

const toneStyles = {
  default: "border-l-neutral-300",
  success: "border-l-green-600",
  warning: "border-l-amber-600",
  primary: "border-l-blue-600",
};

const contentStyles =
  "block min-h-[112px] rounded-[14px] border border-neutral-200 border-l-[3px] bg-white p-4 shadow-[0_1px_2px_rgba(23,23,23,0.04)]";

function MetricContent({
  label,
  value,
  helper,
  tone,
}: Required<Pick<MetricCardProps, "label" | "value" | "tone">> &
  Pick<MetricCardProps, "helper">) {
  return (
    <div className={contentStyles + " " + toneStyles[tone]}>
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-3 text-[26px] font-semibold leading-none tracking-[-0.04em] text-neutral-900">
        {value}
      </div>
      {helper ? <div className="mt-2 text-xs text-neutral-500">{helper}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  helper,
  tone = "default",
  href,
}: MetricCardProps) {
  if (href) {
    return (
      <Link
        href={href}
        className="billing-metric-link block rounded-[14px] transition hover:-translate-y-px hover:shadow-sm"
      >
        <MetricContent label={label} value={value} helper={helper} tone={tone} />
      </Link>
    );
  }

  return <MetricContent label={label} value={value} helper={helper} tone={tone} />;
}
