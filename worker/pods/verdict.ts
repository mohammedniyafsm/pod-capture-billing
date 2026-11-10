export type Verdict = "VERIFIED" | "RETAKE" | "REVIEW";

export type RetakeReason =
  | "stamp_not_visible"
  | "signature_missing"
  | "blurry"
  | "cropped"
  | "lr_not_visible"
  | "lr_mismatch"
  | "quantity_unreadable";

export type VerdictReason =
  | RetakeReason
  | "ai_unavailable"
  | "retake_limit"
  | "shortage_remark"
  | "damage"
  | "low_confidence"
  | "quantity_mismatch"
  | "quantity_unit_unreadable"
  | "quantity_unit_mismatch"
  | "goods_unreadable"
  | "goods_mismatch"
  | "delivery_date_unreadable"
  | "delivery_date_invalid"
  | "delivery_date_mismatch";

export interface VerdictExtraction {
  aiFailed?: boolean;
  aiTimedOut?: boolean;
  fields?: {
    lr_number?: string | null;
    consignee_stamp_present?: boolean;
    signature_present?: boolean;
    remarks_text?: string | null;
    has_shortage_or_damage_remark?: boolean;
    image_readable?: boolean;
    blurry?: boolean;
    cropped?: boolean;
    quantity_received?: number | null;
    quantity_unit?: string | null;
    goods_description?: string | null;
    delivery_date?: string | null;
  };
  confidences?: Partial<
    Record<
      | "lr_number"
      | "consignee_stamp"
      | "signature"
      | "quantity_received"
      | "goods_description"
      | "delivery_date",
      number
    >
  >;
}

export interface VerdictTrip {
  lrNumber: string;
  expectedQuantity: number;
  quantityUnit: string;
  goodsDescription: string;
  deliveredAt: Date | null;
}

export interface VerdictConfig {
  confidenceThreshold?: number;
  now?: Date;
}

export interface VerdictDecision {
  verdict: Verdict;
  reasons: VerdictReason[];
  retakeReason?: RetakeReason;
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
export const MAX_RETAKES = 2;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const NEGATION = /\b(?:no|not|never|without|neither)\b/i;
const REMARK_TERM =
  /\b(shortage|shortfall|short|missing|damag(?:e|ed|ing))\b/gi;

function normalizeLrNumber(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, "");
}

function normalizeUnit(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function quantityUnitsMatch(expected: string, actual: string): boolean {
  return normalizeUnit(expected) === normalizeUnit(actual);
}

function normalizeGoodsDescription(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

function descriptionsClearlyConflict(expected: string, extracted: string): boolean {
  const expectedTokens = normalizeGoodsDescription(expected);
  const extractedTokens = normalizeGoodsDescription(extracted);
  if (expectedTokens.length === 0 || extractedTokens.length === 0) return false;
  const extractedSet = new Set(extractedTokens);
  return !expectedTokens.some((token) => extractedSet.has(token));
}

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateInKolkata(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function getRemarkReasons(
  remarks: string,
  hasShortageOrDamageRemark: boolean,
): VerdictReason[] {
  const reasons = new Set<VerdictReason>();
  const positiveMatches: Array<{ term: string; category: VerdictReason }> = [];
  let match: RegExpExecArray | null;

  REMARK_TERM.lastIndex = 0;
  while ((match = REMARK_TERM.exec(remarks)) !== null) {
    const precedingText = remarks.slice(0, match.index);
    const clauseStart = Math.max(
      precedingText.lastIndexOf("."),
      precedingText.lastIndexOf(","),
      precedingText.lastIndexOf(";"),
      precedingText.toLowerCase().lastIndexOf(" but "),
      precedingText.toLowerCase().lastIndexOf(" however "),
    );
    const prefix = precedingText.slice(clauseStart + 1);
    if (NEGATION.test(prefix)) continue;
    positiveMatches.push({
      term: match[0].toLowerCase(),
      category:
        match[0].toLowerCase().startsWith("damag")
          ? "damage"
          : "shortage_remark",
    });
  }

  for (const positive of positiveMatches) reasons.add(positive.category);

  const hasOnlyNegatedTerms =
    remarks.trim().length > 0 &&
    positiveMatches.length === 0 &&
    /\b(?:shortage|shortfall|short|missing|damag(?:e|ed|ing))\b/i.test(remarks);
  if (
    hasShortageOrDamageRemark &&
    !hasOnlyNegatedTerms &&
    positiveMatches.length === 0
  ) {
    reasons.add("shortage_remark");
  }
  return [...reasons];
}

function retakeOrLimit(
  reason: RetakeReason,
  retakeCount: number,
): VerdictDecision {
  if (retakeCount < MAX_RETAKES) {
    return { verdict: "RETAKE", reasons: [reason], retakeReason: reason };
  }
  return { verdict: "REVIEW", reasons: ["retake_limit"] };
}

export function decideVerdict(
  extraction: VerdictExtraction | null,
  trip: VerdictTrip,
  retakeCount: number,
  config: VerdictConfig = {},
): VerdictDecision {
  const confidenceThreshold =
    config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  if (
    !Number.isFinite(confidenceThreshold) ||
    confidenceThreshold < 0 ||
    confidenceThreshold > 1
  ) {
    throw new RangeError("confidenceThreshold must be between 0 and 1");
  }

  if (
    extraction === null ||
    extraction.aiFailed === true ||
    extraction.aiTimedOut === true
  ) {
    return { verdict: "REVIEW", reasons: ["ai_unavailable"] };
  }

  const fields = extraction.fields;
  const remarkReasons = getRemarkReasons(
    fields?.remarks_text ?? "",
    fields?.has_shortage_or_damage_remark === true,
  );
  if (remarkReasons.length > 0) {
    return { verdict: "REVIEW", reasons: remarkReasons };
  }

  const qualityReasons: RetakeReason[] = [];
  if (fields?.image_readable === false || fields?.blurry === true) {
    qualityReasons.push("blurry");
  }
  if (fields?.cropped === true) qualityReasons.push("cropped");
  if (fields?.consignee_stamp_present !== true) {
    qualityReasons.push("stamp_not_visible");
  }
  if (fields?.signature_present !== true) {
    qualityReasons.push("signature_missing");
  }
  if (typeof fields?.lr_number !== "string" || !fields.lr_number.trim()) {
    qualityReasons.push("lr_not_visible");
  }

  if (qualityReasons.length > 0) {
    if (retakeCount < MAX_RETAKES) {
      return {
        verdict: "RETAKE",
        reasons: qualityReasons,
        retakeReason: qualityReasons[0],
      };
    }
    return { verdict: "REVIEW", reasons: ["retake_limit"] };
  }

  if (
    normalizeLrNumber(fields?.lr_number ?? "") !==
    normalizeLrNumber(trip.lrNumber)
  ) {
    if (retakeCount < MAX_RETAKES) {
      return {
        verdict: "RETAKE",
        reasons: ["lr_mismatch"],
        retakeReason: "lr_mismatch",
      };
    }
    return { verdict: "REVIEW", reasons: ["retake_limit", "lr_mismatch"] };
  }

  if (fields?.quantity_received === null || fields?.quantity_received === undefined) {
    return retakeOrLimit("quantity_unreadable", retakeCount);
  }

  const reasons: VerdictReason[] = [];
  if (fields.quantity_received !== trip.expectedQuantity) {
    reasons.push("quantity_mismatch");
  }
  if (!fields.quantity_unit?.trim()) {
    reasons.push("quantity_unit_unreadable");
  } else if (!quantityUnitsMatch(trip.quantityUnit, fields.quantity_unit)) {
    reasons.push("quantity_unit_mismatch");
  }
  if (fields.goods_description === null || !fields.goods_description?.trim()) {
    reasons.push("goods_unreadable");
  } else if (
    descriptionsClearlyConflict(trip.goodsDescription, fields.goods_description)
  ) {
    reasons.push("goods_mismatch");
  }

  const deliveryDate = fields.delivery_date;
  if (deliveryDate === null || deliveryDate === undefined || !deliveryDate.trim()) {
    reasons.push("delivery_date_unreadable");
  } else if (!isValidDateOnly(deliveryDate)) {
    reasons.push("delivery_date_invalid");
  } else {
    const today = dateInKolkata(config.now ?? new Date());
    if (deliveryDate > today) {
      reasons.push("delivery_date_invalid");
    } else if (
      trip.deliveredAt &&
      deliveryDate !== dateInKolkata(trip.deliveredAt)
    ) {
      reasons.push("delivery_date_mismatch");
    }
  }
  if (reasons.length > 0) return { verdict: "REVIEW", reasons };

  const confidences = extraction.confidences;
  const requiredConfidences = [
    confidences?.lr_number,
    confidences?.consignee_stamp,
    confidences?.signature,
    confidences?.quantity_received,
    confidences?.goods_description,
    confidences?.delivery_date,
  ];
  if (
    requiredConfidences.some(
      (confidence) =>
        confidence === undefined ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1 ||
        confidence < confidenceThreshold,
    )
  ) {
    return { verdict: "REVIEW", reasons: ["low_confidence"] };
  }

  return { verdict: "VERIFIED", reasons: [] };
}
