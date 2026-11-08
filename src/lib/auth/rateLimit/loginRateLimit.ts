const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type RateLimitBucket = {
  attempts: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export const LOGIN_RATE_LIMIT = {
  maxAttempts: MAX_ATTEMPTS,
  windowMs: WINDOW_MS,
};

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();
  return forwardedIp || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function consumeLoginAttempts(keys: string[], now = Date.now()) {
  const activeBuckets = keys.map((key) => {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const newBucket = { attempts: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, newBucket);
      return [key, newBucket] as const;
    }
    return [key, bucket] as const;
  });

  const blockedBucket = activeBuckets.find(
    ([, bucket]) => bucket.attempts >= MAX_ATTEMPTS,
  );
  if (blockedBucket) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((blockedBucket[1].resetAt - now) / 1000),
      ),
    };
  }

  for (const [, bucket] of activeBuckets) bucket.attempts += 1;

  if (buckets.size > 10_000) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}
