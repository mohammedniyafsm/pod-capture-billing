import { PromptSegment, VoiceLanguage, FixedClipKey, FIXED_CLIPS } from "./hybrid";

export interface SegmentPlayerOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (errorMessage: string) => void;
}

/**
 * Sequential player for Hybrid prompts:
 * 1. For { type: "clip" }: plays pre-cached MP3 via HTMLAudioElement.
 *    If loading/playing fails: falls back to speechSynthesis with Hindi/Marathi/English text.
 * 2. For { type: "say" }: speaks on-device using SpeechSynthesis (en-IN, rate 0.85).
 *    If no English voice is available, aborts and invokes onError.
 * 3. Supports cancel() to cleanly abort in-flight playback immediately.
 */
export class HybridSegmentPlayer {
  private isCancelled = false;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  cancel() {
    this.isCancelled = true;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
  }

  async playSegments(
    segments: PromptSegment[],
    lang: VoiceLanguage,
    options: SegmentPlayerOptions = {}
  ): Promise<void> {
    this.cancel();
    this.isCancelled = false;

    if (segments.length === 0) {
      options.onEnd?.();
      return;
    }

    options.onStart?.();

    try {
      for (const segment of segments) {
        if (this.isCancelled) return;

        if (segment.type === "clip") {
          await this.playClipWithFallback(segment.key, lang);
        } else if (segment.type === "say") {
          await this.speakEnglishSegment(segment.text);
        }
      }

      if (!this.isCancelled) {
        options.onEnd?.();
      }
    } catch (err) {
      if (!this.isCancelled) {
        const msg = err instanceof Error ? err.message : "Voice playback failed";
        options.onError?.(msg);
      }
    } finally {
      this.currentAudio = null;
      this.currentUtterance = null;
    }
  }

  private async playClipWithFallback(key: FixedClipKey, lang: VoiceLanguage): Promise<void> {
    const audioUrl = `/voice/${lang.toLowerCase()}/${key}.mp3`;

    try {
      await this.playAudioUrl(audioUrl);
    } catch {
      // Fallback: speak that phrase's text with speechSynthesis (hi-IN for Hindi/Marathi)
      if (this.isCancelled) return;
      const fallbackText = FIXED_CLIPS[key]?.[lang];
      if (fallbackText) {
        await this.speakFallbackPhrase(fallbackText, lang);
      }
    }
  }

  private playAudioUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isCancelled) {
        resolve();
        return;
      }

      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.onended = () => {
        this.currentAudio = null;
        resolve();
      };

      audio.onerror = () => {
        this.currentAudio = null;
        reject(new Error(`Failed to load audio clip: ${url}`));
      };

      audio.play().catch((err) => {
        this.currentAudio = null;
        reject(err);
      });
    });
  }

  private speakEnglishSegment(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isCancelled) {
        resolve();
        return;
      }

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        reject(new Error("Voice is not available on this phone. Please read the text."));
        return;
      }

      const synth = window.speechSynthesis;
      const voices = synth.getVoices();

      // Look for English voices: prefer en-IN, then any en-*
      let selectedVoice = voices.find((v) => v.lang.toLowerCase() === "en-in");
      if (!selectedVoice) {
        selectedVoice = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
      }

      // If no English voice exists at all, reject to display visible message
      if (!selectedVoice && voices.length > 0 && !voices.some(v => v.lang.toLowerCase().includes("en"))) {
        reject(new Error("Voice is not available on this phone. Please read the text."));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
      } else {
        utterance.lang = "en-IN";
      }
      utterance.rate = 0.85;

      this.currentUtterance = utterance;

      utterance.onend = () => {
        this.currentUtterance = null;
        resolve();
      };

      utterance.onerror = () => {
        this.currentUtterance = null;
        reject(new Error("Voice is not available on this phone. Please read the text."));
      };

      synth.speak(utterance);
    });
  }

  private speakFallbackPhrase(text: string, lang: VoiceLanguage): Promise<void> {
    return new Promise((resolve) => {
      if (this.isCancelled || typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve();
        return;
      }

      const synth = window.speechSynthesis;
      const voices = synth.getVoices();
      const targetLang = lang === "English" ? "en-IN" : "hi-IN";

      const voice = voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)));

      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = targetLang;
      }
      utterance.rate = 0.88;

      this.currentUtterance = utterance;

      utterance.onend = () => {
        this.currentUtterance = null;
        resolve();
      };

      utterance.onerror = () => {
        this.currentUtterance = null;
        resolve();
      };

      synth.speak(utterance);
    });
  }
}
