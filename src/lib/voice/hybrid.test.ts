import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildSegments,
  sanitize,
  spellPlate,
  resolveRetakeClipKey,
  FIXED_CLIPS,
  FixedClipKey,
  VoiceLanguage,
} from "./hybrid";
import { HybridSegmentPlayer } from "./player";

describe("Hybrid Voice System", () => {
  describe("sanitize()", () => {
    it("strips unsafe characters and trims whitespace", () => {
      expect(sanitize("  Pune @#$ <Indore> & Co ")).toBe("Pune Indore & Co");
    });

    it("collapses multiple consecutive spaces", () => {
      expect(sanitize("Cement   Bags   Grade-A")).toBe("Cement Bags Grade-A");
    });

    it("caps output length at 80 characters", () => {
      const longText = "A".repeat(120);
      expect(sanitize(longText)).toHaveLength(80);
    });

    it("handles null and undefined gracefully", () => {
      expect(sanitize(null)).toBe("");
      expect(sanitize(undefined)).toBe("");
    });
  });

  describe("spellPlate()", () => {
    it("spells out plate letters and digits with comma separation between groups", () => {
      expect(spellPlate("MH31 BN 1128")).toBe("M H 3 1, B N, 1 1 2 8");
    });

    it("strips '(hired)' suffix case-insensitively and handles lowercase/hyphens", () => {
      expect(spellPlate("mh-12 kr 8202 (hired)")).toBe("M H, 1 2, K R, 8 2 0 2");
      expect(spellPlate("MH20FN6101 (HIRED)")).toBe("M H 2 0 F N 6 1 0 1");
    });

    it("handles null and empty input safely", () => {
      expect(spellPlate(null)).toBe("");
      expect(spellPlate("")).toBe("");
    });
  });

  describe("resolveRetakeClipKey()", () => {
    it("maps known reason codes to exact clip keys", () => {
      expect(resolveRetakeClipKey("stamp_not_visible")).toBe("stamp_not_visible");
      expect(resolveRetakeClipKey("signature_missing")).toBe("signature_missing");
      expect(resolveRetakeClipKey("blurry")).toBe("blurry");
      expect(resolveRetakeClipKey("lr_not_visible")).toBe("lr_unreadable");
      expect(resolveRetakeClipKey("lr_mismatch")).toBe("lr_unreadable");
      expect(resolveRetakeClipKey("date_missing")).toBe("date_missing");
      expect(resolveRetakeClipKey("cropped")).toBe("cut_off");
    });

    it("falls back to unclear_photo for unknown or missing reason codes", () => {
      expect(resolveRetakeClipKey("unknown_code")).toBe("unclear_photo");
      expect(resolveRetakeClipKey(null)).toBe("unclear_photo");
      expect(resolveRetakeClipKey(undefined)).toBe("unclear_photo");
    });
  });

  describe("buildSegments() across all statuses and languages", () => {
    const mockTrip = {
      tripCode: "TEST-100",
      origin: "Pune",
      destination: "Indore",
      vehicleNo: "MH12 AB 2201",
      client: { name: "Sahyadri Cements Ltd" },
      goodsDescription: "Portland Cement",
      expectedQuantity: "22",
      quantityUnit: "tonnes",
      status: "ASSIGNED",
    };

    const statuses = [
      "ASSIGNED",
      "IN_TRANSIT",
      "POD_PENDING",
      "RETAKE_REQUESTED",
      "NEEDS_REVIEW",
      "VERIFIED",
    ];

    const languages: VoiceLanguage[] = ["Hindi", "Marathi", "English"];

    it("returns non-empty segment list for every status and language", () => {
      for (const status of statuses) {
        for (const lang of languages) {
          const segments = buildSegments({ ...mockTrip, status }, status, lang);
          expect(segments.length).toBeGreaterThan(0);
        }
      }
    });

    it("includes dynamic values in say segments for ASSIGNED status", () => {
      for (const lang of languages) {
        const segments = buildSegments(mockTrip, "ASSIGNED", lang);
        const sayTexts = segments
          .filter((s) => s.type === "say")
          .map((s) => (s as { type: "say"; text: string }).text);

        expect(sayTexts).toContain("Pune");
        expect(sayTexts).toContain("Indore");
        expect(sayTexts).toContain("Portland Cement");
        expect(sayTexts).toContain("Sahyadri Cements Ltd");
        expect(sayTexts).toContain("M H 1 2, A B, 2 2 0 1");
      }
    });

    it("formats retake segments with reason clip and attempt numbers", () => {
      const retakeTrip = {
        ...mockTrip,
        status: "RETAKE_REQUESTED",
        retakeReason: "stamp_not_visible",
        retakeCount: 0,
      };

      const segments = buildSegments(retakeTrip, "RETAKE_REQUESTED", "Marathi");
      const clipKeys = segments
        .filter((s) => s.type === "clip")
        .map((s) => (s as { type: "clip"; key: FixedClipKey }).key);

      expect(clipKeys).toContain("take_photo_again");
      expect(clipKeys).toContain("reason_is");
      expect(clipKeys).toContain("stamp_not_visible");
      expect(clipKeys).toContain("retake_number");
      expect(clipKeys).toContain("one");
      expect(clipKeys).toContain("of");
      expect(clipKeys).toContain("two");
    });
  });

  describe("Fixed Clip Files Existence in /public/voice/", () => {
    it("ensures every fixed clip key exists as an MP3 file for all 3 languages", () => {
      const languages: VoiceLanguage[] = ["Hindi", "Marathi", "English"];
      const keys = Object.keys(FIXED_CLIPS) as FixedClipKey[];

      for (const lang of languages) {
        for (const key of keys) {
          const filePath = path.join(
            process.cwd(),
            "public",
            "voice",
            lang.toLowerCase(),
            `${key}.mp3`
          );
          expect(
            fs.existsSync(filePath),
            `Missing audio clip: /voice/${lang.toLowerCase()}/${key}.mp3`
          ).toBe(true);
        }
      }
    });
  });

  describe("HybridSegmentPlayer execution and fallbacks", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("can be cancelled cleanly during playback", async () => {
      const player = new HybridSegmentPlayer();
      const onEnd = vi.fn();

      // Start playing
      const promise = player.playSegments(
        [
          { type: "clip", key: "your_route" },
          { type: "say", text: "Pune" },
        ],
        "Hindi",
        { onEnd }
      );

      // Immediately cancel
      player.cancel();
      await promise;

      expect(onEnd).not.toHaveBeenCalled();
    });
  });
});
