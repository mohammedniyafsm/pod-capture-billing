import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const guard = vi.fn();
  return {
    guard,
    requireRole: vi.fn(() => guard),
    processPodCapture: vi.fn(),
    parsePodUploadRequest: vi.fn(),
  };
});

vi.mock("@/src/lib/auth/rbac/requireRole", () => ({
  requireRole: mocks.requireRole,
}));
vi.mock("@/src/lib/pods/capture/capture", () => ({
  CaptureError: class CaptureError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string,
    ) {
      super(message);
    }
  },
  processPodCapture: mocks.processPodCapture,
}));
vi.mock("@/src/lib/pods/common/podLogger", () => ({
  logPodEvent: vi.fn(),
}));
vi.mock("@/src/lib/pods/validation/uploadValidation", () => ({
  parsePodUploadRequest: mocks.parsePodUploadRequest,
}));

import { POST } from "./route";

const parsedUpload = {
  clientSubmissionId: "00000000-0000-4000-8000-000000000001",
  tripId: "00000000-0000-4000-8000-000000000002",
  imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
  mediaType: "image/jpeg",
};

describe("POST /api/pods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parsePodUploadRequest.mockResolvedValue({
      success: true,
      data: parsedUpload,
    });
    mocks.guard.mockResolvedValue({
      ok: true,
      session: { userId: "driver-1", role: "DRIVER" },
    });
    mocks.processPodCapture.mockResolvedValue({
      submissionId: "submission-1",
      status: "AI_CHECKING",
    });
  });

  it("returns 202 after storage and durable submission/outbox creation", async () => {
    const response = await POST(new Request("http://localhost/api/pods", {
      method: "POST",
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { submissionId: "submission-1", status: "AI_CHECKING" },
    });
    expect(mocks.processPodCapture).toHaveBeenCalledWith(parsedUpload, {
      userId: "driver-1",
    });
  });

  it("rejects unauthorized uploads before parsing or storing an image", async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
    });

    const response = await POST(new Request("http://localhost/api/pods", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(mocks.parsePodUploadRequest).not.toHaveBeenCalled();
    expect(mocks.processPodCapture).not.toHaveBeenCalled();
  });
});
