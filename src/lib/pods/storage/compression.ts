/**
 * Automatic Client-Side Image Compression for POD capture.
 *
 * Requirements:
 * - Automatically compress photos captured by drivers' phone cameras.
 * - Target below 300 KB where reasonably possible.
 * - Preserve high enough resolution and legibility for OCR/AI extraction
 *   (LR numbers, consignee stamp, signature, quantities, remarks).
 * - Readability is prioritized over aggressive file shrinkage.
 * - Never reduce quality below a safe legibility threshold (e.g. 0.65).
 * - Safe error handling with fallback to original image when format or canvas fails.
 */

export interface CompressionOptions {
  /** Maximum dimension (width or height) in pixels. Default: 2048px (standard OCR sweet spot) */
  maxDimension?: number;
  /** Target file size in bytes. Default: 300 KB (300 * 1024) */
  targetSizeBytes?: number;
  /** Hard cap on file size in bytes accepted by backend. Default: 1 MB */
  maxSizeBytes?: number;
  /** Output MIME type. Default: "image/jpeg" */
  outputType?: "image/jpeg" | "image/webp";
  /** Initial quality level between 0 and 1. Default: 0.85 */
  initialQuality?: number;
  /** Minimum quality floor to ensure document legibility. Default: 0.65 */
  minQuality?: number;
}

export interface CompressionResult {
  /** The compressed Blob */
  blob: Blob;
  /** Size in bytes */
  sizeBytes: number;
  /** Final width */
  width: number;
  /** Final height */
  height: number;
  /** Whether compression was applied */
  wasCompressed: boolean;
  /** MIME type */
  mediaType: string;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxDimension: 2048,
  targetSizeBytes: 300 * 1024, // 300 KB
  maxSizeBytes: 1024 * 1024, // 1 MB backend limit
  outputType: "image/jpeg",
  initialQuality: 0.85,
  minQuality: 0.65,
};

/**
 * Loads an image File or Blob into an HTMLImageElement using object URL.
 */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to decode image: ${err}`));
    };
    img.src = url;
  });
}

/**
 * Converts a Canvas to a Blob with given type and quality.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Computes scaled dimensions preserving aspect ratio.
 */
export function calculateDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDimension: number,
): { width: number; height: number } {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { width: Math.max(1, srcWidth), height: Math.max(1, srcHeight) };
  }

  let width = srcWidth;
  let height = srcHeight;

  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  return { width, height };
}

/**
 * Compresses an image file/blob automatically.
 * Prioritizes legibility over aggressive compression.
 */
export async function compressPodImage(
  file: File | Blob,
  options?: CompressionOptions,
): Promise<CompressionResult> {
  const opts: Required<CompressionOptions> = { ...DEFAULT_OPTIONS, ...options };

  // If already below target size and within format, check if we even need compression
  const isJpegOrWebp = file.type === "image/jpeg" || file.type === "image/webp";
  if (isJpegOrWebp && file.size <= opts.targetSizeBytes) {
    // Already compact enough, keep original bytes intact to avoid re-encoding loss
    return {
      blob: file,
      sizeBytes: file.size,
      width: 0,
      height: 0,
      wasCompressed: false,
      mediaType: file.type,
    };
  }

  // Attempt canvas-based compression
  try {
    const img = await loadImage(file);
    const { width, height } = calculateDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      opts.maxDimension,
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to obtain 2D canvas context for image compression");
    }

    // High quality scaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Fill white background for documents in case source has transparency (PNG)
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    // Iterative quality check: start at initialQuality (0.85)
    // Step down to minQuality (0.65) if file is still above target size.
    let currentQuality = opts.initialQuality;
    let blob = await canvasToBlob(canvas, opts.outputType, currentQuality);

    if (!blob) {
      throw new Error("Failed to encode canvas to image blob");
    }

    // If still larger than target size (300KB), test lower quality down to minQuality
    if (blob.size > opts.targetSizeBytes && currentQuality > opts.minQuality) {
      const stepDownQuality = Math.max(opts.minQuality, currentQuality - 0.12);
      const smallerBlob = await canvasToBlob(canvas, opts.outputType, stepDownQuality);
      if (smallerBlob) {
        blob = smallerBlob;
        currentQuality = stepDownQuality;
      }
    }

    // If still larger than target, try one last step at minQuality
    if (blob.size > opts.targetSizeBytes && currentQuality > opts.minQuality) {
      const minBlob = await canvasToBlob(canvas, opts.outputType, opts.minQuality);
      if (minBlob) {
        blob = minBlob;
      }
    }

    // If the compressed blob is larger than original file, return original
    if (blob.size >= file.size && isJpegOrWebp) {
      return {
        blob: file,
        sizeBytes: file.size,
        width,
        height,
        wasCompressed: false,
        mediaType: file.type,
      };
    }

    return {
      blob,
      sizeBytes: blob.size,
      width,
      height,
      wasCompressed: true,
      mediaType: opts.outputType,
    };
  } catch (error) {
    // If canvas fails (e.g. out of memory on ultra-large photo or unsupported format),
    // fallback gracefully to original file if below the 1MB backend limit
    if (file.size <= opts.maxSizeBytes) {
      return {
        blob: file,
        sizeBytes: file.size,
        width: 0,
        height: 0,
        wasCompressed: false,
        mediaType: file.type || "image/jpeg",
      };
    }
    throw new Error(
      `Image compression failed and photo size (${Math.round(file.size / 1024)} KB) exceeds limit: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

