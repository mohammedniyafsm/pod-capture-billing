import { beforeEach, describe, expect, it, vi } from "vitest";
import { PodSubmissionStatus, TripStatus } from "@prisma/client";
import { processPodCapture } from "./capture";

const mocks = vi.hoisted(() => {
  const transaction = {
    uploadLink: { updateMany: vi.fn() },
    podSubmission: { findFirst: vi.fn(), create: vi.fn() },
    trip: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      podSubmission: { findUnique: vi.fn() },
      trip: { findUnique: vi.fn() },
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    },
    storage: { save: vi.fn(), remove: vi.fn() },
    enqueue: vi.fn(),
  };
});

vi.mock("../../prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../storage/imageStorage", () => ({
  getPodImageStorage: () => mocks.storage,
}));
vi.mock("../queue/queue", () => ({
  enqueuePodVerification: mocks.enqueue,
}));

const upload = {
  clientSubmissionId: "00000000-0000-4000-8000-000000000001",
  tripId: "00000000-0000-4000-8000-000000000002",
  gpsLat: 18.52,
  gpsLng: 73.85,
  capturedAt: new Date("2026-11-03T12:00:00.000Z"),
  imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
  imageFilename: "pod.jpg",
  mediaType: "image/jpeg" as const,
};

function setup({ isHired = false } = {}) {
  vi.clearAllMocks();
  mocks.prisma.podSubmission.findUnique.mockResolvedValue(null);
  mocks.prisma.trip.findUnique.mockResolvedValue({
    id: upload.tripId,
    driverId: "driver-1",
    isHired,
    retakeCount: 0,
    status: TripStatus.POD_PENDING,
  });
  mocks.transaction.uploadLink.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.podSubmission.findFirst.mockResolvedValue(null);
  mocks.transaction.trip.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.podSubmission.create.mockResolvedValue({});
  mocks.transaction.auditLog.create.mockResolvedValue({});
  mocks.storage.save.mockResolvedValue("private-pods/test-image.jpg");
  mocks.storage.remove.mockResolvedValue(undefined);
  mocks.enqueue.mockResolvedValue(undefined);
}

describe("processPodCapture", () => {
  beforeEach(() => setup());

  it("persists image reference, submission, and enqueues BullMQ job directly without outbox", async () => {
    const result = await processPodCapture(upload, { userId: "driver-1" });

    expect(result).toEqual({
      submissionId: expect.any(String),
      status: PodSubmissionStatus.AI_CHECKING,
      enqueued: true,
    });
    expect(mocks.storage.save).toHaveBeenCalledWith(
      upload.imageBytes,
      upload.mediaType,
    );
    expect(mocks.transaction.podSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageKey: "private-pods/test-image.jpg",
          sourceFilename: upload.imageFilename,
          status: PodSubmissionStatus.AI_CHECKING,
          uploadedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.transaction.trip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TripStatus.AI_CHECKING,
          podReceivedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(result.submissionId);
  });

  it("does not enqueue job if the database transaction fails", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      processPodCapture(upload, { userId: "driver-1" }),
    ).rejects.toThrow("db unavailable");

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.storage.remove).toHaveBeenCalledWith(
      "private-pods/test-image.jpg",
    );
  });

  it("preserves committed submission and image when Redis enqueue fails", async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error("Redis connection refused"));

    const result = await processPodCapture(upload, { userId: "driver-1" });

    // Submission is accepted in DB, enqueued is false, but image is NOT deleted
    expect(result).toEqual({
      submissionId: expect.any(String),
      status: PodSubmissionStatus.AI_CHECKING,
      enqueued: false,
    });
    expect(mocks.storage.remove).not.toHaveBeenCalled();
  });

  it("returns the existing submission and safely re-enqueues for an idempotent retry", async () => {
    mocks.prisma.podSubmission.findUnique.mockResolvedValue({
      id: "submission-existing",
      tripId: upload.tripId,
      uploadLinkId: null,
      status: PodSubmissionStatus.AI_CHECKING,
      trip: { driverId: "driver-1" },
    });

    const result = await processPodCapture(upload, { userId: "driver-1" });
    expect(result).toEqual({
      submissionId: "submission-existing",
      status: PodSubmissionStatus.AI_CHECKING,
    });
    expect(mocks.storage.save).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    // Safe retry triggers BullMQ re-enqueue with submissionId (idempotent BullMQ jobId)
    expect(mocks.enqueue).toHaveBeenCalledWith("submission-existing");
  });

  it("claims a hired-driver upload link in the same transaction", async () => {
    setup({ isHired: true });

    await processPodCapture(upload, {
      userId: null,
      uploadLinkId: "upload-link-1",
    });

    expect(mocks.transaction.uploadLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "upload-link-1",
          usedAt: null,
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects concurrent submissions where the link has already been claimed", async () => {
    setup({ isHired: true });
    // Simulate race where another request claimed the link first in updateMany
    mocks.transaction.uploadLink.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      processPodCapture(upload, {
        userId: null,
        uploadLinkId: "upload-link-1",
      }),
    ).rejects.toThrow("This upload link has expired or has already been used.");

    // And verify the storage cleanup runs and no enqueue occurs
    expect(mocks.storage.remove).toHaveBeenCalledWith(
      "private-pods/test-image.jpg",
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
