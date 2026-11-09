import fs from "fs";
import path from "path";
import { FIXED_CLIPS, FixedClipKey, VoiceLanguage } from "../src/lib/voice/hybrid";
import { synthesizeTtsAudio, hashPromptText } from "../src/lib/voice/tts";

const LANGUAGES: VoiceLanguage[] = ["Hindi", "Marathi", "English"];

interface ManifestEntry {
  text: string;
  hash: string;
  path: string;
  updatedAt: string;
}

async function main() {
  console.log("Generating fixed voice prompt clips for Hybrid Voice system...");

  const baseDir = path.join(process.cwd(), "public", "voice");
  const manifestPath = path.join(baseDir, "manifest.json");

  // Ensure directories exist
  for (const lang of LANGUAGES) {
    fs.mkdirSync(path.join(baseDir, lang.toLowerCase()), { recursive: true });
  }

  // Remove legacy trips dir if it exists
  const tripsDir = path.join(baseDir, "trips");
  if (fs.existsSync(tripsDir)) {
    console.log("Cleaning up legacy per-trip audio directory...");
    fs.rmSync(tripsDir, { recursive: true, force: true });
  }

  let manifest: Record<string, ManifestEntry> = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }

  // Remove any legacy trip keys from manifest
  for (const key of Object.keys(manifest)) {
    if (key.startsWith("voice/trips/")) {
      delete manifest[key];
    }
  }

  let generatedCount = 0;
  let skippedCount = 0;

  const clipKeys = Object.keys(FIXED_CLIPS) as FixedClipKey[];

  for (const key of clipKeys) {
    for (const lang of LANGUAGES) {
      const text = FIXED_CLIPS[key][lang];
      const hash = hashPromptText(text);
      const relPath = `voice/${lang.toLowerCase()}/${key}.mp3`;
      const fullPath = path.join(process.cwd(), "public", relPath);

      if (fs.existsSync(fullPath) && manifest[relPath]?.hash === hash) {
        skippedCount++;
        continue;
      }

      console.log(`[Clip] Synthesizing ${lang} -> ${key}...`);
      try {
        const audioBuf = await synthesizeTtsAudio(text, { lang });
        fs.writeFileSync(fullPath, audioBuf);
        manifest[relPath] = {
          text,
          hash,
          path: `/${relPath}`,
          updatedAt: new Date().toISOString(),
        };
        generatedCount++;
      } catch (err) {
        console.error(`Failed to generate ${relPath}:`, err);
      }
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(
    `\nFixed clips generation complete! Generated: ${generatedCount}, Cached/Skipped: ${skippedCount}`
  );
}

main().catch((err) => {
  console.error("Fixed voice generation failed:", err);
  process.exit(1);
});
