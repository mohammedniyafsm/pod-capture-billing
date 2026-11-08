import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/src/lib/prisma";
import {
  consumeLoginAttempts,
  getClientIp,
} from "@/src/lib/auth/rateLimit/loginRateLimit";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/src/lib/auth/session/session";
import { loginSchema, normalizePhone } from "@/src/lib/auth/validation/validation";

const invalidCredentials = () =>
  Response.json(
    { error: "Invalid credentials.", code: "invalid_credentials" },
    { status: 401 },
  );

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid login request.",
        code: "validation_error",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const identity =
    parsed.data.role === "DRIVER"
      ? normalizePhone(parsed.data.phone)
      : parsed.data.email;

  const rateLimit = consumeLoginAttempts([
    `ip:${getClientIp(request)}`,
    `account:${identity}`,
  ]);

  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many login attempts. Try again later.", code: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  if (parsed.data.role === "DRIVER") {
    const user = await prisma.user.findUnique({
      where: { phone: identity },
      select: { id: true, role: true, pinHash: true },
    });

    if (!user || user.role !== parsed.data.role) return invalidCredentials();

    const matchesHash = user.pinHash
      ? await bcrypt.compare(parsed.data.pin, user.pinHash)
      : false;
    if (!matchesHash) return invalidCredentials();

    const token = await createSessionToken(user.id, user.role);
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    return Response.json({ userId: user.id, role: user.role });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, role: true, passwordHash: true },
  });
  if (!user || user.role !== parsed.data.role || !user.passwordHash) {
    return invalidCredentials();
  }

  const passwordMatches = await bcrypt.compare(
    parsed.data.password,
    user.passwordHash,
  );
  if (!passwordMatches) return invalidCredentials();

  const token = await createSessionToken(user.id, user.role);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return Response.json({ userId: user.id, role: user.role });
}
