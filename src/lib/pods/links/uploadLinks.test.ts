import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimUploadLink,
  deriveUploadLinkStatus,
  generateUploadLinkCredentials,
  hashUploadToken,
  revokeUploadLink,
  UPLOAD_LINK_TTL_MS,
} from "./uploadLinks";
import { prisma } from "../../prisma";

vi.mock("../../prisma", () => ({
  prisma: {
    trip: { findUnique: vi.fn() },
    uploadLink: { updateMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("single-use upload links", () => {
  it("stores only a token hash and expires after 48 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));

    const credentials = generateUploadLinkCredentials();

    expect(credentials.token).not.toBe(credentials.tokenHash);
    expect(credentials.tokenHash).toBe(hashUploadToken(credentials.token));
    expect(credentials.expiresAt.getTime() - Date.now()).toBe(
      UPLOAD_LINK_TTL_MS,
    );
  });

  it("claims a token once and rejects reuse or expiry atomically", async () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    const links = new Map([
      ["single-use", { usedAt: null as Date | null, expiresAt: new Date(now.getTime() + 1000) }],
      ["expired", { usedAt: null as Date | null, expiresAt: new Date(now.getTime() - 1000) }],
    ]);
    const updateMany = vi.fn(
      async (args: {
        where: { id: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }) => {
        const link = links.get(args.where.id);
        if (
          !link ||
          link.usedAt !== null ||
          link.expiresAt <= args.where.expiresAt.gt
        ) {
          return { count: 0 };
        }
        link.usedAt = args.data.usedAt;
        return { count: 1 };
      },
    );
    const transaction = { uploadLink: { updateMany } };

    await expect(
      claimUploadLink(transaction, "single-use", now),
    ).resolves.toBe(true);
    await expect(
      claimUploadLink(transaction, "single-use", now),
    ).resolves.toBe(false);
    await expect(
      claimUploadLink(transaction, "expired", now),
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "expired",
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
  });

  it("correctly derives all lifecycle statuses (NOT_GENERATED, ACTIVE, EXPIRED, USED, REVOKED)", () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    const future = new Date("2026-11-05T12:00:00.000Z");
    const past = new Date("2026-11-01T12:00:00.000Z");

    // NOT_GENERATED
    expect(deriveUploadLinkStatus(null, now)).toBe("NOT_GENERATED");

    // ACTIVE
    expect(
      deriveUploadLinkStatus(
        { expiresAt: future, usedAt: null, submission: null },
        now,
      ),
    ).toBe("ACTIVE");

    // EXPIRED
    expect(
      deriveUploadLinkStatus(
        { expiresAt: past, usedAt: null, submission: null },
        now,
      ),
    ).toBe("EXPIRED");

    // USED (has usedAt AND associated submission)
    expect(
      deriveUploadLinkStatus(
        {
          expiresAt: future,
          usedAt: past,
          submission: { id: "sub-1" },
        },
        now,
      ),
    ).toBe("USED");

    // REVOKED (has usedAt but NO submission)
    expect(
      deriveUploadLinkStatus(
        { expiresAt: future, usedAt: past, submission: null },
        now,
      ),
    ).toBe("REVOKED");
  });

  it("revokes active upload links atomically", async () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    (prisma.uploadLink.updateMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      count: 1,
    });

    const revoked = await revokeUploadLink("trip-123", now);
    expect(revoked).toBe(true);
    expect(prisma.uploadLink.updateMany).toHaveBeenCalledWith({
      where: {
        tripId: "trip-123",
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        usedAt: now,
      },
    });
  });
});
