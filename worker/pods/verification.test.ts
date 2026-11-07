import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PodSubmissionStatus,
  TripStatus,
  Verdict,
} from "@prisma/client";
import type { PodExtractionData } from "../ai/extractPod";
import {
  markPodVerificationFailed,
  PermanentPodVerificationError,
  processPodVerification,
  RetryablePodVerificationError,
} from "./verification";

const mocks = vi.hoisted(() => {
  const transaction = {
    podSubmission: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    trip: { updateMany: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      podSubmission: { findUnique: vi.fn() },
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    },
    storage: { read: vi.fn() },
    extractPod: vi.fn(),
  };
});

vi.mock("../../src/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../storage/imageStorage", () => ({
  getPodImageStorage: () => mocks.storage,
}));
vi.mock("../ai/extractPod", () => ({
  extractPod: mocks.extractPod,
}));

const goodExtraction: PodExtractionData = {
  image_quality: { readable: true, blur: false, cropped: false },
  lr_number: { value: "LR-B-20481", confidence: 0.99 },
  consignee_stamp: { present: true, confidence: 0.98 },
  signature: { present: true, confidence: 0.97 },
  delivery_date: { value: "2026-11-03", confidence: 0.95 },
  quantity_received: { value: 600, unit: "cartons", confidence: 0.96 },
  goods_description: { value: "Packaged foods", confidence: 0.96 },
  remarks_text: "",
  has_shortage_or_damage_remark: false,
  retake_hint: null,
};

function setup(
  extraction: PodExtractionData = goodExtraction,
  retakeCount = 0,
) {
  vi.clearAllMocks();
  const submission = {
    id: "submission-1",
    clientSubmissionId: "client-submission-1",
    imageKey: "private-pods/one.jpg",
    sourceFilename: "good.jpg",
    attemptNo: 1,
    status: PodSubmissionStatus.AI_CHECKING,
    extraction: null,
    trip: {
      id: "trip-1",
      lrNumber: "LR-B-20481",
      expectedQuantity: { toNumber: () => 600 },
      quantityUnit: "cartons",
      goodsDescription: "Packaged foods",
      deliveredAt: new Date("2026-11-03T12:00:00.000Z"),
      retakeCount,
      status: TripStatus.AI_CHECKING,
    },
  };
  mocks.prisma.podSubmission.findUnique.mockResolvedValue(submission);
  mocks.transaction.podSubmission.findUnique.mockResolvedValue({
    status: PodSubmissionStatus.AI_CHECKING,
    extraction: null,
  });
  mocks.transaction.podSubmission.update.mockResolvedValue({});
  mocks.transaction.podSubmission.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.trip.updateMany.mockResolvedValue({ count: 1 });
  mocks.storage.read.mockResolvedValue({
    contentType: "image/jpeg",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
        controller.close();
      },
    }),
  });
  mocks.extractPod.mockResolvedValue({
    ok: true,
    extraction,
    rawResponse: { model: "test" },
    modelName: "mock",
  });
}

describe("processPodVerification", () => {
  beforeEach(() => setup());

  it("persists terminal failure and returns the trip to POD_PENDING", async () => {
    mocks.transaction.podSubmission.findUnique.mockResolvedValueOnce({
      tripId: "trip-1",
    });
    await markPodVerificationFailed(
      "submission-1",
      new Error("Gemini temporarily unavailable"),
    );
    expect(mocks.transaction.podSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "submission-1",
          status: PodSubmissionStatus.AI_CHECKING,
        },
        data: expect.objectContaining({
          status: PodSubmissionStatus.FAILED,
          processingError: "Error",
        }),
      }),
    );
    expect(mocks.transaction.trip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "trip-1", status: TripStatus.AI_CHECKING },
        data: { status: TripStatus.POD_PENDING, statusReason: "pod_processing_failed" },
      }),
    );
  });

  it("uses the original filename for configured mock extractions", async () => {
    await processPodVerification("submission-1");

    expect(mocks.extractPod).toHaveBeenCalledWith(
      expect.objectContaining({ imageFilename: "good.jpg" }),
    );
  });

  it("runs extraction and persists a verified result with delivered quantity", async () => {
    await expect(processPodVerification("submission-1")).resolves.toBe("processed");
    expect(mocks.extractPod).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mediaType: "image/jpeg",
        expectedLrNumber: "LR-B-20481",
      }),
    );
    expect(mocks.transaction.podSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PodSubmissionStatus.VERIFIED,
          extraction: {
            create: expect.objectContaining({ verdict: Verdict.VERIFIED }),
          },
        }),
      }),
    );
    const tripUpdate = mocks.transaction.trip.updateMany.mock.calls[0][0];
    expect(tripUpdate.data.status).toBe(TripStatus.VERIFIED);
    expect(tripUpdate.data.deliveredQuantity.toString()).toBe("600");
  });

  it("keeps the existing retake decision and max-attempt policy", async () => {
    setup(
      {
        ...goodExtraction,
        consignee_stamp: { present: false, confidence: 0.98 },
      },
      0,
    );
    await processPodVerification("submission-1");
    expect(mocks.transaction.podSubmission.update.mock.calls[0][0].data).toMatchObject({
      status: PodSubmissionStatus.RETAKE,
      retakeReason: "stamp_not_visible",
      attemptsLeft: 1,
    });
    expect(mocks.transaction.trip.updateMany.mock.calls[0][0].data).toMatchObject({
      status: TripStatus.RETAKE_REQUESTED,
      retakeCount: { increment: 1 },
    });
  });

  it("uses manual review when the existing retake limit has been reached", async () => {
    setup(
      {
        ...goodExtraction,
        consignee_stamp: { present: false, confidence: 0.98 },
      },
      2,
    );
    await processPodVerification("submission-1");
    expect(mocks.transaction.podSubmission.update.mock.calls[0][0].data).toMatchObject({
      status: PodSubmissionStatus.REVIEW,
      attemptsLeft: 0,
      extraction: {
        create: {
          verdict: Verdict.REVIEW,
          reasons: ["retake_limit"],
        },
      },
    });
    expect(mocks.transaction.trip.updateMany.mock.calls[0][0].data.status).toBe(
      TripStatus.NEEDS_REVIEW,
    );
  });

  it("routes business exceptions to human review", async () => {
    setup({
      ...goodExtraction,
      remarks_text: "Short by six cartons",
      has_shortage_or_damage_remark: true,
    });
    await processPodVerification("submission-1");
    expect(mocks.transaction.podSubmission.update.mock.calls[0][0].data).toMatchObject({
      status: PodSubmissionStatus.REVIEW,
      extraction: { create: { verdict: Verdict.REVIEW } },
    });
    expect(mocks.transaction.trip.updateMany.mock.calls[0][0].data.status).toBe(
      TripStatus.NEEDS_REVIEW,
    );
  });

  it("does not call Gemini again for an already persisted extraction", async () => {
    mocks.prisma.podSubmission.findUnique.mockResolvedValueOnce({
      id: "submission-1",
      status: PodSubmissionStatus.VERIFIED,
      extraction: { submissionId: "submission-1" },
      trip: {},
    });
    await expect(processPodVerification("submission-1")).resolves.toBe(
      "already_processed",
    );
    expect(mocks.extractPod).not.toHaveBeenCalled();
  });

  it("does not create another extraction when a duplicate job finds a committed result", async () => {
    mocks.transaction.podSubmission.findUnique.mockResolvedValue({
      status: PodSubmissionStatus.VERIFIED,
      extraction: { submissionId: "submission-1" },
    });
    await expect(processPodVerification("submission-1")).resolves.toBe(
      "already_processed",
    );
    expect(mocks.transaction.podSubmission.update).not.toHaveBeenCalled();
    expect(mocks.transaction.trip.updateMany).not.toHaveBeenCalled();
  });

  it("marks missing stored image as permanent rather than retrying it", async () => {
    mocks.storage.read.mockResolvedValue(null);
    await expect(processPodVerification("submission-1")).rejects.toBeInstanceOf(
      PermanentPodVerificationError,
    );
    expect(mocks.extractPod).not.toHaveBeenCalled();
  });

  it("retries transient AI failures instead of persisting a false verdict", async () => {
    mocks.extractPod.mockResolvedValue({
      ok: false,
      aiFailed: true,
      aiTimedOut: true,
      reason: "request_failed",
      retryable: true,
    });
    await expect(processPodVerification("submission-1")).rejects.toBeInstanceOf(
      RetryablePodVerificationError,
    );
    expect(mocks.transaction.podSubmission.update).not.toHaveBeenCalled();
  });
});
