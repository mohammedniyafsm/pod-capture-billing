import { describe, expect, it, vi } from "vitest";
import {
  MAX_POD_IMAGE_BYTES,
  parsePodUploadRequest,
} from "./uploadValidation";

const clientSubmissionId = "00000000-0000-4000-8000-000000000001";
const tripId = "00000000-0000-4000-8000-000000000002";

function jpegFile(size = 3, type = "image/jpeg") {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return new File([bytes], "pod.jpg", { type });
}

function pngFile(type = "image/png") {
  return new File(
    [
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
    ],
    "pod.png",
    { type },
  );
}

function uploadRequest(file: File, overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("image", file);
  form.set("clientSubmissionId", clientSubmissionId);
  form.set("tripId", tripId);
  form.set("gpsLat", "18.5204");
  form.set("gpsLng", "73.8567");
  form.set("capturedAt", "2026-11-03T12:00:00.000Z");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return new Request("http://localhost/api/pods", {
    method: "POST",
    body: form,
  });
}

describe("parsePodUploadRequest", () => {
  it("parses a JPEG multipart capture", async () => {
    const result = await parsePodUploadRequest(uploadRequest(jpegFile()));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      clientSubmissionId,
      tripId,
      gpsLat: 18.5204,
      gpsLng: 73.8567,
      capturedAt: new Date("2026-11-03T12:00:00.000Z"),
      imageFilename: "pod.jpg",
      mediaType: "image/jpeg",
      imageBytes: new Uint8Array([0xff, 0xd8, 0xff]),
    });
  });

  it.each([
    ["PNG", pngFile()],
    ["WebP", new File([
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
    ], "pod.webp", { type: "image/webp" })],
  ])("accepts a valid %s signature", async (_name, file) => {
    const result = await parsePodUploadRequest(uploadRequest(file));
    expect(result.success).toBe(true);
  });

  it("detects the actual format when the multipart MIME type is incorrect", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await parsePodUploadRequest(uploadRequest(pngFile("image/jpeg")));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mediaType).toBe("image/png");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("upload.validated"),
    );
    const message = log.mock.calls[0][0] as string;
    expect(message).toContain(clientSubmissionId);
    expect(message).toContain(tripId);
    expect(message).toContain("declared_type_mismatch_using_detected_type");
    expect(message).toContain("detectedMimeType");
    log.mockRestore();
  });

  it("accepts an image signature even when the client omits the MIME type", async () => {
    const result = await parsePodUploadRequest(uploadRequest(pngFile("")));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mediaType).toBe("image/png");
  });

  it("rejects images larger than 1 MB with a clear error", async () => {
    const result = await parsePodUploadRequest(
      uploadRequest(jpegFile(MAX_POD_IMAGE_BYTES + 1)),
    );
    expect(result).toMatchObject({
      success: false,
      status: 413,
      code: "image_too_large",
      error: expect.stringContaining("1 MB or smaller"),
    });
  });

  it.each([
    ["PDF", new File(["%PDF-1.7"], "pod.pdf", { type: "application/pdf" }), "unsupported_image_type"],
    ["spoofed JPEG", new File([new Uint8Array([1, 2, 3])], "fake.jpg", { type: "image/jpeg" }), "invalid_image"],
  ])("rejects %s", async (_name, file, code) => {
    const result = await parsePodUploadRequest(uploadRequest(file));
    expect(result).toMatchObject({ success: false, code });
  });

  it("validates the capture fields and paired GPS coordinates", async () => {
    const invalid = await parsePodUploadRequest(
      uploadRequest(jpegFile(), {
        clientSubmissionId: "not-a-uuid",
        gpsLng: "",
      }),
    );
    expect(invalid).toMatchObject({
      success: false,
      status: 400,
      code: "validation_error",
    });

    const noGps = await parsePodUploadRequest(
      uploadRequest(jpegFile(), { gpsLat: "", gpsLng: "" }),
    );
    expect(noGps.success).toBe(true);
    if (noGps.success) {
      expect(noGps.data.gpsLat).toBeNull();
      expect(noGps.data.gpsLng).toBeNull();
    }
  });

  it("rejects malformed multipart requests", async () => {
    const result = await parsePodUploadRequest(
      new Request("http://localhost/api/pods", {
        method: "POST",
        body: "not multipart",
      }),
    );
    expect(result).toMatchObject({
      success: false,
      status: 400,
      code: "invalid_multipart",
    });
  });
});
