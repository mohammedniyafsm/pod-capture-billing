import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractPod,
  type PodExtractionData,
} from "./extractPod";

const input = {
  imageBytes: new Uint8Array([1, 2, 3]),
  imageFilename: "good.jpg",
  mediaType: "image/jpeg" as const,
  correlationId: "00000000-0000-4000-8000-000000000001",
  expectedLrNumber: "LR-B-20481",
  expectedGoodsDescription: "Cement",
  expectedQuantity: 100,
  expectedQuantityUnit: "tons",
  recordedDeliveryDate: "2026-11-04",
};

const validExtraction: PodExtractionData = {
  image_quality: { readable: true, blur: false, cropped: false },
  lr_number: { value: "LR-B-20481", confidence: 0.99 },
  consignee_stamp: { present: true, confidence: 0.98 },
  signature: { present: true, confidence: 0.97 },
  delivery_date: { value: "2026-11-03", confidence: 0.95 },
  quantity_received: { value: 100, unit: "tons", confidence: 0.96 },
  goods_description: { value: "Cement", confidence: 0.96 },
  remarks_text: "",
  has_shortage_or_damage_remark: false,
  retake_hint: null,
};

function geminiResponse(extraction: unknown, fenced = false): Response {
  const text = JSON.stringify(extraction);
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: fenced ? `\`\`\`json\n${text}\n\`\`\`` : text }],
          },
        },
      ],
    }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("extractPod mock mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["good.jpg", "LR-B-20481", true, false],
    ["blurry.jpg", null, false, false],
    ["no_stamp.jpg", "LR-B-20481", false, false],
    ["short6.jpg", "LR-B-20481", true, true],
    ["lr_wrong.jpg", "LR-X-00000", true, false],
  ] as const)(
    "returns deterministic extraction for %s",
    async (imageFilename, lrNumber, stampPresent, shortage) => {
      vi.stubEnv("AI_MODE", "mock");
      const result = await extractPod({ ...input, imageFilename });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.extraction.lr_number.value).toBe(lrNumber);
      expect(result.extraction.consignee_stamp.present).toBe(stampPresent);
      expect(result.extraction.has_shortage_or_damage_remark).toBe(shortage);
      expect(result.rawResponse).toMatchObject({
        mock: true,
        filename: imageFilename,
      });
    },
  );

  it("uses the supplied expected LR and rejects unknown mock filenames", async () => {
    vi.stubEnv("AI_MODE", "mock");
    const customized = await extractPod({
      ...input,
      expectedLrNumber: "LR-NEW-2",
    });
    expect(customized.ok && customized.extraction.lr_number.value).toBe(
      "LR-NEW-2",
    );

    await expect(
      extractPod({ ...input, imageFilename: "unlisted.jpg" }),
    ).resolves.toMatchObject({
      ok: false,
      aiFailed: true,
      reason: "unknown_mock_image",
    });
  });
});

describe("extractPod Gemini mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns failure without an API key", async () => {
    vi.stubEnv("AI_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(extractPod(input)).resolves.toMatchObject({
      ok: false,
      aiFailed: true,
      aiTimedOut: false,
      reason: "missing_api_key",
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("ai.configuration_error"),
    );
    log.mockRestore();
  });

  it("sends the compressed image and expected LR, strips fences, and retains raw JSON", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const rawResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: `\`\`\`json\n${JSON.stringify(validExtraction)}\n\`\`\`` },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(rawResponse)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await extractPod(input);

    expect(result).toMatchObject({
      ok: true,
      extraction: validExtraction,
      rawResponse,
      modelName: "gemini-3.5-flash-lite",
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("ai.request_succeeded"),
    );
    const responseLog = log.mock.calls
      .map((call) => String(call[0]))
      .find((entry) => entry.includes("ai.response_received"));
    expect(responseLog).toBeDefined();
    expect(responseLog).toContain("clientSubmissionId");
    expect(responseLog).toContain("gemini-3.5-flash-lite");
    expect(responseLog).toContain("httpStatus");
    expect(responseLog).toContain("responseBytes");
    expect(responseLog).toContain(JSON.stringify(validExtraction.lr_number.value));
    log.mockRestore();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(init?.headers).toMatchObject({
      "x-goog-api-key": "test-key",
    });
    const requestBody = JSON.parse(String(init?.body));
    expect(requestBody).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json",
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: expect.stringContaining('"lrNumber":"LR-B-20481"'),
            },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: "AQID",
              },
            },
          ],
        },
      ],
    });
  });

  it("retries an invalid extraction once and returns a failure after the second invalid response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse({ wrong: "shape" }))
      .mockResolvedValueOnce(geminiResponse({ wrong: "shape" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractPod(input)).resolves.toMatchObject({
      ok: false,
      aiFailed: true,
      aiTimedOut: false,
      reason: "invalid_response",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once after a 15-second timeout and reports failure", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.useFakeTimers();
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = extractPod(input);
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      aiFailed: true,
      aiTimedOut: true,
      reason: "request_failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveBeenCalledWith(
      expect.stringContaining("timeoutPhase"),
    );
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("timeoutPhase"),
    );
    expect(warnings.mock.calls[0][0]).toContain("clientSubmissionId");
    expect(warnings.mock.calls[0][0]).toContain("waiting_for_response_headers");
    warnings.mockRestore();
    errors.mockRestore();
  });

  it("logs network error cause codes without including the API key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed", {
        cause: { code: "ENOTFOUND", message: "provider unavailable" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(extractPod(input)).resolves.toMatchObject({
      ok: false,
      reason: "request_failed",
    });

    const errorLog = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(errorLog).toContain("ENOTFOUND");
    expect(errorLog).toContain("waiting_for_response_headers");
    expect(errorLog).not.toContain("test-key");
    log.mockRestore();
  });

  it("logs the Gemini API error for a non-success response without leaking the key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 404,
              status: "NOT_FOUND",
              message:
                "models/gemini-2.5-flash not found; test-key should stay secret",
            },
          }),
          { status: 404, statusText: "Not Found" },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(extractPod(input)).resolves.toMatchObject({
      ok: false,
      aiFailed: true,
      reason: "request_failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const errorLog = log.mock.calls
      .map((call) => String(call[0]))
      .find((entry) => entry.includes("ai.http_error"));
    expect(errorLog).toContain("apiErrorStatus");
    expect(errorLog).toContain("NOT_FOUND");
    expect(errorLog).toContain("models/gemini-2.5-flash not found");
    expect(errorLog).not.toContain("test-key");
    log.mockRestore();
  });
});
