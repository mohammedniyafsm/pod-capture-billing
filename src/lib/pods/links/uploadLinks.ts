import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";

export const UPLOAD_LINK_TTL_MS = 48 * 60 * 60 * 1000;

export type UploadLinkStatus =
  | "NOT_GENERATED"
  | "ACTIVE"
  | "EXPIRED"
  | "USED"
  | "REVOKED";

export function hashUploadToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateUploadLinkCredentials() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashUploadToken(token),
    expiresAt: new Date(Date.now() + UPLOAD_LINK_TTL_MS),
  };
}

export function deriveUploadLinkStatus(
  link: {
    expiresAt: Date;
    usedAt: Date | null;
    submission?: { id: string } | null;
  } | null,
  now = new Date(),
): UploadLinkStatus {
  if (!link) return "NOT_GENERATED";
  if (link.usedAt) {
    // If it was used and has an associated submission, it was USED.
    // If usedAt is set but has no submission, it was revoked.
    if (link.submission) {
      return "USED";
    }
    return "REVOKED";
  }
  if (link.expiresAt <= now) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

export async function createUploadLinkInTransaction(
  transaction: Pick<Prisma.TransactionClient, "uploadLink">,
  tripId: string,
) {
  const credentials = generateUploadLinkCredentials();
  const created = await transaction.uploadLink.create({
    data: {
      tokenHash: credentials.tokenHash,
      tripId,
      expiresAt: credentials.expiresAt,
    },
  });
  return {
    id: created.id,
    token: credentials.token,
    expiresAt: credentials.expiresAt,
  };
}

export async function claimUploadLink(
  transaction: {
    uploadLink: {
      updateMany(args: {
        where: { id: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }): Promise<{ count: number }>;
    };
  },
  id: string,
  now = new Date(),
) {
  const result = await transaction.uploadLink.updateMany({
    where: { id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return result.count === 1;
}

export async function createUploadLink(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, isHired: true, status: true },
  });
  if (!trip) throw new Error("Cannot create an upload link for a missing trip.");
  if (!trip.isHired) throw new Error("Upload links are only for hired-driver trips.");

  return prisma.$transaction((transaction) =>
    createUploadLinkInTransaction(transaction, tripId),
  );
}

/**
 * Revokes any currently active upload link for a trip.
 */
export async function revokeUploadLink(
  tripId: string,
  now = new Date(),
): Promise<boolean> {
  const result = await prisma.uploadLink.updateMany({
    where: {
      tripId,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      usedAt: now,
    },
  });
  return result.count > 0;
}
