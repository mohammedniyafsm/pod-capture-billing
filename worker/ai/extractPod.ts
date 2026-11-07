import { z } from "zod";
import { logPodEvent, type PodLogLevel } from "./podLogger";

const confidenceSchema = z.number().min(0).max(1);

const extractionSchema = z
  .object({
    image_quality: z
      .object({
        readable: z.boolean(),
        blur: z.boolean(),
        cropped: z.boolean(),
      })
      .strict(),
    lr_number: z
      .object({
        value: z.string().nullable(),
        confidence: confidenceSchema,
      })
      .strict(),
    consignee_stamp: z
      .object({
        present: z.boolean(),
        confidence: confidenceSchema,
      })
      .strict(),
    signature: z
      .object({
        present: z.boolean(),
        confidence: confidenceSchema,
      })
      .strict(),
    delivery_date: z
      .object({
        value: z.string().nullable(),
        confidence: confidenceSchema,
      })
      .strict(),
    quantity_received: z
      .object({
        value: z.number().nonnegative().nullable(),
        unit: z.string().nullable(),
        confidence: confidenceSchema,
      })
      .strict(),
    goods_description: z
      .object({
        value: z.string().nullable(),
        confidence: confidenceSchema,
      })
      .strict(),
    remarks_text: z.string(),
    has_shortage_or_damage_remark: z.boolean(),
    retake_hint: z.string().nullable(),
  })
  .strict();

export type PodExtractionData = z.infer<typeof extractionSchema>;

export interface ExtractPodInput {
  imageBytes: Uint8Array;
  imageFilename: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  correlationId?: string;
  expectedLrNumber: string;
  expectedGoodsDescription: string;
  expectedQuantity: number;
  expectedQuantityUnit: string;
  recordedDeliveryDate: string | null;
}

export type ExtractPodResult =
  | {
      ok: true;
      extraction: PodExtractionData;
      rawResponse: unknown;
      modelName: string;
    }
  | {
      ok: false;
      aiFailed: true;
      aiTimedOut: boolean;
      reason: "missing_api_key" | "request_failed" | "invalid_response" | "unknown_mock_image";
      retryable?: boolean;
      rawResponse?: unknown;
    };

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

const systemPrompt = `You extract delivery evidence from proof-of-delivery (POD) images.
Return STRICT JSON only. Do not include markdown, code fences, or any text outside the JSON object.
The JSON must have exactly this shape:
{
  "image_quality": { "readable": boolean, "blur": boolean, "cropped": boolean },
  "lr_number": { "value": string or null, "confidence": number from 0 to 1 },
  "consignee_stamp": { "present": boolean, "confidence": number from 0 to 1 },
  "signature": { "present": boolean, "confidence": number from 0 to 1 },
  "delivery_date": { "value": string or null, "confidence": number from 0 to 1 },
  "quantity_received": { "value": number or null, "unit": string or null, "confidence": number from 0 to 1 },
  "goods_description": { "value": string or null, "confidence": number from 0 to 1 },
  "remarks_text": string,
  "has_shortage_or_damage_remark": boolean,
  "retake_hint": string or null
}
Use null when a value cannot be read. Confidence must reflect visual certainty, not plausibility.
Extract every value from the image. Expected trip information is context only: never copy or substitute an expected value for text that is absent or unreadable on the POD.
Extract the quantity unit as written; do not infer or convert units. Preserve the written goods description. Extract the delivery date written on the POD, not today's date or upload time.
Set has_shortage_or_damage_remark only for an affirmative shortage/damage statement. Negated statements such as "No damage observed" are not damage remarks.
Use retake_hint to briefly explain how to improve an unreadable, blurry, cropped, or incomplete image; otherwise use null.`;

const mockExtractions: Record<string, PodExtractionData> = {
  "good.jpg": {
    image_quality: { readable: true, blur: false, cropped: false },
    lr_number: { value: "EXPECTED_LR", confidence: 0.99 },
    consignee_stamp: { present: true, confidence: 0.98 },
    signature: { present: true, confidence: 0.97 },
    delivery_date: { value: "2026-11-03", confidence: 0.95 },
    quantity_received: {
      value: 600,
      unit: "cartons",
      confidence: 0.96,
    },
    goods_description: { value: "Packaged foods", confidence: 0.96 },
    remarks_text: "",
    has_shortage_or_damage_remark: false,
    retake_hint: null,
  },
  "blurry.jpg": {
    image_quality: { readable: false, blur: true, cropped: false },
    lr_number: { value: null, confidence: 0.2 },
    consignee_stamp: { present: false, confidence: 0.2 },
    signature: { present: false, confidence: 0.2 },
    delivery_date: { value: null, confidence: 0.2 },
    quantity_received: { value: null, unit: null, confidence: 0.2 },
    goods_description: { value: null, confidence: 0.2 },
    remarks_text: "",
    has_shortage_or_damage_remark: false,
    retake_hint: "Retake the photo steadily in focus.",
  },
  "no_stamp.jpg": {
    image_quality: { readable: true, blur: false, cropped: false },
    lr_number: { value: "EXPECTED_LR", confidence: 0.99 },
    consignee_stamp: { present: false, confidence: 0.98 },
    signature: { present: true, confidence: 0.97 },
    delivery_date: { value: "2026-11-03", confidence: 0.95 },
    quantity_received: {
      value: 600,
      unit: "cartons",
      confidence: 0.96,
    },
    goods_description: { value: "Packaged foods", confidence: 0.96 },
    remarks_text: "",
    has_shortage_or_damage_remark: false,
    retake_hint: "Include the consignee stamp in the photo.",
  },
  "short6.jpg": {
    image_quality: { readable: true, blur: false, cropped: false },
    lr_number: { value: "EXPECTED_LR", confidence: 0.99 },
    consignee_stamp: { present: true, confidence: 0.98 },
    signature: { present: true, confidence: 0.97 },
    delivery_date: { value: "2026-11-03", confidence: 0.95 },
    quantity_received: {
      value: 594,
      unit: "cartons",
      confidence: 0.96,
    },
    goods_description: { value: "Packaged foods", confidence: 0.96 },
    remarks_text: "Short by 6 cartons",
    has_shortage_or_damage_remark: true,
    retake_hint: null,
  },
  "lr_wrong.jpg": {
    image_quality: { readable: true, blur: false, cropped: false },
    lr_number: { value: "LR-X-00000", confidence: 0.99 },
    consignee_stamp: { present: true, confidence: 0.98 },
    signature: { present: true, confidence: 0.97 },
    delivery_date: { value: "2026-11-03", confidence: 0.95 },
    quantity_received: {
      value: 600,
      unit: "cartons",
      confidence: 0.96,
    },
    goods_description: { value: "Packaged foods", confidence: 0.96 },
    remarks_text: "",
    has_shortage_or_damage_remark: false,
    retake_hint: null,
  },
};

class InvalidResponseError extends Error {
  constructor(
    readonly rawResponse?: unknown,
    readonly stage: "response_envelope" | "json_parse" | "extraction_schema" = "json_parse",
    readonly issueCodes: string[] = [],
  ) {
    super("Gemini returned an invalid extraction response");
  }
}

function logAiEvent(
  level: PodLogLevel,
  details: Record<string, unknown>,
) {
  const { event, correlationId, ...context } = details;
  logPodEvent(
    `ai.${String(event ?? "event")}`,
    {
      clientSubmissionId: correlationId,
      ...context,
    },
    level,
  );
}

function getErrorDetails(error: unknown, apiKey: string) {
  if (error instanceof Error) {
    const cause =
      typeof error.cause === "object" && error.cause !== null
        ? error.cause
        : undefined;
    const causeCode =
      cause && "code" in cause && typeof cause.code === "string"
        ? cause.code.slice(0, 80)
        : undefined;
    return {
      errorType: error.name,
      errorMessage: error.message
        .replaceAll(apiKey, "[REDACTED]")
        .replace(/[\r\n\t]+/g, " ")
        .slice(0, 200),
      ...(causeCode ? { causeCode } : {}),
    };
  }
  return { errorType: "UnknownError" };
}

async function getGeminiApiError(
  response: Response,
  apiKey: string,
): Promise<{
  apiErrorCode?: number;
  apiErrorStatus?: string;
  apiErrorMessage?: string;
}> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return {};
  }

  const parsed = z
    .object({
      error: z
        .object({
          code: z.number().optional(),
          status: z.string().optional(),
          message: z.string().optional(),
        })
        .optional(),
    })
    .safeParse(body);
  if (!parsed.success || !parsed.data.error) return {};

  const { code, status, message } = parsed.data.error;
  const safeMessage = message
    ?.replaceAll(apiKey, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
  return {
    ...(code === undefined ? {} : { apiErrorCode: code }),
    ...(status === undefined ? {} : { apiErrorStatus: status }),
    ...(safeMessage === undefined ? {} : { apiErrorMessage: safeMessage }),
  };
}

function getFilename(filename: string): string {
  return filename.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
}

function parseFencedJson(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    throw new InvalidResponseError();
  }
}

function parseGeminiResponse(rawResponse: unknown): PodExtractionData {
  const response = z
    .object({
      candidates: z
        .array(
          z.object({
            content: z.object({
              parts: z.array(z.object({ text: z.string() })),
            }),
          }),
        )
        .min(1),
    })
    .safeParse(rawResponse);
  if (!response.success) {
    throw new InvalidResponseError(
      rawResponse,
      "response_envelope",
      response.error.issues.map((issue) => issue.code),
    );
  }

  const text = response.data.candidates[0].content.parts
    .map((part) => part.text)
    .join("\n");
  let parsed: unknown;
  try {
    parsed = parseFencedJson(text);
  } catch {
    throw new InvalidResponseError(rawResponse, "json_parse");
  }

  const extraction = extractionSchema.safeParse(parsed);
  if (!extraction.success) {
    throw new InvalidResponseError(
      rawResponse,
      "extraction_schema",
      extraction.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`),
    );
  }
  return extraction.data;
}

function resolveMock(
  input: ExtractPodInput,
): ExtractPodResult {
  const filename = getFilename(input.imageFilename);
  const mock = mockExtractions[filename];
  if (!mock) {
    return {
      ok: false,
      aiFailed: true,
      aiTimedOut: false,
      reason: "unknown_mock_image",
    };
  }
  const extraction = structuredClone(mock);
  if (extraction.lr_number.value === "EXPECTED_LR") {
    extraction.lr_number.value = input.expectedLrNumber;
  }
  if (filename === "good.jpg" || filename === "no_stamp.jpg" || filename === "lr_wrong.jpg") {
    extraction.quantity_received.value = input.expectedQuantity;
    extraction.quantity_received.unit = input.expectedQuantityUnit;
    extraction.goods_description.value = input.expectedGoodsDescription;
  }
  if (filename !== "blurry.jpg") {
    extraction.delivery_date.value =
      input.recordedDeliveryDate ??
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      );
  }
  return {
    ok: true,
    extraction,
    rawResponse: { mock: true, filename, extraction },
    modelName: "mock",
  };
}

export async function extractPod(
  input: ExtractPodInput,
): Promise<ExtractPodResult> {
  if (process.env.AI_MODE === "mock") return resolveMock(input);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logAiEvent("error", {
      event: "configuration_error",
      correlationId: input.correlationId,
      reason: "missing_api_key",
      aiMode: process.env.AI_MODE || "gemini",
    });
    return {
      ok: false,
      aiFailed: true,
      aiTimedOut: false,
      reason: "missing_api_key",
    };
  }

  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const apiUrl = `${API_URL}/${encodeURIComponent(modelName)}:generateContent`;
  let lastRawResponse: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    let responseHeadersAt: number | undefined;
    let requestPhase:
      | "waiting_for_response_headers"
      | "reading_response_body" = "waiting_for_response_headers";
    logAiEvent("info", {
      event: "request_started",
      correlationId: input.correlationId,
      modelName,
      attempt: attempt + 1,
      maxAttempts: MAX_ATTEMPTS,
      imageBytes: input.imageBytes.byteLength,
      mediaType: input.mediaType,
      timeoutMs: REQUEST_TIMEOUT_MS,
      phase: requestPhase,
    });
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          generationConfig: {
            maxOutputTokens: 1200,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Expected trip context (use only to identify fields; extract values from the image and never substitute missing text): ${JSON.stringify({
                    lrNumber: input.expectedLrNumber,
                    goodsDescription: input.expectedGoodsDescription,
                    quantity: input.expectedQuantity,
                    quantityUnit: input.expectedQuantityUnit,
                    recordedDeliveryDate: input.recordedDeliveryDate,
                  })}`,
                },
                {
                  inlineData: {
                    mimeType: input.mediaType,
                    data: Buffer.from(input.imageBytes).toString("base64"),
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      responseHeadersAt = Date.now();
      requestPhase = "reading_response_body";
      if (!response.ok) {
        const apiError = await getGeminiApiError(response, apiKey);
        logAiEvent("error", {
          event: "http_error",
          correlationId: input.correlationId,
          modelName,
          attempt: attempt + 1,
          httpStatus: response.status,
          httpStatusText: response.statusText,
          providerRequestId:
            response.headers.get("x-goog-request-id") ??
            response.headers.get("x-request-id") ??
            undefined,
          durationMs: Date.now() - startedAt,
          reason: "request_failed",
          ...apiError,
        });
        return {
          ok: false,
          aiFailed: true,
          aiTimedOut: false,
          reason: "request_failed",
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        };
      }

      let responseText: string;
      try {
        responseText = await response.text();
      } catch {
        throw new InvalidResponseError(undefined, "json_parse");
      }
      const responseBodyReceivedAt = Date.now();
      let rawResponse: unknown;
      try {
        rawResponse = JSON.parse(responseText);
      } catch {
        throw new InvalidResponseError(undefined, "json_parse");
      }
      lastRawResponse = rawResponse;
      const extraction = parseGeminiResponse(rawResponse);
      if (process.env.NODE_ENV !== "production") {
        logAiEvent("info", {
          event: "response_received",
          correlationId: input.correlationId,
          modelName,
          attempt: attempt + 1,
          httpStatus: response.status,
          providerRequestId:
            response.headers.get("x-goog-request-id") ??
            response.headers.get("x-request-id") ??
            undefined,
          timeToHeadersMs: responseHeadersAt - startedAt,
          bodyReadMs: responseBodyReceivedAt - responseHeadersAt,
          responseBytes: Buffer.byteLength(responseText),
          extraction,
        });
      }
      logAiEvent("info", {
        event: "request_succeeded",
        correlationId: input.correlationId,
        modelName,
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
      });
      return { ok: true, extraction, rawResponse, modelName };
    } catch (error) {
      if (timedOut) {
        logAiEvent(attempt + 1 === MAX_ATTEMPTS ? "error" : "warn", {
          event: attempt + 1 === MAX_ATTEMPTS ? "request_failed" : "request_retry",
          correlationId: input.correlationId,
          modelName,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          durationMs: Date.now() - startedAt,
          reason: "timeout",
          timedOut: true,
          timeoutPhase: requestPhase,
        });
        if (attempt + 1 === MAX_ATTEMPTS) {
          return {
            ok: false,
            aiFailed: true,
            aiTimedOut: true,
            reason: "request_failed",
            retryable: true,
            ...(lastRawResponse === undefined
              ? {}
              : { rawResponse: lastRawResponse }),
          };
        }
        continue;
      }

      if (error instanceof InvalidResponseError) {
        lastRawResponse = error.rawResponse ?? lastRawResponse;
        logAiEvent(attempt + 1 === MAX_ATTEMPTS ? "error" : "warn", {
          event: attempt + 1 === MAX_ATTEMPTS ? "request_failed" : "request_retry",
          correlationId: input.correlationId,
          modelName,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          durationMs: Date.now() - startedAt,
          reason: "invalid_response",
          timedOut: false,
          responseStage: error.stage,
          ...(error.issueCodes.length
            ? { validationIssues: error.issueCodes.slice(0, 12).join(",") }
            : {}),
        });
        if (attempt + 1 < MAX_ATTEMPTS) continue;
        return {
          ok: false,
          aiFailed: true,
          aiTimedOut: false,
          reason: "invalid_response",
          retryable: true,
          ...(lastRawResponse === undefined
            ? {}
            : { rawResponse: lastRawResponse }),
        };
      }

      logAiEvent("error", {
        event: "request_failed",
        correlationId: input.correlationId,
        modelName,
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        reason: "request_failed",
        phase: requestPhase,
        ...getErrorDetails(error, apiKey),
      });
      return {
        ok: false,
        aiFailed: true,
        aiTimedOut: false,
        reason: "request_failed",
        retryable: true,
        ...(lastRawResponse === undefined
          ? {}
          : { rawResponse: lastRawResponse }),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    ok: false,
    aiFailed: true,
    aiTimedOut: false,
    reason: "request_failed",
    ...(lastRawResponse === undefined
      ? {}
      : { rawResponse: lastRawResponse }),
  };
}
