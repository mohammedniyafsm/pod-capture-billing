export type VoiceLanguage = "Hindi" | "Marathi" | "English";

export type PromptSegment =
  | { type: "clip"; key: FixedClipKey }
  | { type: "say"; text: string };

export type FixedClipKey =
  | "your_route"
  | "from"
  | "to"
  | "goods_is"
  | "quantity_is"
  | "client_is"
  | "vehicle_number_is"
  | "tap_start_trip"
  | "tap_photograph_pod"
  | "take_photo_again"
  | "reason_is"
  | "retake_number"
  | "one"
  | "two"
  | "of"
  | "retake_limit_reached"
  | "office_will_check"
  | "receipt_with_office"
  | "trip_complete"
  | "proof_accepted"
  | "nothing_more_to_do"
  | "no_network_saved"
  | "stamp_not_visible"
  | "signature_missing"
  | "blurry"
  | "lr_unreadable"
  | "date_missing"
  | "cut_off"
  | "unclear_photo";

export const FIXED_CLIPS: Record<FixedClipKey, Record<VoiceLanguage, string>> = {
  your_route: {
    Hindi: "आपका रास्ता",
    Marathi: "तुमचा मार्ग",
    English: "Your route is",
  },
  from: {
    Hindi: "से",
    Marathi: "येथून",
    English: "from",
  },
  to: {
    Hindi: "तक",
    Marathi: "ते",
    English: "to",
  },
  goods_is: {
    Hindi: "सामान है",
    Marathi: "माल आहे",
    English: "Goods are",
  },
  quantity_is: {
    Hindi: "मात्रा है",
    Marathi: "प्रमाण आहे",
    English: "Quantity is",
  },
  client_is: {
    Hindi: "ग्राहक है",
    Marathi: "ग्राहक आहे",
    English: "Client is",
  },
  vehicle_number_is: {
    Hindi: "गाड़ी नंबर है",
    Marathi: "गाडी क्रमांक आहे",
    English: "Vehicle number is",
  },
  tap_start_trip: {
    Hindi: "यात्रा शुरू करने के लिए स्टार्ट ट्रिप बटन दबाएं।",
    Marathi: "प्रवास सुरू करण्यासाठी स्टार्ट ट्रिप बटण दाबा.",
    English: "Tap Start Trip to begin your journey.",
  },
  tap_photograph_pod: {
    Hindi: "कृपया सही की हुई पावती की फोटो खींचने के लिए बटन दबाएं।",
    Marathi: "कृपया सही केलेल्या पावतीचा फोटो काढण्यासाठी बटण दाबा.",
    English: "Tap Photograph POD to capture the signed delivery receipt.",
  },
  take_photo_again: {
    Hindi: "कृपया दोबारा फोटो लें।",
    Marathi: "कृपया पुन्हा फोटो काढा.",
    English: "Please take the photograph again.",
  },
  reason_is: {
    Hindi: "कारण है",
    Marathi: "कारण आहे",
    English: "Reason is",
  },
  retake_number: {
    Hindi: "प्रयास नंबर",
    Marathi: "प्रयत्न क्रमांक",
    English: "Attempt number",
  },
  one: {
    Hindi: "एक",
    Marathi: "एक",
    English: "one",
  },
  two: {
    Hindi: "दो",
    Marathi: "दोन",
    English: "two",
  },
  of: {
    Hindi: "में से",
    Marathi: "पैकी",
    English: "of",
  },
  retake_limit_reached: {
    Hindi: "फोटो लेने की सीमा समाप्त हो चुकी है।",
    Marathi: "फोटो काढण्याची मर्यादा संपली आहे.",
    English: "Maximum photo attempts reached.",
  },
  office_will_check: {
    Hindi: "कार्यालय टीम इसकी जांच करेगी।",
    Marathi: "कार्यालयीन चमू याची पडताळणी करेल.",
    English: "The office team will manually review your proof.",
  },
  receipt_with_office: {
    Hindi: "दस्तावेज़ कार्यालय में समीक्षाधीन है।",
    Marathi: "कागदपत्र कार्यालयात तपासणीसाठी प्रलंबित आहे.",
    English: "The document is under office review.",
  },
  trip_complete: {
    Hindi: "यह ट्रिप पूरी हो चुकी है।",
    Marathi: "ही ट्रिप पूर्ण झाली आहे.",
    English: "Trip is completed.",
  },
  proof_accepted: {
    Hindi: "डिलीवरी का सबूत स्वीकार कर लिया गया है।",
    Marathi: "डिलिव्हरीचा पुरावा मंजूर झाला आहे.",
    English: "Delivery proof has been verified.",
  },
  nothing_more_to_do: {
    Hindi: "इस ट्रिप के लिए अब कुछ और नहीं करना है।",
    Marathi: "या ट्रिपसाठी आता काहीही करण्याची गरज नाही.",
    English: "Nothing more to do for this trip.",
  },
  no_network_saved: {
    Hindi: "नेटवर्क नहीं है। फोटो फोन में सुरक्षित है।",
    Marathi: "नेटवर्क नाही. फोटो फोनमध्ये सुरक्षित आहे.",
    English: "No network. Photo saved safely on phone.",
  },
  stamp_not_visible: {
    Hindi: "ग्राहक की मुहर दिखाई नहीं दे रही है",
    Marathi: "ग्राहकाचा शिक्का दिसत नाही",
    English: "Consignee stamp is not visible",
  },
  signature_missing: {
    Hindi: "पावती पर हस्ताक्षर गायब है",
    Marathi: "पावतीवर स्वाक्षरी नाही",
    English: "Receiver signature is missing",
  },
  blurry: {
    Hindi: "फोटो धुंधली आई है",
    Marathi: "फोटो अस्पष्ट आणि धूसर आला आहे",
    English: "Photograph is blurry",
  },
  lr_unreadable: {
    Hindi: "एलआर नंबर स्पष्ट नहीं है",
    Marathi: "एलआर क्रमांक स्पष्ट दिसत नाही",
    English: "LR number is unreadable",
  },
  date_missing: {
    Hindi: "डिलीवरी की तारीख नहीं दिख रही है",
    Marathi: "डिलिव्हरीची तारीख दिसत नाही",
    English: "Delivery date is missing",
  },
  cut_off: {
    Hindi: "कागज़ के कोने कट गए हैं",
    Marathi: "कागदपत्राच्या कडा कापल्या गेल्या आहेत",
    English: "Document corners are cut off",
  },
  unclear_photo: {
    Hindi: "फोटो स्पष्ट नहीं है",
    Marathi: "फोटो स्पष्ट नाही",
    English: "Photograph is not clear",
  },
};

/**
 * Sanitizes dynamic text spoken by on-device SpeechSynthesis.
 * Collapses whitespace, strips special characters, caps at 80 chars.
 */
export function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  const cleaned = text
    .replace(/[^a-zA-Z0-9\s\-&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80);
}

/**
 * Turns license plate like "MH31 BN 1128 (hired)" into "M H 3 1, B N, 1 1 2 8"
 */
export function spellPlate(plate: string | null | undefined): string {
  if (!plate) return "";

  // Strip (hired) suffix case-insensitively
  const clean = plate.replace(/\(hired\)/gi, "").trim();

  // Split into tokens by spaces/hyphens
  const tokens = clean.split(/[\s\-]+/).filter(Boolean);

  const groups = tokens.map((token) => {
    // Separate every character with a space
    return token.toUpperCase().split("").join(" ");
  });

  return groups.join(", ");
}

/**
 * Resolves retake reason key or falls back to unclear_photo.
 */
export function resolveRetakeClipKey(reasonCode: string | null | undefined): FixedClipKey {
  switch (reasonCode) {
    case "stamp_not_visible":
      return "stamp_not_visible";
    case "signature_missing":
      return "signature_missing";
    case "blurry":
      return "blurry";
    case "lr_not_visible":
    case "lr_mismatch":
    case "lr_unreadable":
      return "lr_unreadable";
    case "date_missing":
      return "date_missing";
    case "cropped":
    case "cut_off":
      return "cut_off";
    default:
      return "unclear_photo";
  }
}

export interface HybridTripContext {
  id?: string;
  tripCode?: string;
  origin?: string;
  destination?: string;
  vehicleNo?: string;
  client?: { name: string } | null;
  goodsDescription?: string;
  expectedQuantity?: number | string;
  quantityUnit?: string;
  status: string;
  retakeReason?: string | null;
  retakeCount?: number;
}

/**
 * Builds sequential hybrid segments respecting Hindi / Marathi / English grammar.
 */
export function buildSegments(
  trip: HybridTripContext,
  status: string,
  lang: VoiceLanguage
): PromptSegment[] {
  const segments: PromptSegment[] = [];

  const origin = sanitize(trip.origin);
  const destination = sanitize(trip.destination);
  const goods = sanitize(trip.goodsDescription);
  const qty = trip.expectedQuantity
    ? `${sanitize(String(trip.expectedQuantity))} ${sanitize(trip.quantityUnit)}`
    : "";
  const client = sanitize(trip.client?.name);
  const plate = spellPlate(trip.vehicleNo);

  // 1. VERIFIED STATUS
  if (status === "VERIFIED") {
    segments.push(
      { type: "clip", key: "trip_complete" },
      { type: "clip", key: "proof_accepted" },
      { type: "clip", key: "nothing_more_to_do" }
    );
    return segments;
  }

  // 2. RETAKE LIMIT REACHED / NEEDS REVIEW
  if (status === "NEEDS_REVIEW" || (trip.retakeCount && trip.retakeCount >= 2)) {
    segments.push(
      { type: "clip", key: "retake_limit_reached" },
      { type: "clip", key: "office_will_check" },
      { type: "clip", key: "receipt_with_office" }
    );
    return segments;
  }

  // 3. RETAKE REQUESTED
  if (status === "RETAKE_REQUESTED") {
    const reasonKey = resolveRetakeClipKey(trip.retakeReason);
    const attempt = Math.min(2, (trip.retakeCount ?? 0) + 1);

    if (lang === "Hindi") {
      segments.push(
        { type: "clip", key: "take_photo_again" },
        { type: "clip", key: "reason_is" },
        { type: "clip", key: reasonKey },
        { type: "clip", key: "retake_number" },
        { type: "clip", key: attempt === 1 ? "one" : "two" },
        { type: "clip", key: "of" },
        { type: "clip", key: "two" },
        { type: "clip", key: "tap_photograph_pod" }
      );
    } else if (lang === "Marathi") {
      // Marathi word order: फोटो पुन्हा काढा. कारण: [reason]. प्रयत्न [n] पैकी [2].
      segments.push(
        { type: "clip", key: "take_photo_again" },
        { type: "clip", key: "reason_is" },
        { type: "clip", key: reasonKey },
        { type: "clip", key: "retake_number" },
        { type: "clip", key: attempt === 1 ? "one" : "two" },
        { type: "clip", key: "of" },
        { type: "clip", key: "two" },
        { type: "clip", key: "tap_photograph_pod" }
      );
    } else {
      // English: Please take the photo again. Reason is [reason]. Attempt number [n] of [2].
      segments.push(
        { type: "clip", key: "take_photo_again" },
        { type: "clip", key: "reason_is" },
        { type: "clip", key: reasonKey },
        { type: "clip", key: "retake_number" },
        { type: "clip", key: attempt === 1 ? "one" : "two" },
        { type: "clip", key: "of" },
        { type: "clip", key: "two" },
        { type: "clip", key: "tap_photograph_pod" }
      );
    }
    return segments;
  }

  // 4. ASSIGNED STATUS
  if (status === "ASSIGNED") {
    if (lang === "Hindi") {
      // Hindi: आपका रास्ता [from] से [to] तक. सामान है [goods]. मात्रा है [qty]. ग्राहक है [client]. गाड़ी नंबर है [plate]. स्टार्ट ट्रिप बटन दबाएं.
      segments.push({ type: "clip", key: "your_route" });
      if (origin) segments.push({ type: "say", text: origin });
      segments.push({ type: "clip", key: "from" });
      if (destination) segments.push({ type: "say", text: destination });
      segments.push({ type: "clip", key: "to" });

      if (goods) {
        segments.push({ type: "clip", key: "goods_is" }, { type: "say", text: goods });
      }
      if (qty) {
        segments.push({ type: "clip", key: "quantity_is" }, { type: "say", text: qty });
      }
      if (client) {
        segments.push({ type: "clip", key: "client_is" }, { type: "say", text: client });
      }
      if (plate) {
        segments.push({ type: "clip", key: "vehicle_number_is" }, { type: "say", text: plate });
      }
      segments.push({ type: "clip", key: "tap_start_trip" });
    } else if (lang === "Marathi") {
      // Marathi: तुमचा मार्ग [from] येथून [to] ते. माल आहे [goods]. प्रमाण आहे [qty]. ग्राहक आहे [client]. गाडी क्रमांक आहे [plate]. स्टार्ट ट्रिप बटण दाबा.
      segments.push({ type: "clip", key: "your_route" });
      if (origin) segments.push({ type: "say", text: origin });
      segments.push({ type: "clip", key: "from" });
      if (destination) segments.push({ type: "say", text: destination });
      segments.push({ type: "clip", key: "to" });

      if (goods) {
        segments.push({ type: "clip", key: "goods_is" }, { type: "say", text: goods });
      }
      if (qty) {
        segments.push({ type: "clip", key: "quantity_is" }, { type: "say", text: qty });
      }
      if (client) {
        segments.push({ type: "clip", key: "client_is" }, { type: "say", text: client });
      }
      if (plate) {
        segments.push({ type: "clip", key: "vehicle_number_is" }, { type: "say", text: plate });
      }
      segments.push({ type: "clip", key: "tap_start_trip" });
    } else {
      // English: Your route is from [from] to [to]. Goods are [goods]. Quantity is [qty]. Client is [client]. Vehicle number is [plate]. Tap Start Trip.
      segments.push({ type: "clip", key: "your_route" }, { type: "clip", key: "from" });
      if (origin) segments.push({ type: "say", text: origin });
      segments.push({ type: "clip", key: "to" });
      if (destination) segments.push({ type: "say", text: destination });

      if (goods) {
        segments.push({ type: "clip", key: "goods_is" }, { type: "say", text: goods });
      }
      if (qty) {
        segments.push({ type: "clip", key: "quantity_is" }, { type: "say", text: qty });
      }
      if (client) {
        segments.push({ type: "clip", key: "client_is" }, { type: "say", text: client });
      }
      if (plate) {
        segments.push({ type: "clip", key: "vehicle_number_is" }, { type: "say", text: plate });
      }
      segments.push({ type: "clip", key: "tap_start_trip" });
    }
    return segments;
  }

  // 5. IN_TRANSIT / POD_PENDING / READY FOR CAPTURE
  if (lang === "Hindi") {
    segments.push({ type: "clip", key: "your_route" });
    if (destination) segments.push({ type: "say", text: destination });
    segments.push({ type: "clip", key: "to" });
    if (client) {
      segments.push({ type: "clip", key: "client_is" }, { type: "say", text: client });
    }
    segments.push({ type: "clip", key: "tap_photograph_pod" });
  } else if (lang === "Marathi") {
    segments.push({ type: "clip", key: "your_route" });
    if (destination) segments.push({ type: "say", text: destination });
    segments.push({ type: "clip", key: "to" });
    if (client) {
      segments.push({ type: "clip", key: "client_is" }, { type: "say", text: client });
    }
    segments.push({ type: "clip", key: "tap_photograph_pod" });
  } else {
    segments.push({ type: "clip", key: "your_route" }, { type: "clip", key: "to" });
    if (destination) segments.push({ type: "say", text: destination });
    if (client) {
      segments.push({ type: "clip", key: "client_is" }, { type: "say", text: client });
    }
    segments.push({ type: "clip", key: "tap_photograph_pod" });
  }

  return segments;
}

