import { cookies } from "next/headers";
import { requireRole } from "@/src/lib/auth/requireRole";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/src/lib/auth/session";
import { UserRole } from "@prisma/client";

const requireAnyRole = requireRole([
  UserRole.DRIVER,
  UserRole.BILLING_EXEC,
]);

export async function POST(request: Request) {
  const auth = await requireAnyRole(request);
  if (!auth.ok) return auth.response;

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions,
    maxAge: 0,
  });
  return new Response(null, { status: 204 });
}
