import { beforeEach, describe, expect, it, vi } from "vitest";
import { PodVerificationOutboxStatus } from "@prisma/client";
import { dispatchPendingOutbox } from "./outbox";

const mocks = vi.hoisted(() => ({
  prisma: {
    podVerificationOutbox: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
  queue: { add: vi.fn() },
}));

vi.mock("../../src/lib/prisma", () => ({ prisma: mocks.prisma }));

describe("dispatchPendingOutbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.podVerificationOutbox.findMany.mockResolvedValue([
      {
        id: "outbox-1",
        submissionId: "submission-1",
        status: PodVerificationOutboxStatus.PENDING,
        attempts: 0,
      },
    ]);
    mocks.prisma.podVerificationOutbox.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.podVerificationOutbox.update.mockResolvedValue({});
    mocks.queue.add.mockResolvedValue({});
  });

  it("keeps the outbox pending and schedules retry when Redis enqueue fails", async () => {
    mocks.queue.add.mockRejectedValueOnce(new Error("redis unavailable"));

    await dispatchPendingOutbox(mocks.queue as never);

    expect(mocks.prisma.podVerificationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PodVerificationOutboxStatus.PENDING,
          availableAt: expect.any(Date),
          attempts: { increment: 1 },
          lastError: "Error",
        }),
      }),
    );
  });

  it("publishes a pending record with a stable idempotent job ID", async () => {
    await dispatchPendingOutbox(mocks.queue as never);

    expect(mocks.queue.add).toHaveBeenCalledWith(
      "verify-pod",
      { submissionId: "submission-1" },
      expect.objectContaining({
        jobId: "submission-1",
        attempts: expect.any(Number),
        backoff: expect.objectContaining({ type: "exponential" }),
      }),
    );
    expect(mocks.prisma.podVerificationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PodVerificationOutboxStatus.PUBLISHED,
          publishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("recovers a pending record after Redis becomes available", async () => {
    mocks.queue.add.mockRejectedValueOnce(new Error("redis unavailable"));
    await dispatchPendingOutbox(mocks.queue as never);
    mocks.queue.add.mockResolvedValueOnce({});

    await dispatchPendingOutbox(mocks.queue as never);

    expect(mocks.queue.add).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.podVerificationOutbox.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PodVerificationOutboxStatus.PUBLISHED,
        }),
      }),
    );
  });
});
