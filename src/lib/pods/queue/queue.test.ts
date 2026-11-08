import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const queue = {
    add: vi.fn(),
  };
  const redisInstance = {
    on: vi.fn(),
  };
  function MockRedis() {
    return redisInstance;
  }
  function MockQueue() {
    return queue;
  }
  return {
    queue,
    redisInstance,
    MockRedis,
    MockQueue,
  };
});

vi.mock("ioredis", () => ({
  default: mocks.MockRedis,
}));

vi.mock("bullmq", () => ({
  Queue: mocks.MockQueue,
}));

import { enqueuePodVerification } from "./queue";

describe("enqueuePodVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.POD_VERIFICATION_QUEUE = "pod-verification";
    mocks.queue.add.mockResolvedValue({ id: "sub-123" });
  });

  it("enqueues a verification job with submissionId as both job data and jobId", async () => {
    await enqueuePodVerification("sub-123");

    expect(mocks.queue.add).toHaveBeenCalledTimes(1);
    expect(mocks.queue.add).toHaveBeenCalledWith(
      "verify-pod",
      { submissionId: "sub-123" },
      expect.objectContaining({
        jobId: "sub-123",
        attempts: expect.any(Number),
        backoff: expect.objectContaining({
          type: "exponential",
        }),
      }),
    );
  });

  it("propagates error when queue.add fails", async () => {
    mocks.queue.add.mockRejectedValueOnce(new Error("Redis connection dropped"));

    await expect(enqueuePodVerification("sub-fail")).rejects.toThrow(
      "Redis connection dropped",
    );
  });
});
