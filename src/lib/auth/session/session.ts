import { UserRole } from "@prisma/client";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "pod_session";
export const SESSION_DURATION_SECONDS = 8 * 60 * 60;

export type AuthSession = {
  userId: string;
  role: UserRole;
};

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
};

export { cookieOptions as sessionCookieOptions };

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

function isUserRole(role: unknown): role is UserRole {
  return role === UserRole.DRIVER || role === UserRole.BILLING_EXEC;
}

export async function createSessionToken(userId: string, role: UserRole) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<AuthSession | null> {
  const secret = getSessionSecret();
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (!payload.sub || !isUserRole(payload.role)) return null;
    return { userId: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function getSessionTokenFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));

  return cookie?.slice(SESSION_COOKIE_NAME.length + 1) || null;
}
