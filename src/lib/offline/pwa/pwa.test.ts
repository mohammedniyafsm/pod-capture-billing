import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA Manifest & Service Worker security validation", () => {
  it("validates that manifest.json contains required PWA fields and safe paths", () => {
    const manifestPath = resolve(process.cwd(), "public/manifest.json");
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe("FleetProof");
    expect(manifest.short_name).toBe("FleetProof");
    expect(manifest.start_url).toBe("/driver");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons[0].src).toBe("/icon-192.svg");
    expect(manifest.icons[1].src).toBe("/icon-512.svg");
  });

  it("verifies service worker never caches sensitive API or auth endpoints", () => {
    const swPath = resolve(process.cwd(), "public/sw.js");
    const swCode = readFileSync(swPath, "utf-8");

    // Must explicitly ignore /api/ requests
    expect(swCode).toContain('url.pathname.startsWith("/api/")');
    // Must NOT cache POST/PUT/DELETE
    expect(swCode).toContain('event.request.method !== "GET"');
    // Must clean up obsolete caches
    expect(swCode).toContain("caches.delete");
    // Must contain cache version
    expect(swCode).toContain("fleetproof-shell-v");
  });
});

