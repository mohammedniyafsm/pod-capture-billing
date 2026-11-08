import { UserRole } from "@prisma/client";
import { getSessionTokenFromRequest, verifySessionToken } from "../session/session";

type GuardSuccess = {
  ok: true;
  session: NonNullable<Awaited<ReturnType<typeof verifySessionToken>>>;
};

type GuardFailure = {
  ok: false;
  response: Response;
};

export type GuardResult = GuardSuccess | GuardFailure;

function forbiddenResponse() {
  return Response.json(
    { error: "You do not have access to this resource.", code: "forbidden" },
    { status: 403 },
  );
}

export function requireRole(allowedRoles: UserRole | readonly UserRole[]) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return async (
    request: Request,
    ownerUserId?: string | null,
  ): Promise<GuardResult> => {
    const token = getSessionTokenFromRequest(request);
    const session = token ? await verifySessionToken(token) : null;

    if (!session) {
      return {
        ok: false,
        response: Response.json(
          { error: "Authentication required.", code: "unauthorized" },
          { status: 401 },
        ),
      };
    }

    if (!roles.includes(session.role)) {
      return {
        ok: false,
        response: Response.json(
          { error: "You do not have permission to access this resource.", code: "forbidden" },
          { status: 403 },
        ),
      };
    }

    if (ownerUserId !== undefined && session.userId !== ownerUserId) {
      return {
        ok: false,
        response: forbiddenResponse(),
      };
    }

    return { ok: true, session };
  };
}

export async function requireTripReadAccess(
  request: Request,
  driverId: string | null,
): Promise<GuardResult> {
  const auth = await requireRole([
    UserRole.DRIVER,
    UserRole.BILLING_EXEC,
  ])(request);
  if (!auth.ok) return auth;
  if (
    auth.session.role === UserRole.DRIVER &&
    auth.session.userId !== driverId
  ) {
    return { ok: false, response: forbiddenResponse() };
  }
  return auth;
}

export function requireDriverTripAccess(
  request: Request,
  driverId: string | null,
) {
  return requireRole(UserRole.DRIVER)(request, driverId);
}
