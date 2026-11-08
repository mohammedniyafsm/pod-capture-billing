import { describe, expect, it } from "vitest";
import { formatCsv, parseCsv } from "./csv";

describe("CSV helpers", () => {
  it("parses escaped quotes, commas, and newlines in quoted cells", () => {
    expect(parseCsv('name,note\r\n"ACME, Inc.","said ""hello""\nagain"\r\n')).toEqual([
      ["name", "note"],
      ["ACME, Inc.", 'said "hello"\nagain'],
    ]);
  });

  it("formats Tally fields using CSV escaping", () => {
    expect(
      formatCsv([
        ["Date", "Narration"],
        ["2026-11-03", 'Goods, "delivered"'],
      ]),
    ).toBe('Date,Narration\r\n2026-11-03,"Goods, ""delivered"""');
  });

  it("rejects unterminated quoted cells", () => {
    expect(() => parseCsv('tripCode,origin\nT-1,"Pune')).toThrow(
      "unterminated quoted field",
    );
  });
});
