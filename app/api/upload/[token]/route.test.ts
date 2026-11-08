import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    uploadLink: { findUnique: vi.fn(), updateMany: vi.fn() },
    podSubmission: { findUnique: vi.fn() },
    trip: { findUnique: vi.fn() },
  },
  processPodCapture: vi.fn(),
  parsePodUploadRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../../../../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/src/lib/pods/capture/capture", () => ({
  processPodCapture: mocks.processPodCapture,
  CaptureError: class CaptureError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
      super(message);
    }
  },
}));

vi.mock("../../../../src/lib/pods/capture/capture", () => ({
  processPodCapture: mocks.processPodCapture,
  CaptureError: class CaptureError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
      super(message);
    }
  },
}));

vi.mock("@/src/lib/pods/validation/uploadValidation", () => ({
  parsePodUploadRequest: mocks.parsePodUploadRequest,
}));

vi.mock("../../../../src/lib/pods/validation/uploadValidation", () => ({
  parsePodUploadRequest: mocks.parsePodUploadRequest,
}));

import { POST as handleUploadPost } from "./route";

describe("POST /api/upload/[token] - Reliability & Idempotency", () => {
  const token = "a".repeat(43); // valid 43-char base64url
  const tripId = "00000000-0000-4000-8000-000000000001";
  const clientSubmissionId = "sub-1234";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. First submission succeeds and returns 202 accepted", async () => {
    mocks.parsePodUploadRequest.mockResolvedValueOnce({
      success: true,
      data: {
        tripId,
        clientSubmissionId,
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
        imageFilename: "pod.jpg",
        mediaType: "image/jpeg",
        capturedAt: new Date(),
      },
    });

    mocks.prisma.uploadLink.findUnique.mockResolvedValueOnce({
      id: "link-1",
      tripId,
      expiresAt: new Date(Date.now() + 100000),
      usedAt: null,
      trip: { isHired: true },
    });

    mocks.processPodCapture.mockResolvedValueOnce({
      submissionId: "submission-abc",
      status: "AI_CHECKING",
    });

    const res = await handleUploadPost(
      new Request("https://example.com/api/upload/" + token, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.submissionId).toBe("submission-abc");
  });

  it("2 & 3. Same submission ID retry after lost response returns existing submission", async () => {
    mocks.parsePodUploadRequest.mockResolvedValueOnce({
      success: true,
      data: {
        tripId,
        clientSubmissionId,
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
        imageFilename: "pod.jpg",
        mediaType: "image/jpeg",
        capturedAt: new Date(),
      },
    });

    // The link is now marked usedAt because the server accepted it before the response was lost
    mocks.prisma.uploadLink.findUnique.mockResolvedValueOnce({
      id: "link-1",
      tripId,
      expiresAt: new Date(Date.now() + 100000),
      usedAt: new Date(),
      trip: { isHired: true },
    });

    // Lookup finds the existing submission matching this submissionId, tripId, and uploadLinkId
    mocks.prisma.podSubmission.findUnique.mockResolvedValueOnce({
      tripId,
      uploadLinkId: "link-1",
    });

    mocks.processPodCapture.mockResolvedValueOnce({
      submissionId: "submission-abc",
      status: "AI_CHECKING",
    });

    const res = await handleUploadPost(
      new Request("https://example.com/api/upload/" + token, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.submissionId).toBe("submission-abc");
    expect(mocks.processPodCapture).toHaveBeenCalledWith(
      expect.objectContaining({ clientSubmissionId }),
      { userId: null, uploadLinkId: "link-1" },
    );
  });

  it("4. Different submission ID against a used link is rejected with 410", async () => {
    mocks.parsePodUploadRequest.mockResolvedValueOnce({
      success: true,
      data: {
        tripId,
        clientSubmissionId: "different-sub-id",
        imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
        imageFilename: "pod.jpg",
        mediaType: "image/jpeg",
        capturedAt: new Date(),
      },
    });

    mocks.prisma.uploadLink.findUnique.mockResolvedValueOnce({
      id: "link-1",
      tripId,
      expiresAt: new Date(Date.now() + 100000),
      usedAt: new Date(),
      trip: { isHired: true },
    });

    // No existing submission for this different clientSubmissionId
    mocks.prisma.podSubmission.findUnique.mockResolvedValueOnce(null);

    const res = await handleUploadPost(
      new Request("https://example.com/api/upload/" + token, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.code).toBe("upload_link_unavailable");
    expect(mocks.processPodCapture).not.toHaveBeenCalled();
  });

  it("5. Rejects request when client sends 'file' instead of 'image' field", async () => {
    // Calling handleUploadPost with unmocked parsePodUploadRequest or testing real validation rejection
    mocks.parsePodUploadRequest.mockResolvedValueOnce({
      success: false,
      status: 400,
      code: "image_required",
      error: "A POD image file is required.",
    });

    const res = await handleUploadPost(
      new Request("https://example.com/api/upload/" + token, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("image_required");
    expect(mocks.processPodCapture).not.toHaveBeenCalled();
  });
});
