import { describe, expect, it } from "vitest";
import {
  decideVerdict,
  type VerdictExtraction,
  type VerdictTrip,
} from "./verdict";

const trip: VerdictTrip = {
  lrNumber: "LR-B-20481",
  expectedQuantity: 100,
  quantityUnit: "tons",
  goodsDescription: "Cement",
  deliveredAt: new Date("2026-11-04T10:00:00.000Z"),
};
const now = new Date("2026-11-05T04:00:00.000Z");

function extraction(
  fields: Partial<NonNullable<VerdictExtraction["fields"]>> = {},
  confidences: Partial<NonNullable<VerdictExtraction["confidences"]>> = {},
): VerdictExtraction {
  return {
    fields: {
      lr_number: "LR-B-20481",
      consignee_stamp_present: true,
      signature_present: true,
      remarks_text: "",
      has_shortage_or_damage_remark: false,
      image_readable: true,
      blurry: false,
      cropped: false,
      quantity_received: 100,
      quantity_unit: "tons",
      goods_description: "Cement",
      delivery_date: "2026-11-04",
      ...fields,
    },
    confidences: {
      lr_number: 0.99,
      consignee_stamp: 0.98,
      signature: 0.97,
      quantity_received: 0.96,
      goods_description: 0.96,
      delivery_date: 0.95,
      ...confidences,
    },
  };
}

describe("decideVerdict", () => {
  it("verifies matching LR, quantity, unit, goods, date, stamp, signature, and remarks", () => {
    expect(decideVerdict(extraction(), trip, 0, { now })).toEqual({
      verdict: "VERIFIED",
      reasons: [],
    });
  });

  it.each([
    ["failed AI call", { aiFailed: true } satisfies VerdictExtraction],
    ["timed-out AI call", { aiTimedOut: true } satisfies VerdictExtraction],
  ])("returns REVIEW for an %s", (_name, input) => {
    expect(decideVerdict(input, trip, 0, { now })).toEqual({
      verdict: "REVIEW",
      reasons: ["ai_unavailable"],
    });
  });

  it("returns REVIEW when there is no extraction", () => {
    expect(decideVerdict(null, trip, 0, { now })).toEqual({
      verdict: "REVIEW",
      reasons: ["ai_unavailable"],
    });
  });

  it.each([
    ["unreadable image", { image_readable: false }, "blurry"],
    ["blurry image", { blurry: true }, "blurry"],
    ["cropped image", { cropped: true }, "cropped"],
    ["missing stamp", { consignee_stamp_present: false }, "stamp_not_visible"],
    ["missing signature", { signature_present: false }, "signature_missing"],
    ["missing LR number", { lr_number: "" }, "lr_not_visible"],
  ] as const)("requests a retake for a %s", (_name, fields, reason) => {
    expect(decideVerdict(extraction(fields), trip, 0, { now })).toMatchObject({
      verdict: "RETAKE",
      retakeReason: reason,
    });
  });

  it("does not allow a third retake", () => {
    expect(
      decideVerdict(extraction({ quantity_received: null }), trip, 2, { now }),
    ).toEqual({ verdict: "REVIEW", reasons: ["retake_limit"] });
  });

  it("requests a retake for unreadable quantity while attempts remain", () => {
    expect(
      decideVerdict(extraction({ quantity_received: null }), trip, 1, { now }),
    ).toEqual({
      verdict: "RETAKE",
      reasons: ["quantity_unreadable"],
      retakeReason: "quantity_unreadable",
    });
  });

  it("normalizes LR case, spaces, and hyphens", () => {
    expect(
      decideVerdict(extraction({ lr_number: " lr - b - 20481 " }), trip, 0, {
        now,
      }),
    ).toEqual({ verdict: "VERIFIED", reasons: [] });
  });

  it.each([
    {
      name: "requests retake for LR mismatch while attempts remain",
      count: 1,
      expected: {
        verdict: "RETAKE",
        reasons: ["lr_mismatch"],
        retakeReason: "lr_mismatch",
      },
    },
    {
      name: "reviews LR mismatch after the retake limit",
      count: 2,
      expected: { verdict: "REVIEW", reasons: ["lr_mismatch"] },
    },
  ])("$name", ({ count, expected }) => {
    expect(
      decideVerdict(extraction({ lr_number: "LR-X-00000" }), trip, count, {
        now,
      }),
    ).toEqual(expected);
  });

  it.each([
    ["quantity mismatch", { quantity_received: 94 }, ["quantity_mismatch"]],
    ["unit mismatch", { quantity_unit: "bags" }, ["quantity_unit_mismatch"]],
    ["unreadable unit", { quantity_unit: null }, ["quantity_unit_unreadable"]],
    ["product mismatch", { goods_description: "Steel rods" }, ["goods_mismatch"]],
    ["unreadable product", { goods_description: null }, ["goods_unreadable"]],
    [
      "delivery date mismatch",
      { delivery_date: "2026-11-03" },
      ["delivery_date_mismatch"],
    ],
    [
      "unreadable delivery date",
      { delivery_date: null },
      ["delivery_date_unreadable"],
    ],
    [
      "invalid delivery date",
      { delivery_date: "2026-02-30" },
      ["delivery_date_invalid"],
    ],
    [
      "future delivery date",
      { delivery_date: "2026-11-06" },
      ["delivery_date_invalid"],
    ],
  ] as const)("routes %s to REVIEW", (_name, fields, reasons) => {
    expect(decideVerdict(extraction(fields), trip, 0, { now })).toEqual({
      verdict: "REVIEW",
      reasons,
    });
  });

  it("does not compare extracted delivery date when no authoritative date exists", () => {
    expect(
      decideVerdict(
        extraction({ delivery_date: "2026-11-03" }),
        { ...trip, deliveredAt: null },
        0,
        { now },
      ),
    ).toEqual({ verdict: "VERIFIED", reasons: [] });
  });

  it.each([
    ["shortage remark", "Short by 6 cartons", ["shortage_remark"]],
    ["damage remark", "Goods damaged in transit", ["damage"]],
    [
      "both remarks",
      "Short by 6 cartons; goods damaged",
      ["shortage_remark", "damage"],
    ],
  ])("routes a %s to REVIEW", (_name, remarks, reasons) => {
    expect(
      decideVerdict(
        extraction({ remarks_text: remarks }),
        trip,
        0,
        { now },
      ),
    ).toEqual({ verdict: "REVIEW", reasons });
  });

  it("routes an affirmative shortage to REVIEW even when other fields need a retake", () => {
    expect(
      decideVerdict(
        extraction({
          remarks_text: "Short by 6 cartons",
          has_shortage_or_damage_remark: true,
          quantity_received: null,
          consignee_stamp_present: false,
        }),
        trip,
        0,
        { now },
      ),
    ).toEqual({ verdict: "REVIEW", reasons: ["shortage_remark"] });
  });

  it.each(["No damage observed", "No shortage; goods not damaged"])(
    "does not flag negated remarks: %s",
    (remarks) => {
      expect(
        decideVerdict(
          extraction({
            remarks_text: remarks,
            has_shortage_or_damage_remark: true,
          }),
          trip,
          0,
          { now },
        ),
      ).toEqual({ verdict: "VERIFIED", reasons: [] });
    },
  );

  it("treats descriptive formatting variations in goods as a match", () => {
    expect(
      decideVerdict(
        extraction({ goods_description: "CEMENT bags" }),
        trip,
        0,
        { now },
      ),
    ).toEqual({ verdict: "VERIFIED", reasons: [] });
  });

  it("reviews confidence below threshold and accepts exactly 0.85", () => {
    expect(
      decideVerdict(
        extraction({}, { quantity_received: 0.84 }),
        trip,
        0,
        { now },
      ),
    ).toEqual({ verdict: "REVIEW", reasons: ["low_confidence"] });
    expect(
      decideVerdict(
        extraction(
          {},
          {
            lr_number: 0.85,
            consignee_stamp: 0.85,
            signature: 0.85,
            quantity_received: 0.85,
            goods_description: 0.85,
            delivery_date: 0.85,
          },
        ),
        trip,
        0,
        { now },
      ),
    ).toEqual({ verdict: "VERIFIED", reasons: [] });
  });

  it("reviews when a required confidence is missing", () => {
    const result = extraction();
    delete result.confidences?.delivery_date;
    expect(decideVerdict(result, trip, 0, { now })).toEqual({
      verdict: "REVIEW",
      reasons: ["low_confidence"],
    });
  });
});
