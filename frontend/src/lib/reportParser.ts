/**
 * Report helper for operators (Phase 7): turns what a reporter said (English,
 * Hindi or Marathi) into SUGGESTED case fields and lists what is still
 * missing. Rule-based — no external AI. It never guesses: a field is only
 * suggested when the words are there (no gender without a word for it, no
 * date for a time). The operator chooses what to use; nothing here changes a
 * case's status or decides anyone's identity.
 */
import { normalizeText } from "./placeInfo";
import { isRegisteredLocation, type QrNode } from "./types";

export type ReportFields = {
  approx_age?: string;
  gender?: string;
  description?: string;
  languages?: string;
  last_seen_place_code?: string;
  last_seen_note?: string;
  person_name?: string;
  reporter_contact?: string;
};

export type Suggestion = { field: keyof ReportFields; value: string; label: string; from: string };
export type ParsedReport = { suggestions: Suggestion[]; questions: string[] };

const MALE = ["boy", "man", "son", "father", "grandfather", "husband", "brother", "uncle", "लड़का", "लडका", "आदमी", "बेटा", "पिता", "पिताजी", "दादा", "पति", "भाई", "मुलगा", "वडील", "बाबा", "आजोबा", "नवरा", "भाऊ"];
const FEMALE = ["girl", "woman", "daughter", "mother", "grandmother", "wife", "sister", "aunt", "लड़की", "लडकी", "औरत", "बेटी", "माँ", "मां", "दादी", "पत्नी", "बहन", "मुलगी", "आई", "आजी", "बायको", "बहीण", "स्त्री", "महिला"];
const COLORS: Record<string, string> = {
  red: "red", blue: "blue", green: "green", yellow: "yellow", white: "white", black: "black", orange: "orange",
  saffron: "saffron", pink: "pink", purple: "purple", brown: "brown", grey: "grey", gray: "grey", maroon: "maroon",
  "लाल": "red", "नीला": "blue", "नीली": "blue", "निळा": "blue", "निळी": "blue", "निळ्या": "blue", "हरा": "green", "हरी": "green",
  "हिरवा": "green", "हिरवी": "green", "हिरव्या": "green", "पीला": "yellow", "पीली": "yellow", "पिवळा": "yellow", "पिवळी": "yellow",
  "सफेद": "white", "सफ़ेद": "white", "पांढरा": "white", "पांढरी": "white", "पांढऱ्या": "white", "काला": "black", "काली": "black",
  "काळा": "black", "काळी": "black", "काळ्या": "black", "भगवा": "saffron", "भगवी": "saffron", "गुलाबी": "pink", "नारंगी": "orange",
};
const ITEMS: Record<string, string> = {
  shirt: "shirt", tshirt: "t-shirt", "t-shirt": "t-shirt", saree: "saree", sari: "saree", kurta: "kurta", frock: "frock",
  dress: "dress", shorts: "shorts", pants: "trousers", trousers: "trousers", jeans: "jeans", cap: "cap", shawl: "shawl",
  dhoti: "dhoti", sweater: "sweater", jacket: "jacket", scarf: "scarf", turban: "turban", pagdi: "turban", sandals: "sandals",
  "साड़ी": "saree", "साडी": "saree", "कुर्ता": "kurta", "शर्ट": "shirt", "टोपी": "cap", "धोती": "dhoti", "फ्रॉक": "frock",
  "शॉल": "shawl", "पगड़ी": "turban", "पगडी": "turban", "चप्पल": "sandals", "पॅन्ट": "trousers", "पैंट": "trousers", "स्वेटर": "sweater",
};
const LANGS: Record<string, string> = {
  marathi: "Marathi", hindi: "Hindi", gujarati: "Gujarati", english: "English", telugu: "Telugu", kannada: "Kannada",
  bengali: "Bengali", tamil: "Tamil", punjabi: "Punjabi", "मराठी": "Marathi", "हिंदी": "Hindi", "हिन्दी": "Hindi",
  "गुजराती": "Gujarati", "तेलुगु": "Telugu", "कन्नड": "Kannada", "बंगाली": "Bengali", "तमिळ": "Tamil", "पंजाबी": "Punjabi",
};
const DAYPART: Record<string, string> = {
  morning: "morning", afternoon: "afternoon", evening: "evening", night: "night", "सुबह": "morning", "सकाळी": "morning",
  "दोपहर": "afternoon", "दुपारी": "afternoon", "शाम": "evening", "संध्याकाळी": "evening", "रात": "night", "रात्री": "night",
};

const tokensOf = (s: string) => normalizeText(s).split(/[\s,.;:!?()"'/]+/).filter(Boolean);

/** A whole word (English) or a whole Devanagari token. */
function hasWord(tokens: string[], words: string[]): string | null {
  for (const w of words) if (tokens.includes(normalizeText(w))) return w;
  return null;
}

export function parseReport(text: string, places: QrNode[]): ParsedReport {
  const raw = text.trim();
  const out: Suggestion[] = [];
  if (!raw) return { suggestions: [], questions: [] };
  const tokens = tokensOf(raw);
  const norm = normalizeText(raw);

  // Age: "8 years", "8 yrs", "aged 60", "age 60", "8 साल", "8 वर्ष", "8 वर्षांचा".
  const age =
    /(\d{1,3})\s*(?:-?\s*years?(?:\s*old)?|-?\s*yrs?|-?\s*year-old|y\/o|साल|वर्ष\S*)/i.exec(raw) ??
    /\b(?:age|aged)\s*(\d{1,3})\b/i.exec(raw);
  if (age && Number(age[1]) <= 120) out.push({ field: "approx_age", value: String(Number(age[1])), label: `Age about ${Number(age[1])}`, from: age[0] });

  // Gender only from an explicit word; both kinds of words → leave it to the operator.
  const m = hasWord(tokens, MALE);
  const f = hasWord(tokens, FEMALE);
  if (m && !f) out.push({ field: "gender", value: "male", label: "Male", from: m });
  if (f && !m) out.push({ field: "gender", value: "female", label: "Female", from: f });

  // Clothing: "<colour> <item>" (a colour up to two words before the item), or an item alone.
  const clothes: string[] = [];
  tokens.forEach((tok, i) => {
    const item = ITEMS[tok];
    if (!item) return;
    const color = [tokens[i - 1], tokens[i - 2]].map((c) => (c ? COLORS[c] : undefined)).find(Boolean);
    const phrase = color ? `${color} ${item}` : item;
    if (!clothes.includes(phrase)) clothes.push(phrase);
  });
  if (clothes.length) out.push({ field: "description", value: `Wearing ${clothes.join(", ")}`, label: `Wearing ${clothes.join(", ")}`, from: clothes.join(", ") });

  const langs = [...new Set(tokens.map((tk) => LANGS[tk]).filter(Boolean))];
  if (langs.length) out.push({ field: "languages", value: langs.join(", "), label: `Speaks ${langs.join(", ")}`, from: langs.join(", ") });

  // Last-seen place: a known place named in the text (longest name wins).
  let best: QrNode | null = null;
  let bestLen = 0;
  for (const p of places.filter(isRegisteredLocation)) {
    for (const n of [p.name, p.local_name ?? ""]) {
      const nn = normalizeText(n);
      if (nn.length >= 4 && norm.includes(nn) && nn.length > bestLen) [best, bestLen] = [p, nn.length];
    }
  }
  if (best) out.push({ field: "last_seen_place_code", value: best.code, label: `Last seen at ${best.name}`, from: best.name });

  // Time of day as words, never turned into a date.
  const clock = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(raw);
  const part = tokens.map((tk) => DAYPART[tk]).find(Boolean);
  const num = /(?:at|around|about|बजे|वाजता|वाजता)\s*(\d{1,2})(?:[:.](\d{2}))?|(\d{1,2})(?:[:.](\d{2}))?\s*(?:बजे|वाजता|वाजता)/i.exec(raw);
  let when: string | null = null;
  if (clock) when = `around ${clock[1]}${clock[2] ? `:${clock[2]}` : ""} ${clock[3].replace(/\./g, "").toLowerCase()}`;
  else if (num) when = `around ${num[1] ?? num[3]}${(num[2] ?? num[4]) ? `:${num[2] ?? num[4]}` : ""}${part ? ` (${part})` : ""}`;
  else if (part) when = `in the ${part}`;
  if (when) out.push({ field: "last_seen_note", value: `Last seen ${when}`, label: `Last seen ${when}`, from: (clock ?? num)?.[0] ?? part ?? "" });

  // Name only after an explicit "name is / named / नाम / नाव".
  const name = /\b(?:name is|named|called)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/.exec(raw) ?? /(?:नाम|नाव)\s+(?:है\s+|आहे\s+)?([^\s,।.]+)/.exec(raw);
  if (name) out.push({ field: "person_name", value: name[1], label: `Name ${name[1]}`, from: name[0] });

  const phone = /(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})\b/.exec(raw);
  if (phone) out.push({ field: "reporter_contact", value: phone[1].replace(/[\s-]/g, ""), label: `Phone ${phone[1]}`, from: phone[0] });

  const got = new Set(out.map((s) => s.field));
  const questions: string[] = [];
  if (!got.has("description")) questions.push("What is the person wearing (colours, clothes)?");
  if (!got.has("approx_age")) questions.push("About how old is the person?");
  if (!got.has("last_seen_place_code")) questions.push("Where exactly were they last seen?");
  if (!got.has("last_seen_note")) questions.push("At what time were they last seen?");
  if (!got.has("languages")) questions.push("Which languages do they speak?");
  if (!got.has("reporter_contact")) questions.push("A phone number where the reporter can be reached?");
  return { suggestions: out, questions };
}
