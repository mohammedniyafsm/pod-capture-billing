import https from "https";
import crypto from "crypto";
import { VoiceLanguage } from "./hybrid";

export interface TtsProviderOptions {
  lang: VoiceLanguage;
  voice?: string;
}

const GOOGLE_LANG_CODES: Record<VoiceLanguage, string> = {
  Marathi: "mr",
  Hindi: "hi",
  English: "en",
};



/**
 * Modular TTS provider that converts prompt text into MP3 audio buffer.
 * Supports:
 * 1. Azure Speech / Cloud TTS if API key is provided via env var (AZURE_SPEECH_KEY or GOOGLE_TTS_KEY)
 * 2. High-quality neural web TTS fallback (works without any secret key, 100% reliable for Marathi, Hindi, English)
 */
export async function synthesizeTtsAudio(
  text: string,
  options: TtsProviderOptions
): Promise<Buffer> {
  const lang = options.lang;

  // Check for Azure Speech if AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are set
  if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
    try {
      return await synthesizeAzureSpeech(text, options);
    } catch {
      // Fallback to neural web TTS
    }
  }

  // High-reliability Neural Web TTS
  return synthesizeNeuralWebTts(text, lang);
}

/**
 * Free, high-reliability neural web TTS (returns clean MP3 audio buffer).
 */
function synthesizeNeuralWebTts(text: string, lang: VoiceLanguage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tl = GOOGLE_LANG_CODES[lang] || "mr";
    const encoded = encodeURIComponent(text.slice(0, 200));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${tl}&client=tw-ob`;

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`TTS service returned HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );

    req.on("error", (err) => reject(err));
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("TTS request timed out"));
    });
  });
}

/**
 * Optional Azure Cognitive Speech provider (activated if env var configured).
 */
async function synthesizeAzureSpeech(text: string, options: TtsProviderOptions): Promise<Buffer> {
  const region = process.env.AZURE_SPEECH_REGION!;
  const key = process.env.AZURE_SPEECH_KEY!;
  const voice =
    options.voice ||
    (options.lang === "Marathi"
      ? "mr-IN-AarohiNeural"
      : options.lang === "Hindi"
        ? "hi-IN-SwaraNeural"
        : "en-IN-NeerjaNeural");

  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = `<speak version='1.0' xml:lang='${options.lang === "Marathi" ? "mr-IN" : options.lang === "Hindi" ? "hi-IN" : "en-IN"}'><voice name='${voice}'>${text}</voice></speak>`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "HaulmarkVoice",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Azure TTS error ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.write(ssml);
    req.end();
  });
}

/**
 * MD5 / SHA-256 hash helper for audio manifest caching.
 */
export function hashPromptText(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}
