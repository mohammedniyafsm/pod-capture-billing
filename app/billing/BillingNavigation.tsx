"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export const navigation = [
  { href: "/billing", label: "Overview", icon: "overview" },
  { href: "/billing/review", label: "POD review", icon: "review" },
  { href: "/billing/queue", label: "Billing queue", icon: "billing" },
  { href: "/billing/trips", label: "Trips", icon: "trips" },
  { href: "/billing/import", label: "Import trips", icon: "import" },
];

function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    review: <><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" /><path d="M8 12h8M8 16h5M15 3h6v6M21 3l-9 9" /></>,
    billing: <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    trips: <><path d="M3 6h18M3 12h18M3 18h18M7 6v12M17 6v12" /></>,
    import: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function BillingNavigation({
  reviewCount,
  reviewCountError,
  onNavigate,
}: {
  reviewCount: number | null;
  reviewCountError: string | null;
  onNavigate: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="billing-navigation" aria-label="Billing workspace">
      {navigation.map((item) => {
        const active =
          item.href === "/billing"
            ? pathname === item.href
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`billing-nav-link${active ? " is-active" : ""}`}
            onClick={onNavigate}
          >
            <NavigationIcon name={item.icon} />
            {item.label}
            {item.href === "/billing/review" && reviewCount !== null ? (
              <span className="billing-nav-count" aria-label={`${reviewCount} pending reviews`}>
                {reviewCount}
              </span>
            ) : null}
            {item.href === "/billing/review" && reviewCountError ? (
              <span
                className="billing-nav-count is-error"
                aria-label="Review count unavailable"
                title={reviewCountError}
              >
                !
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
