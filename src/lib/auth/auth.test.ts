import { UserRole } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeLoginAttempts,
  LOGIN_RATE_LIMIT,
} from "./loginRateLimit";
import {
  requireDriverTripAccess,
  requireRole,
  requireTripReadAccess,
} from "./requireRole";
import {
  createSessionToken,
  SESSION_DURATION_SECONDS,
  verifySessionToken,
} from "./session";
import { loginSchema } from "./validation";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loginSchema", () => {
  it("accepts a driver phone and four-digit PIN", () => {
    expect(
      loginSchema.safeParse({
        role: UserRole.DRIVER,
        phone: "9000000001",
        pin: "1234",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed driver PINs and normalizes exec email", () => {
    expect(
      loginSchema.safeParse({
        role: UserRole.DRIVER,
        phone: "9000000001",
        pin: "123",
      }).success,
    ).toBe(false);
    expect(
      loginSchema.parse({
        role: UserRole.BILLING_EXEC,
        email: "  MEENA@example.test ",
        password: "example-password",
      }),
    ).toMatchObject({ email: "meena@example.test" });
  });
});

describe("session token and role guard", () => {
  it("signs a role-and-user session with the configured expiration", async () => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret-with-at-least-32-chars");
    const token = await createSessionToken("driver-1", UserRole.DRIVER);

    await expect(verifySessionToken(token)).resolves.toEqual({
      userId: "driver-1",
      role: UserRole.DRIVER,
    });
    expect(SESSION_DURATION_SECONDS).toBe(8 * 60 * 60);
  });

  it("returns 401 without a session and 403 for role or owner mismatch", async () => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret-with-at-least-32-chars");
    const guard = requireRole(UserRole.DRIVER);
    const anonymous = await guard(new Request("http://localhost/api/test"));
    expect(anonymous.ok).toBe(false);
    if (!anonymous.ok) expect(anonymous.response.status).toBe(401);

    const token = await createSessionToken("driver-1", UserRole.DRIVER);
    const request = new Request("http://localhost/api/test", {
      headers: { cookie: `pod_session=${token}` },
    });
    const wrongRole = await requireRole(UserRole.BILLING_EXEC)(request);
    expect(wrongRole.ok).toBe(false);
    if (!wrongRole.ok) expect(wrongRole.response.status).toBe(403);

    const wrongOwner = await guard(request, "driver-2");
    expect(wrongOwner.ok).toBe(false);
    if (!wrongOwner.ok) expect(wrongOwner.response.status).toBe(403);

    const unassignedTrip = await guard(request, null);
    expect(unassignedTrip.ok).toBe(false);
    if (!unassignedTrip.ok) expect(unassignedTrip.response.status).toBe(403);

    const owner = await guard(request, "driver-1");
    expect(owner.ok).toBe(true);

    expect((await requireDriverTripAccess(request, "driver-1")).ok).toBe(true);
    expect((await requireDriverTripAccess(request, null)).ok).toBe(false);
    expect((await requireTripReadAccess(request, "driver-2")).ok).toBe(false);

    const execToken = await createSessionToken("exec-1", UserRole.BILLING_EXEC);
    const execRequest = new Request("http://localhost/api/test", {
      headers: { cookie: `pod_session=${execToken}` },
    });
    expect((await requireTripReadAccess(execRequest, "driver-2")).ok).toBe(true);
    const captureAccess = await requireDriverTripAccess(execRequest, "driver-2");
    expect(captureAccess.ok).toBe(false);
    if (!captureAccess.ok) expect(captureAccess.response.status).toBe(403);
  });

  it("rejects tampered tokens", async () => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret-with-at-least-32-chars");
    const token = await createSessionToken("driver-1", UserRole.DRIVER);
    await expect(verifySessionToken(`${token}x`)).resolves.toBeNull();
  });
});

describe("login rate limiter", () => {
  it("allows five attempts per window and blocks the next until reset", () => {
    const key = `test:${crypto.randomUUID()}`;
    const now = 100_000;

    for (let attempt = 0; attempt < LOGIN_RATE_LIMIT.maxAttempts; attempt += 1) {
      expect(consumeLoginAttempts([key], now).allowed).toBe(true);
    }

    const blocked = consumeLoginAttempts([key], now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(15 * 60);
    expect(consumeLoginAttempts([key], now + LOGIN_RATE_LIMIT.windowMs).allowed).toBe(
      true,
    );
  });
});
