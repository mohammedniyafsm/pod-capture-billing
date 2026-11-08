"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  fetchJson,
  FleetProofApiError,
  type UserSession,
} from "@/src/lib/fleetproof";
import BillingNavigation from "./BillingNavigation";

type BillingWorkspaceContextValue = {
  user: UserSession;
  reviewCount: number | null;
  reviewCountError: string | null;
  refreshReviewCount: () => Promise<void>;
};

const BillingWorkspaceContext =
  createContext<BillingWorkspaceContextValue | null>(null);

const pageNames: Record<string, string> = {
  "/billing": "Operations overview",
  "/billing/review": "POD review",
  "/billing/queue": "Billing queue",
  "/billing/trips": "Trips management",
};

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function Brand() {
  return (
    <Link href="/billing" className="billing-brand" aria-label="Haulmark overview">
      <span className="billing-brand-mark" aria-hidden="true">H</span>
      <span>
        <span className="billing-brand-name">Haulmark</span>
        <span className="billing-brand-caption">Operations</span>
      </span>
    </Link>
  );
}

function AccountPanel({
  user,
  onSignOut,
  isSigningOut,
  error,
}: {
  user: UserSession;
  onSignOut: () => void;
  isSigningOut: boolean;
  error: string | null;
}) {
  return (
    <div className="billing-account">
      <div className="billing-user-avatar" aria-hidden="true">
        {user.name.trim().slice(0, 1).toUpperCase()}
      </div>
      <div className="billing-account-copy">
        <span className="billing-user-name">{user.name}</span>
        <span className="billing-user-role">Billing executive</span>
      </div>
      <button
        type="button"
        className="billing-signout"
        onClick={onSignOut}
        disabled={isSigningOut}
      >
        {isSigningOut ? "Signing out…" : "Sign out"}
      </button>
      {error ? <p className="billing-account-error" role="alert">{error}</p> : null}
    </div>
  );
}

function WorkspaceLoading() {
  return (
    <div className="billing-workspace-loading" role="status" aria-label="Loading billing workspace">
      <aside className="billing-sidebar-skeleton" aria-hidden="true">
        <div className="billing-skeleton-block billing-skeleton-brand" />
        <div className="billing-skeleton-block billing-skeleton-nav" />
        <div className="billing-skeleton-block billing-skeleton-nav" />
        <div className="billing-skeleton-block billing-skeleton-nav" />
      </aside>
      <main className="billing-loading-main" aria-hidden="true">
        <div className="billing-skeleton-block billing-skeleton-topbar" />
        <div className="billing-skeleton-block billing-skeleton-title" />
        <div className="billing-skeleton-grid">
          {[0, 1, 2, 3].map((item) => (
            <div className="billing-skeleton-block billing-skeleton-card" key={item} />
          ))}
        </div>
        <div className="billing-skeleton-block billing-skeleton-chart" />
      </main>
    </div>
  );
}

function WorkspaceAuthError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="billing-auth-error">
      <section className="billing-panel" role="alert">
        <h1 className="billing-panel-title">Billing workspace unavailable</h1>
        <p className="billing-page-description">{message}</p>
        <button type="button" className="billing-button billing-button-primary" onClick={onRetry}>
          Retry
        </button>
      </section>
    </main>
  );
}

export function useBillingWorkspace() {
  const context = useContext(BillingWorkspaceContext);
  if (!context) {
    throw new Error("useBillingWorkspace must be used inside BillingWorkspace.");
  }
  return context;
}

export default function BillingWorkspace({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRetry, setAuthRetry] = useState(0);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [reviewCountError, setReviewCountError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const refreshReviewCount = useCallback(async () => {
    setReviewCountError(null);
    try {
      const payload = await fetchJson<{
        trips: Array<{ id: string }>;
        pagination?: { total: number };
      }>("/api/review");
      setReviewCount(payload.pagination ? payload.pagination.total : payload.trips.length);
    } catch (error) {
      setReviewCountError(
        error instanceof Error ? error.message : "Unable to load review count.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchJson<{ user: UserSession }>("/api/auth/me")
      .then(({ user: sessionUser }) => {
        if (!active) return;
        if (sessionUser?.role !== "BILLING_EXEC") {
          router.replace("/");
          return;
        }
        setUser(sessionUser);
        void refreshReviewCount();
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof FleetProofApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          router.replace("/");
          return;
        }
        setAuthError(
          error instanceof Error ? error.message : "Unable to verify your billing session.",
        );
      })
      .finally(() => {
        if (active) setIsLoadingUser(false);
      });
    return () => {
      active = false;
    };
  }, [authRetry, refreshReviewCount, router]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [];
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...focusable()];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      menuButton?.focus();
    };
  }, [mobileMenuOpen]);

  const signOut = async () => {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await fetchJson<void>("/api/auth/logout", { method: "POST" });
      router.replace("/");
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "Unable to sign out. Try again.",
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  if (isLoadingUser) return <WorkspaceLoading />;
  if (authError) {
    return (
      <WorkspaceAuthError
        message={authError}
        onRetry={() => {
          setAuthError(null);
          setIsLoadingUser(true);
          setAuthRetry((retry) => retry + 1);
        }}
      />
    );
  }
  if (!user) return <WorkspaceLoading />;

  const activePage = pageNames[pathname] ?? "Billing workspace";
  const contextValue = { user, reviewCount, reviewCountError, refreshReviewCount };

  const sidebarContents = (
    <>
      <Brand />
      <div className="billing-nav-label">Workspace</div>
      <BillingNavigation
        reviewCount={reviewCount}
        reviewCountError={reviewCountError}
        onNavigate={() => setMobileMenuOpen(false)}
      />
      <div className="billing-sidebar-spacer" />
      <AccountPanel
        user={user}
        onSignOut={() => void signOut()}
        isSigningOut={isSigningOut}
        error={signOutError}
      />
    </>
  );

  return (
    <BillingWorkspaceContext.Provider value={contextValue}>
      <div className="billing-shell">
        <aside className="billing-sidebar" aria-label="Billing workspace sidebar">
          {sidebarContents}
        </aside>
        <div className="billing-main">
          <header className="billing-topbar">
            <button
              ref={menuButtonRef}
              type="button"
              className="billing-menu-button"
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="billing-mobile-navigation"
              onClick={() => setMobileMenuOpen(true)}
            >
              <MenuIcon />
            </button>
            <div className="billing-topbar-title">{activePage}</div>
            <div className="billing-topbar-user">
              <span className="billing-user-avatar" aria-hidden="true">
                {user.name.trim().slice(0, 1).toUpperCase()}
              </span>
              <span>{user.name}</span>
            </div>
          </header>
          <main className="billing-content">
            {children}
          </main>
        </div>
        {mobileMenuOpen ? (
          <div className="billing-mobile-overlay">
            <button
              type="button"
              className="billing-mobile-backdrop"
              aria-label="Close navigation menu"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside
              ref={drawerRef}
              id="billing-mobile-navigation"
              className="billing-sidebar billing-mobile-sidebar"
              role="dialog"
              aria-modal="true"
              aria-label="Billing workspace navigation"
            >
              <button
                type="button"
                className="billing-mobile-close"
                aria-label="Close navigation menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <CloseIcon />
              </button>
              {sidebarContents}
            </aside>
          </div>
        ) : null}
      </div>
    </BillingWorkspaceContext.Provider>
  );
}
