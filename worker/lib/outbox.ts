import { PodVerificationOutboxStatus } from "@prisma/client";
import type { Queue } from "bullmq";
import { prisma } from "../../src/lib/prisma";

type VerificationJob = { submissionId: string };

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.name : "UnknownPublishError";
}

export async function dispatchPendingOutbox(
  queue: Queue<VerificationJob>,
) {
  const now = new Date();
  const batchSize = positiveInteger(process.env.OUTBOX_BATCH_SIZE, 25);
  const leaseMs = positiveInteger(process.env.OUTBOX_LEASE_MS, 60_000);
  const records = await prisma.podVerificationOutbox.findMany({
    where: {
      OR: [
        {
          status: PodVerificationOutboxStatus.PENDING,
          availableAt: { lte: now },
        },
        {
          status: PodVerificationOutboxStatus.DISPATCHING,
          leaseUntil: { lte: now },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true, submissionId: true, status: true, attempts: true },
  });

  for (const record of records) {
    const leaseUntil = new Date(Date.now() + leaseMs);
    const claimed = await prisma.podVerificationOutbox.updateMany({
      where: {
        id: record.id,
        OR: [
          {
            status: PodVerificationOutboxStatus.PENDING,
            availableAt: { lte: now },
          },
          {
            status: PodVerificationOutboxStatus.DISPATCHING,
            leaseUntil: { lte: now },
          },
        ],
      },
      data: { status: PodVerificationOutboxStatus.DISPATCHING, leaseUntil },
    });
    if (claimed.count !== 1) continue;

    try {
      await queue.add(
        "verify-pod",
        { submissionId: record.submissionId },
        {
          jobId: record.submissionId,
          attempts: positiveInteger(process.env.POD_JOB_ATTEMPTS, 4),
          backoff: {
            type: "exponential",
            delay: positiveInteger(process.env.POD_JOB_BACKOFF_MS, 2_000),
          },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      );
      await prisma.podVerificationOutbox.update({
        where: { id: record.id },
        data: {
          status: PodVerificationOutboxStatus.PUBLISHED,
          publishedAt: new Date(),
          leaseUntil: null,
          lastError: null,
          attempts: { increment: 1 },
        },
      });
    } catch (error) {
      const maxDelay = positiveInteger(
        process.env.OUTBOX_RETRY_MAX_DELAY_MS,
        300_000,
      );
      const delay = Math.min(
        1000 * 2 ** Math.min(record.attempts, 8),
        maxDelay,
      );
      await prisma.podVerificationOutbox.update({
        where: { id: record.id },
        data: {
          status: PodVerificationOutboxStatus.PENDING,
          leaseUntil: null,
          availableAt: new Date(Date.now() + delay),
          lastError: errorText(error),
          attempts: { increment: 1 },
        },
      });
      console.error("POD outbox publish failed; record remains pending.", {
        outboxId: record.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
