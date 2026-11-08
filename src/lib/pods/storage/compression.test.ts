import { describe, expect, it } from "vitest";
import { calculateDimensions } from "./compression";

describe("calculateDimensions", () => {
  it("keeps dimensions within maxDimension intact", () => {
    const dims = calculateDimensions(1200, 800, 2048);
    expect(dims).toEqual({ width: 1200, height: 800 });
  });

  it("scales down landscape images exceeding maxDimension preserving aspect ratio", () => {
    const dims = calculateDimensions(4000, 3000, 2000);
    expect(dims.width).toBe(2000);
    expect(dims.height).toBe(1500);
  });

  it("scales down portrait images exceeding maxDimension preserving aspect ratio", () => {
    const dims = calculateDimensions(3000, 4000, 2000);
    expect(dims.width).toBe(1500);
    expect(dims.height).toBe(2000);
  });

  it("handles square images", () => {
    const dims = calculateDimensions(3000, 3000, 1500);
    expect(dims).toEqual({ width: 1500, height: 1500 });
  });

  it("handles boundary values safely", () => {
    expect(calculateDimensions(0, 0, 1000)).toEqual({ width: 1, height: 1 });
  });
});

