"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { flushPendingLogout, isPendingLogout } from "@/src/lib/auth/logout/pendingLogout";
import { fetchJson, type UserSession } from "@/src/lib/fleetproof";

export const BRAND = "Haulmark";

type LoginRole = "DRIVER" | "BILLING_EXEC";

interface FieldErrors {
  identifier?: string;
  secret?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<LoginRole>("DRIVER");

  // Form values
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Visibility toggles
  const [showSecret, setShowSecret] = useState(false);

  // Status & error states
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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

  const handleRoleChange = (newRole: LoginRole) => {
    if (newRole === role) return;
    setRole(newRole);
    setPhone("");
    setPin("");
    setEmail("");
    setPassword("");
    setFieldErrors({});
    setError(null);
    setShowSecret(false);
  };

  const validate = (): boolean => {
    const errors: FieldErrors = {};

    if (role === "DRIVER") {
      const cleanPhone = phone.trim();
      if (!cleanPhone) {
        errors.identifier = "Phone number is required";
      } else if (!/^\d{10}$/.test(cleanPhone)) {
        errors.identifier = "Phone number must be exactly 10 digits";
      }

      const cleanPin = pin.trim();
      if (!cleanPin) {
        errors.secret = "PIN is required";
      } else if (!/^\d{4}$/.test(cleanPin)) {
        errors.secret = "PIN must be exactly 4 digits";
      }
    } else {
      const cleanEmail = email.trim();
      if (!cleanEmail) {
        errors.identifier = "Email address is required";
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        errors.identifier = "Please enter a valid email address";
      }

      if (!password) {
        errors.secret = "Password is required";
      } else if (password.length < 6) {
        errors.secret = "Password must be at least 6 characters";
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!validate()) {
      return;
    }

    setSubmitting(true);

    try {
      const body =
        role === "DRIVER"
          ? { role, phone: phone.trim(), pin: pin.trim() }
          : { role, email: email.trim(), password };

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
      <div className="flex min-h-screen flex-col bg-white">
        {/* Mobile Top Navbar Skeleton */}
        <header className="flex w-full items-center border-b border-neutral-100 bg-white px-5 py-3.5 sm:hidden">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 animate-pulse rounded-[8px] bg-neutral-200" />
            <div className="h-5 w-24 animate-pulse rounded bg-neutral-200" />
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center px-6 py-8 sm:py-12">
          <div className="mx-auto my-auto w-full max-w-[400px] animate-pulse space-y-6" role="status" aria-label="Checking your session">
            {/* Desktop Brand Header Skeleton */}
            <div className="hidden items-center gap-2.5 sm:flex">
              <div className="h-9 w-9 rounded-[8px] bg-neutral-200" />
              <div className="h-5 w-28 rounded bg-neutral-200" />
            </div>
            <div className="space-y-2">
              <div className="h-8 w-48 rounded bg-neutral-200" />
              <div className="h-4 w-72 rounded bg-neutral-100" />
            </div>
            <div className="space-y-4 pt-2">
              <div className="h-12 rounded-[10px] bg-neutral-100" />
              <div className="h-12 rounded-[10px] bg-neutral-100" />
              <div className="h-[46px] rounded-[10px] bg-neutral-200" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Mobile Top Navbar */}
      <header className="sticky top-0 z-10 flex w-full items-center border-b border-neutral-100 bg-white/95 px-5 py-3.5 backdrop-blur-xs sm:hidden">
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
            {BRAND}
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex flex-1 flex-col justify-center px-6 py-8 sm:py-12">
        <div className="mx-auto my-auto w-full max-w-[400px]">
          {/* Desktop Brand Header */}
          <div className="hidden items-center gap-2.5 sm:flex">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#0B4044] text-white"
              aria-hidden="true"
            >
              <svg
                className="h-5 w-5"
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
            <span className="text-[20px] font-bold tracking-tight text-[#0B4044]">
              {BRAND}
            </span>
          </div>

          {/* Heading & Helper text */}
          <div className="sm:mt-8">
            <h1 className="text-[28px] font-normal tracking-[-0.03em] text-neutral-900 sm:text-[30px]">
              Welcome Back
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
              {role === "DRIVER"
                ? "Sign in to view your assigned trips and upload delivery proof."
                : "Sign in to access your billing dashboard and review proof-of-delivery records."}
            </p>
          </div>

          {/* Role Toggle */}
          <div className="mt-5 mb-6 flex rounded-[9px] bg-neutral-100/90 p-1" role="tablist" aria-label="Account type">
            <button
              type="button"
              role="tab"
              aria-selected={role === "DRIVER"}
              onClick={() => handleRoleChange("DRIVER")}
              className={`flex-1 rounded-[7px] py-1.5 text-center text-[13px] font-medium transition-all ${role === "DRIVER"
                  ? "bg-white text-[#0B4044] font-semibold shadow-xs"
                  : "text-neutral-500 hover:text-neutral-900"
                }`}
            >
              Driver
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={role === "BILLING_EXEC"}
              onClick={() => handleRoleChange("BILLING_EXEC")}
              className={`flex-1 rounded-[7px] py-1.5 text-center text-[13px] font-medium transition-all ${role === "BILLING_EXEC"
                  ? "bg-white text-[#0B4044] font-semibold shadow-xs"
                  : "text-neutral-500 hover:text-neutral-900"
                }`}
            >
              Billing executive
            </button>
          </div>

          {pendingLogoutStatus ? (
            <div
              className="mb-4 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800"
              role="status"
            >
              {pendingLogoutStatus}
            </div>
          ) : null}

          {/* Login Form */}
          <form onSubmit={handleLogin} noValidate className="space-y-4">
            {role === "DRIVER" ? (
              <>
                <div>
                  <label
                    htmlFor="driver-phone"
                    className="mb-1.5 block text-[13px] font-medium text-neutral-700"
                  >
                    Phone number
                  </label>
                  <div className="relative">
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400"
                      aria-hidden="true"
                    >
                      <svg
                        className="h-[18px] w-[18px]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </div>
                    <input
                      id="driver-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={10}
                      value={phone}
                      onChange={(event) => {
                        const next = event.target.value.replace(/\D/g, "").slice(0, 10);
                        setPhone(next);
                        if (fieldErrors.identifier) {
                          setFieldErrors((prev) => ({ ...prev, identifier: undefined }));
                        }
                      }}
                      placeholder="10-digit mobile number"
                      className={`block h-12 w-full rounded-[10px] border bg-white pr-3 pl-10 text-[14px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-3 ${fieldErrors.identifier
                          ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                          : "border-neutral-300 focus:border-[#0B4044] focus:ring-[#0B4044]/15"
                        }`}
                      aria-invalid={Boolean(fieldErrors.identifier)}
                      aria-describedby={fieldErrors.identifier ? "driver-phone-error" : undefined}
                    />
                  </div>
                  {fieldErrors.identifier ? (
                    <p id="driver-phone-error" className="mt-1 text-xs text-red-600">
                      {fieldErrors.identifier}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="driver-pin"
                    className="mb-1.5 block text-[13px] font-medium text-neutral-700"
                  >
                    4-digit PIN
                  </label>
                  <div className="relative">
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400"
                      aria-hidden="true"
                    >
                      <svg
                        className="h-[18px] w-[18px]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <input
                      id="driver-pin"
                      type={showSecret ? "text" : "password"}
                      inputMode="numeric"
                      autoComplete="current-password"
                      pattern="[0-9]*"
                      maxLength={4}
                      value={pin}
                      onChange={(event) => {
                        const next = event.target.value.replace(/\D/g, "").slice(0, 4);
                        setPin(next);
                        if (fieldErrors.secret) {
                          setFieldErrors((prev) => ({ ...prev, secret: undefined }));
                        }
                      }}
                      placeholder="••••"
                      className={`block h-12 w-full rounded-[10px] border bg-white pr-11 pl-10 text-[14px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-3 ${fieldErrors.secret
                          ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                          : "border-neutral-300 focus:border-[#0B4044] focus:ring-[#0B4044]/15"
                        }`}
                      aria-invalid={Boolean(fieldErrors.secret)}
                      aria-describedby={fieldErrors.secret ? "driver-pin-error" : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      aria-label={showSecret ? "Hide PIN" : "Show PIN"}
                      className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-neutral-400 hover:text-neutral-600 focus:outline-none"
                    >
                      {showSecret ? (
                        <svg
                          className="h-[18px] w-[18px]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" x2="22" y1="2" y2="22" />
                        </svg>
                      ) : (
                        <svg
                          className="h-[18px] w-[18px]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {fieldErrors.secret ? (
                    <p id="driver-pin-error" className="mt-1 text-xs text-red-600">
                      {fieldErrors.secret}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="billing-email"
                    className="mb-1.5 block text-[13px] font-medium text-neutral-700"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400"
                      aria-hidden="true"
                    >
                      <svg
                        className="h-[18px] w-[18px]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect width="20" height="16" x="2" y="4" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </div>
                    <input
                      id="billing-email"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (fieldErrors.identifier) {
                          setFieldErrors((prev) => ({ ...prev, identifier: undefined }));
                        }
                      }}
                      placeholder="Enter your email"
                      className={`block h-12 w-full rounded-[10px] border bg-white pr-3 pl-10 text-[14px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-3 ${fieldErrors.identifier
                          ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                          : "border-neutral-300 focus:border-[#0B4044] focus:ring-[#0B4044]/15"
                        }`}
                      aria-invalid={Boolean(fieldErrors.identifier)}
                      aria-describedby={fieldErrors.identifier ? "billing-email-error" : undefined}
                    />
                  </div>
                  {fieldErrors.identifier ? (
                    <p id="billing-email-error" className="mt-1 text-xs text-red-600">
                      {fieldErrors.identifier}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="billing-password"
                    className="mb-1.5 block text-[13px] font-medium text-neutral-700"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400"
                      aria-hidden="true"
                    >
                      <svg
                        className="h-[18px] w-[18px]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <input
                      id="billing-password"
                      type={showSecret ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (fieldErrors.secret) {
                          setFieldErrors((prev) => ({ ...prev, secret: undefined }));
                        }
                      }}
                      placeholder="Enter your password"
                      className={`block h-12 w-full rounded-[10px] border bg-white pr-11 pl-10 text-[14px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-3 ${fieldErrors.secret
                          ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                          : "border-neutral-300 focus:border-[#0B4044] focus:ring-[#0B4044]/15"
                        }`}
                      aria-invalid={Boolean(fieldErrors.secret)}
                      aria-describedby={fieldErrors.secret ? "billing-password-error" : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      aria-label={showSecret ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-neutral-400 hover:text-neutral-600 focus:outline-none"
                    >
                      {showSecret ? (
                        <svg
                          className="h-[18px] w-[18px]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" x2="22" y1="2" y2="22" />
                        </svg>
                      ) : (
                        <svg
                          className="h-[18px] w-[18px]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {fieldErrors.secret ? (
                    <p id="billing-password-error" className="mt-1 text-xs text-red-600">
                      {fieldErrors.secret}
                    </p>
                  ) : null}
                </div>
              </>
            )}

            {error ? (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-[8px] border border-red-200 bg-red-50 p-3 text-[13px] text-red-700"
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 flex h-[46px] w-full items-center justify-center rounded-[10px] bg-[#0B4044] text-[15px] font-semibold text-white transition-colors hover:bg-[#083235] focus:outline-none focus:ring-3 focus:ring-[#0B4044]/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>


        </div>
      </main>
    </div>
  );
}
