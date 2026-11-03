import { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/auth/requireRole";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/src/lib/auth/session";

const requireAnyRole = requireRole([
  UserRole.DRIVER,
  UserRole.BILLING_EXEC,
]);

export async function GET(request: Request) {
  const auth = await requireAnyRole(request);
  if (!auth.ok) return auth.response;

  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: {
      id: true,
      name: true,
      role: true,
      phone: true,
      email: true,
      language: true,
      branchId: true,
    },
  });

  if (!user || user.role !== auth.session.role) {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, "", {
      ...sessionCookieOptions,
      maxAge: 0,
    });
    return Response.json(
      { error: "Session is no longer valid.", code: "unauthorized" },
      { status: 401 },
    );
  }

  return Response.json({ user });
}
