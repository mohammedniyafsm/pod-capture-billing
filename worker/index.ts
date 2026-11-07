import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { prisma } from "../src/lib/prisma";
import { logPodEvent } from "./ai/podLogger";
import {
  markPodVerificationFailed,
  PermanentPodVerificationError,
  processPodVerification,
} from "./pods/verification";
import { dispatchPendingOutbox } from "./lib/outbox";

type VerificationJob = { submissionId: string };
const queueName = process.env.POD_VERIFICATION_QUEUE ?? "pod-verification";
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for the POD worker.");
if (process.env.NODE_ENV === "production" && !process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error(
    "BLOB_READ_WRITE_TOKEN is required by the Railway worker to read private Vercel Blob images.",
  );
}
if (
  process.env.NODE_ENV === "production" &&
  process.env.AI_MODE !== "mock" &&
  !process.env.GEMINI_API_KEY
) {
  throw new Error("GEMINI_API_KEY is required for production POD verification.");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const queueConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
});

const workerConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

for (const redisConnection of [queueConnection, workerConnection]) {
  redisConnection.on("error", (error) => {
    console.error("POD worker Redis connection error.", {
      errorType: error.name,
    });
  });
}

const queue = new Queue<VerificationJob>(queueName, {
  connection: queueConnection,
});

const worker = new Worker<VerificationJob>(
  queueName,
  async (job: Job<VerificationJob>) => {
    const { submissionId } = job.data;
    try {
      return await processPodVerification(submissionId);
    } catch (error) {
      if (error instanceof PermanentPodVerificationError) {
        await markPodVerificationFailed(submissionId, error);
        return "failed_permanently";
      }
      throw error;
    }
  },
  {
    connection: workerConnection,
    concurrency: positiveInteger(process.env.POD_WORKER_CONCURRENCY, 4),
  },
);

worker.on("completed", (job, result) => {
  logPodEvent("worker.job_completed", {
    jobId: job.id,
    submissionId: job.data.submissionId,
    result,
  });
});

worker.on("failed", (job, error) => {
  if (!job) return;
  console.error("POD verification job attempt failed.", {
    jobId: job.id,
    submissionId: job.data.submissionId,
    attemptsMade: job.attemptsMade,
    errorType: error.name,
  });


  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markPodVerificationFailed(job.data.submissionId, error).catch(
      (persistenceError: unknown) => {
        console.error("Unable to persist terminal POD processing failure.", {
          submissionId: job.data.submissionId,
          errorType:
            persistenceError instanceof Error
              ? persistenceError.name
              : "UnknownError",
        });
      },
    );
  }
});


worker.on("error", (error) => {
  console.error("POD worker error.", { errorType: error.name });
});

const pollIntervalMs = positiveInteger(process.env.OUTBOX_POLL_INTERVAL_MS, 2_000);
let dispatching = false;

const dispatchTimer = setInterval(() => {
  if (dispatching) return;
  dispatching = true;
  void dispatchPendingOutbox(queue)
    .catch((error: unknown) => {
      console.error("POD outbox scan failed.", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    })
    .finally(() => {
      dispatching = false;
    });
}, pollIntervalMs);

void dispatchPendingOutbox(queue).catch((error: unknown) => {
  console.error("Initial POD outbox scan failed.", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
});

logPodEvent("worker.started", {
  queueName,
  concurrency: positiveInteger(process.env.POD_WORKER_CONCURRENCY, 4),
});

async function shutdown(signal: string) {
  clearInterval(dispatchTimer);
  logPodEvent("worker.shutdown_started", { signal });
  await Promise.all([worker.close(), queue.close()]);
  await Promise.all([queueConnection.quit(), workerConnection.quit()]);
  await prisma.$disconnect();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
