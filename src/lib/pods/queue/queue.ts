import { Queue } from "bullmq";
import Redis from "ioredis";
import { logPodEvent } from "../common/podLogger";

export type PodVerificationJobData = {
  submissionId: string;
};

export const POD_VERIFICATION_QUEUE = process.env.POD_VERIFICATION_QUEUE ?? "pod-verification";


let sharedRedis: Redis | null = null;
let sharedQueue: Queue<PodVerificationJobData> | null = null;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is required to enqueue POD verification jobs.");
  }
  return url;
}

export function getPodVerificationQueue(): Queue<PodVerificationJobData> {
  if (!sharedQueue) {
    const redisUrl = getRedisUrl();
    sharedRedis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    sharedRedis.on("error", (error) => {
      logPodEvent(
        "queue.redis_connection_error",
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "error",
      );
    });

    sharedQueue = new Queue<PodVerificationJobData>(POD_VERIFICATION_QUEUE, {
      connection: sharedRedis,
    });
  }

  return sharedQueue;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Directly enqueues a POD verification job into BullMQ/Redis.
 * Uses submissionId as the jobId to prevent duplicate queue items.
 */
export async function enqueuePodVerification(submissionId: string): Promise<void> {
  const queue = getPodVerificationQueue();
  const attempts = positiveInteger(process.env.POD_JOB_ATTEMPTS, 4);
  const backoffDelay = positiveInteger(process.env.POD_JOB_BACKOFF_MS, 2_000);

  await queue.add(
    "verify-pod",
    { submissionId },
    {
      jobId: submissionId,
      attempts,
      backoff: {
        type: "exponential",
        delay: backoffDelay,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );

  logPodEvent("queue.job_enqueued", {
    queueName: POD_VERIFICATION_QUEUE,
    submissionId,
    jobId: submissionId,
  });
}

