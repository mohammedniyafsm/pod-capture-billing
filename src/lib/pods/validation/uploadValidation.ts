import { z } from "zod";
import { logPodEvent } from "../common/podLogger";

export const MAX_POD_IMAGE_BYTES = 1024 * 1024;
const MAX_MULTIPART_BYTES = 1100 * 1024;
type PodImageMediaType = "image/jpeg" | "image/png" | "image/webp";

const captureFieldsSchema = z
  .object({
    clientSubmissionId: z.uuid(),
    tripId: z.uuid(),
    gpsLat: z.number().min(-90).max(90).nullable(),
    gpsLng: z.number().min(-180).max(180).nullable(),
    capturedAt: z.date(),
  })
  .refine(
    (value) => (value.gpsLat === null) === (value.gpsLng === null),
    "GPS latitude and longitude must be provided together.",
  );

export type ParsedPodUpload = {
  clientSubmissionId: string;
  tripId: string;
  gpsLat: number | null;
  gpsLng: number | null;
  capturedAt: Date;
  imageBytes: Uint8Array;
  imageFilename: string;
  mediaType: PodImageMediaType;
};

export type PodUploadParseResult =
  | { success: true; data: ParsedPodUpload }
  | {
      success: false;
      status: number;
      code: string;
      error: string;
      details?: unknown;
    };

function parseOptionalCoordinate(value: FormDataEntryValue | null) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return Number.NaN;
  return Number(value);
}

function detectImageMediaType(bytes: Uint8Array): PodImageMediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function parsePodUploadRequest(
  request: Request,
): Promise<PodUploadParseResult> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    logPodEvent(
      "upload.rejected",
      {
        requestBytes: contentLength,
        declaredMimeType: request.headers.get("content-type") ?? "unknown",
        reason: "multipart_request_too_large",
      },
      "warn",
    );
    return {
      success: false,
      status: 413,
      code: "image_too_large",
      error: "POD image must be 1 MB or smaller. Compress it before uploading.",
    };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    logPodEvent("upload.rejected", { reason: "invalid_multipart" }, "warn");
    return {
      success: false,
      status: 400,
      code: "invalid_multipart",
      error: "Request must be valid multipart form data.",
    };
  }

  const image = formData.get("image");
  if (!(image instanceof File)) {
    logPodEvent(
      "upload.rejected",
      {
        clientSubmissionId: formData.get("clientSubmissionId"),
        tripId: formData.get("tripId"),
        reason: "image_required",
      },
      "warn",
    );
    return {
      success: false,
      status: 400,
      code: "image_required",
      error: "A POD image file is required.",
    };
  }
  const fields = captureFieldsSchema.safeParse({
    clientSubmissionId: formData.get("clientSubmissionId"),
    tripId: formData.get("tripId"),
    gpsLat: parseOptionalCoordinate(formData.get("gpsLat")),
    gpsLng: parseOptionalCoordinate(formData.get("gpsLng")),
    capturedAt: formData.get("capturedAt")
      ? new Date(String(formData.get("capturedAt")))
      : new Date(Number.NaN),
  });
  if (!fields.success) {
    logPodEvent(
      "upload.rejected",
      {
        reason: "validation_error",
        validationIssues: fields.error.issues.map(
          (issue) => `${issue.path.join(".")}:${issue.code}`,
        ),
      },
      "warn",
    );
    return {
      success: false,
      status: 400,
      code: "validation_error",
      error: "POD capture fields are invalid.",
      details: fields.error.flatten(),
    };
  }

  if (image.size > MAX_POD_IMAGE_BYTES) {
    logPodEvent(
      "upload.rejected",
      {
        clientSubmissionId: fields.data.clientSubmissionId,
        tripId: fields.data.tripId,
        imageSizeBytes: image.size,
        declaredMimeType: image.type || "unknown",
        reason: "image_too_large",
      },
      "warn",
    );
    return {
      success: false,
      status: 413,
      code: "image_too_large",
      error: "POD image must be 1 MB or smaller. Compress it before uploading.",
    };
  }

  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const mediaType = detectImageMediaType(imageBytes);
  if (!mediaType) {
    const declaredImageType = image.type.startsWith("image/");
    logPodEvent(
      "upload.rejected",
      {
        clientSubmissionId: fields.data.clientSubmissionId,
        tripId: fields.data.tripId,
        imageSizeBytes: image.size,
        declaredMimeType: image.type || "unknown",
        reason: declaredImageType
          ? "invalid_image_signature"
          : "unsupported_image_type",
      },
      "warn",
    );
    return {
      success: false,
      status: 415,
      code: declaredImageType ? "invalid_image" : "unsupported_image_type",
      error: declaredImageType
        ? "File contents are not a supported JPEG, PNG, or WebP image."
        : "Only JPEG, PNG, and WebP POD images are accepted. PDFs are not supported.",
    };
  }
  logPodEvent("upload.validated", {
    clientSubmissionId: fields.data.clientSubmissionId,
    tripId: fields.data.tripId,
    imageSizeBytes: image.size,
    declaredMimeType: image.type || "unknown",
    detectedMimeType: mediaType,
    ...(image.type && image.type !== mediaType
      ? { note: "declared_type_mismatch_using_detected_type" }
      : {}),
  });

  return {
    success: true,
    data: {
      ...fields.data,
      imageBytes,
      imageFilename: image.name,
      mediaType,
    },
  };
}
