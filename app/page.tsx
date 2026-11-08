"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { flushPendingLogout, isPendingLogout } from "@/src/lib/auth/logout/pendingLogout";
import { fetchJson, type UserSession } from "@/src/lib/fleetproof";

type LoginRole = "DRIVER" | "BILLING_EXEC";

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<LoginRole>("DRIVER");
  const [phone, setPhone] = useState("9000000001");
  const [pin, setPin] = useState("1234");
  const [email, setEmail] = useState("meena.kulkarni@example.test");
  const [password, setPassword] = useState("billing123");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [pendingLogoutStatus, setPendingLogoutStatus] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      // 1. If an offline logout was performed previously, flush the server-side revocation now
      if (isPendingLogout()) {
        setPendingLogoutStatus("Finishing sign-out with server...");
        const flushed = await flushPendingLogout();
        if (!flushed) {
          // Still offline or server unreachable: KEEP flag, block /api/auth/me
          setPendingLogoutStatus("Server sign-out is waiting for network connection.");
          setCheckingSession(false);
          return;
        }
        setPendingLogoutStatus(null);
      }

      try {
        const me = await fetchJson<{ user: UserSession }>("/api/auth/me");
        if (me.user?.role === "DRIVER") {
          router.replace("/driver");
          return;
        }
        if (me.user?.role === "BILLING_EXEC") {
          router.replace("/billing");
        }
      } catch {
        // Keep the login page visible when no session is active.
      } finally {
        setCheckingSession(false);
      }
    };

    void checkSession();
  }, [router]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body =
        role === "DRIVER"
          ? { role, phone, pin }
          : { role, email, password };

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || "Unable to sign in.");
      }

      router.push(role === "DRIVER" ? "/driver" : "/billing");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <main className="fp-auth-page">
        <div className="fp-auth-card" role="status" aria-label="Checking your session">
          <div className="flex items-center gap-3">
            <div className="h-[38px] w-[38px] animate-pulse rounded-lg bg-neutral-200" aria-hidden="true" />
            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-neutral-200" aria-hidden="true" />
              <div className="h-5 w-28 animate-pulse rounded bg-neutral-200" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-6 space-y-3">
            <div className="h-11 animate-pulse rounded-lg bg-neutral-100" aria-hidden="true" />
            <div className="h-11 animate-pulse rounded-lg bg-neutral-100" aria-hidden="true" />
            <div className="h-12 animate-pulse rounded-lg bg-neutral-200" aria-hidden="true" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="fp-auth-page">
      <div className="fp-auth-card">
        <div className="mb-6 flex items-center gap-3">
          <div className="fp-brand-mark" aria-hidden="true">
            F
          </div>
          <div>
            <p className="m-0 text-xs font-medium tracking-wide text-neutral-500">FleetProof</p>
            <h1 className="mt-1 text-[23px] font-semibold tracking-[-0.035em]">Sign in</h1>
          </div>
        </div>

        {pendingLogoutStatus ? (
          <div className="fp-auth-error mb-4 border border-amber-200 bg-amber-50 text-amber-800" role="status">
            {pendingLogoutStatus}
          </div>
        ) : null}

        <div className="fp-role-switch mb-5" role="group" aria-label="Choose account type">
          {[
            { key: "DRIVER", label: "Driver" },
            { key: "BILLING_EXEC", label: "Billing Exec" },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRole(option.key as LoginRole)}
              aria-pressed={role === option.key}
              className="fp-role-option fp-focus-ring"
            >
              {option.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {role === "DRIVER" ? (
            <>
              <label className="block text-[13px] font-medium text-neutral-700">
                Phone number
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="9000000001"
                  className="fp-input fp-focus-ring mt-1.5"
                  required
                />
              </label>

              <label className="block text-[13px] font-medium text-neutral-700">
                4-digit PIN
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="1234"
                  className="fp-input fp-focus-ring mt-1.5"
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label className="block text-[13px] font-medium text-neutral-700">
                Email
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="meena.kulkarni@example.test"
                  className="fp-input fp-focus-ring mt-1.5"
                  required
                />
              </label>

              <label className="block text-[13px] font-medium text-neutral-700">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="fp-input fp-focus-ring mt-1.5"
                  required
                />
              </label>
            </>
          )}

          {error ? (
            <div className="fp-feedback fp-feedback-error" role="alert">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="fp-button-primary fp-auth-submit fp-focus-ring"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
