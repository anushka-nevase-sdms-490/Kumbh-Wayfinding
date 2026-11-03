/**
 * "Ask Setu" (Phase 7): a rule-based, offline assistant. It answers ONLY from
 * the published data saved on the phone (places, their trust level, opening
 * status with its expiry) and a fixed list of general safety tips. It never
 * invents a place, a status or a route — routes come from the normal router
 * when the visitor taps "Show the way". No external AI service is used.
 */
import { normalizeText, opStatus, soundKey, type OpStatus } from "./placeInfo";
import { haversineM, isRegisteredLocation, type QrNode } from "./types";

export type Topic =
  | "medical"
  | "toilet"
  | "water"
  | "help"
  | "lost"
  | "police"
  | "ghat"
  | "parking"
  | "transport"
  | "temple";

/** Place kinds (node_type) that answer each topic. */
const TOPIC_TYPES: Record<Topic, string[]> = {
  medical: ["medical", "hospital", "clinic", "pharmacy"],
  toilet: ["toilet"],
  water: ["water"],
  help: ["help", "lost_found"],
  lost: ["lost_found", "help", "police"],
  police: ["police"],
  ghat: ["ghat"],
  parking: ["parking"],
  transport: ["transport", "bus", "railway"],
  temple: ["temple"],
};

/** Words (English, Hindi, Marathi, and common spellings) that point to a topic. */
const TOPIC_WORDS: Record<Topic, string[]> = {
  medical: ["medical", "hospital", "doctor", "clinic", "first aid", "dispensary", "injured", "sick", "दवाखाना", "अस्पताल", "हॉस्पिटल", "डॉक्टर", "रुग्णालय", "वैद्यकीय", "मेडिकल", "इलाज", "उपचार"],
  toilet: ["toilet", "washroom", "bathroom", "restroom", "latrine", "शौचालय", "टॉयलेट", "संडास", "स्वच्छतागृह"],
  water: ["water", "drinking", "पानी", "पाणी", "पिण्याचे", "पीने"],
  help: ["help desk", "helpdesk", "information", "enquiry", "inquiry", "हेल्प डेस्क", "मदद केंद्र", "मदत केंद्र", "चौकशी", "जानकारी"],
  lost: ["lost", "missing", "separated", "खो गया", "खो गई", "खोया", "हरवल", "हरवला", "हरवली", "बिछड़"],
  police: ["police", "पुलिस", "पोलीस", "थाना", "चौकी"],
  ghat: ["ghat", "snan", "bathing", "घाट", "स्नान"],
  parking: ["parking", "पार्किंग"],
  transport: ["bus", "train", "station", "railway", "बस", "ट्रेन", "रेल", "रेल्वे", "स्टेशन", "स्थानक"],
  temple: ["temple", "mandir", "मंदिर", "देवस्थान"],
};

const OPEN_WORDS = ["open", "closed", "working", "खुला", "खुली", "बंद", "उघड", "चालू"];
const SAFETY_WORDS = [
  "safety", "safe", "tips", "rules", "advice", "सुरक्षा", "सूचना", "नियम", "सलाह", "सल्ला",
  // "Is it dangerous to bathe at night?" — a question for the tips (not an emergency:
  // see EMERGENCY_WORDS). Not "bathe" itself: "where can I bathe" is about ghats.
  "danger", "खतरा", "खतरनाक", "सुरक्षित", "धोका", "धोकादायक",
];

/**
 * Words that mean someone may be in danger now. Checked FIRST: the answer
 * puts 112 / 108 and "Send SOS" before anything else. Phrases match as text;
 * single words match a whole word or its start (Hindi/Marathi endings), and
 * words of 1–2 letters only as a whole word (so आगे "ahead" is not आग "fire").
 */
const EMERGENCY_WORDS = [
  "emergency", "urgent", "help me", "save me", "bleeding", "blood", "unconscious", "fainted", "not breathing",
  "can't breathe", "cannot breathe", "heart attack", "chest pain", "fire", "drowning", "accident", "injured",
  "stampede", "crush", "attacked", "snake bite", "fell down", "collapsed", "fits", "seizure",
  // Not "danger"/खतरा/धोका or a bare "snake": "is it dangerous to bathe at night?"
  // and "snake charmers" are questions for the safety tips, not emergencies.
  "snakebite", "bitten by a snake", "stabbed", "stabbing", "bachao", "aag lag",
  "बचाओ", "मदद करो", "खून", "बेहोश", "सांस नहीं", "साँस नहीं", "दिल का दौरा", "आग", "डूब", "दुर्घटना", "भगदड़", "घायल",
  "हार्ट अटैक", "सांप ने काट", "साँप ने काट", "सांप काट", "साँप काट",
  "वाचवा", "मदत करा", "रक्त", "बेशुद्ध", "श्वास घेत", "हृदयविकार", "बुडत", "अपघात", "चेंगराचेंगरी", "जखमी",
  // Marathi endings of आग (आगीत, आगीचा) and past tense of drowning (बुडाला, बुडाली).
  // साप alone would also match सापडत/सापडला ("found"), so only as a phrase.
  "आगी", "बुडा", "साप चाव", "सर्पदंश", "हार्ट अटॅक",
];

function hasEmergency(raw: string): boolean {
  // Phones type ’ for ' ("can’t breathe").
  const q = raw.replace(/[\u2018\u2019\u02bc]/g, "'");
  const tokens = q.split(/[\s,.;:!?()"'।]+/).filter(Boolean);
  return EMERGENCY_WORDS.some((w) => {
    const n = normalizeText(w);
    if (n.includes(" ")) return q.includes(n);
    return n.length <= 2 ? tokens.includes(n) : tokens.some((tk) => tk.startsWith(n));
  });
}

/** General tips (not official instructions); keys in i18n `ask.tip.*`. Version them with the app. */
export const SAFETY_TIPS = ["meet", "phone", "children", "barricades", "water", "deep", "help"] as const;
export const SAFETY_TIPS_VERSION = "2026-10-30";

export type PlaceHit = { node: QrNode; distanceM: number | null; status: OpStatus; fieldChecked: boolean };

export type Answer =
  /** Someone may be in danger: 112 / 108 and SOS first, then the nearest help. */
  | { kind: "emergency"; places: PlaceHit[] }
  | { kind: "nearest"; topic: Topic; places: PlaceHit[]; anyFieldChecked: boolean }
  | { kind: "none"; topic: Topic }
  | { kind: "status"; place: PlaceHit }
  | { kind: "safety" }
  | { kind: "unknown" };

function has(q: string, words: string[]): boolean {
  return words.some((w) => q.includes(normalizeText(w)));
}

function topicOf(q: string): Topic | null {
  // "lost" before "help": "my child is lost" should find Lost & Found first.
  const order: Topic[] = ["lost", "medical", "toilet", "water", "police", "help", "ghat", "parking", "transport", "temple"];
  return order.find((t) => has(q, TOPIC_WORDS[t])) ?? null;
}

// Words that do not tell one place from another ("Hanuman Mandir", "Parking").
const GENERIC_NAME_KEYS = new Set(
  ["mandir", "temple", "devi", "hanuman", "shri", "shree", "sri", "toilet", "parking", "ghat", "hospital",
    "clinic", "bus", "stand", "station", "police", "chowky", "water", "drinking", "the", "of"].map(soundKey)
);

/**
 * A place named in the question (longest name wins), from the saved data only.
 * A name typed in Devanagari ("कालाराम मंदिर") also finds its English name by
 * sound. Only a name that points at one place counts: a name shared by several
 * places, or made only of generic words ("Parking", "Hanuman Mandir", "Devi
 * Mandir"), is left to the nearest-places answer instead of picking one of them.
 */
function namedPlace(q: string, places: QrNode[]): QrNode | null {
  const count = new Map<string, number>();
  for (const p of places) count.set(normalizeText(p.name), (count.get(normalizeText(p.name)) ?? 0) + 1);
  const distinctive = (p: QrNode, name: string) =>
    count.get(normalizeText(p.name)) === 1 && soundKey(name).split(" ").some((w) => w && !GENERIC_NAME_KEYS.has(w));
  let best: QrNode | null = null;
  let bestLen = 0;
  const qKey = ` ${soundKey(q)} `;
  for (const p of places) {
    for (const name of [p.name, p.local_name ?? ""]) {
      const n = normalizeText(name);
      const k = soundKey(name);
      const found = (n.length >= 4 && q.includes(n)) || (k.length >= 4 && qKey.includes(` ${k} `));
      if (found && n.length > bestLen && distinctive(p, name)) {
        best = p;
        bestLen = n.length;
      }
    }
  }
  return best;
}

/**
 * A hospital whose name says it treats one thing (eyes, teeth, births,
 * children…): for "medical help" it counts as this much farther away, so a
 * general hospital nearby comes first. The map data has no "emergency" tag.
 */
const SPECIALIST_RE =
  /\b(eye|eyes|lasik|netra|dental|dentist|teeth|maternity|gyn\w*|obstetric\w*|ivf|fertility|child|children|paediatric|pediatric|skin|derma\w*|ent|ortho\w*|heart|cardiac|diabet\w*|physio\w*|psychiatr\w*)\b/i;
const SPECIALIST_EXTRA_M = 1000;

// "Maternity and General Hospital", "Dental and Accident Hospital": not only one specialty.
const GENERAL_RE = /\b(general|multi\w*|accident|emergency|trauma|civil|casualty)\b/i;

function isSpecialist(p: QrNode): boolean {
  return p.node_type === "medical" && SPECIALIST_RE.test(p.name) && !GENERAL_RE.test(p.name);
}

/**
 * Distance for ordering "medical help": specialist hospitals count as farther —
 * unless the question asks for a specialty ("eye hospital", "heart attack").
 */
function helpDistance(h: PlaceHit, q: string): number {
  if (!isSpecialist(h.node)) return h.distanceM ?? 0;
  // Only the asked-for specialty is exempt: "heart attack" → heart hospitals, not the eye hospital.
  const asked = new Set((q.match(new RegExp(SPECIALIST_RE.source, "gi")) ?? []).map((w) => w.toLowerCase()));
  const own = (h.node.name.match(new RegExp(SPECIALIST_RE.source, "gi")) ?? []).map((w) => w.toLowerCase());
  return (h.distanceM ?? 0) + (own.some((w) => asked.has(w)) ? 0 : SPECIALIST_EXTRA_M);
}

function hit(node: QrNode, from: { lat: number; lon: number } | null, now: Date): PlaceHit {
  return {
    node,
    distanceM: from ? haversineM(from.lat, from.lon, node.lat, node.lon) : null,
    status: opStatus(node, now),
    fieldChecked: node.verification === "volunteer_verified" || node.verification === "officially_verified",
  };
}

export type AskContext = {
  places: QrNode[];
  /** Live GPS, or the place the visitor said they are at. */
  from: { lat: number; lon: number } | null;
  now?: Date;
};

export function ask(question: string, ctx: AskContext): Answer {
  const q = normalizeText(question);
  const now = ctx.now ?? new Date();
  const places = ctx.places.filter(isRegisteredLocation);
  if (!q) return { kind: "unknown" };

  if (hasEmergency(q)) {
    const help = ["medical", "help", "lost_found", "police"];
    const places = ctx.places
      .filter((p) => isRegisteredLocation(p) && help.includes(p.node_type))
      .map((p) => hit(p, ctx.from, now))
      .filter((h) => h.status.kind !== "closed")
      .sort((a, b) => helpDistance(a, q) - helpDistance(b, q))
      .slice(0, 3);
    return { kind: "emergency", places };
  }

  if (has(q, SAFETY_WORDS) && !topicOf(q)) return { kind: "safety" };

  // "Is Kalaram Mandir open?" — the status of a named place.
  const named = namedPlace(q, places);
  if (named && has(q, OPEN_WORDS)) return { kind: "status", place: hit(named, ctx.from, now) };

  const topic = topicOf(q);
  if (!topic) return named ? { kind: "status", place: hit(named, ctx.from, now) } : { kind: "unknown" };

  const types = TOPIC_TYPES[topic];
  const candidates = places
    .filter((p) => types.includes(p.node_type))
    .map((p) => hit(p, ctx.from, now))
    // A place reported closed (and still valid) goes last; nearer first; checked on site first when equally near.
    .sort((a, b) => {
      const closed = (h: PlaceHit) => (h.status.kind === "closed" ? 1 : 0);
      if (closed(a) !== closed(b)) return closed(a) - closed(b);
      const da = helpDistance(a, q);
      const db = helpDistance(b, q);
      if (a.distanceM != null && b.distanceM != null && Math.abs(da - db) > 50) return da - db;
      return Number(b.fieldChecked) - Number(a.fieldChecked) || da - db;
    });
  if (candidates.length === 0) return { kind: "none", topic };
  const top = candidates.slice(0, 3);
  return { kind: "nearest", topic, places: top, anyFieldChecked: top.some((h) => h.fieldChecked) };
}
