import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPodImageToken,
  POD_IMAGE_URL_TTL_SECONDS,
  verifyPodImageToken,
} from "./imageUrl";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("signed POD image URLs", () => {
  it("signs a submission ID for a five-minute access window", async () => {
    vi.stubEnv("POD_IMAGE_URL_SECRET", "test-secret-with-more-than-32-characters");
    const submissionId = "00000000-0000-4000-8000-000000000001";
    const token = await createPodImageToken(submissionId);

    expect(POD_IMAGE_URL_TTL_SECONDS).toBe(300);
    await expect(verifyPodImageToken(token, submissionId)).resolves.toBe(true);
    await expect(
      verifyPodImageToken(token, "00000000-0000-4000-8000-000000000002"),
    ).resolves.toBe(false);
  });

  it("rejects tampered and expired tokens", async () => {
    vi.stubEnv("POD_IMAGE_URL_SECRET", "test-secret-with-more-than-32-characters");
    const token = await createPodImageToken(
      "00000000-0000-4000-8000-000000000001",
    );
    await expect(verifyPodImageToken(`${token}x`, "00000000-0000-4000-8000-000000000001")).resolves.toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
    const expiringToken = await createPodImageToken(
      "00000000-0000-4000-8000-000000000001",
    );
    await vi.advanceTimersByTimeAsync(301_000);
    await expect(
      verifyPodImageToken(
        expiringToken,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe(false);
  });
});
