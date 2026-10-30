/**
 * "Ask Setu" (Phase 7): a rule-based, offline assistant. It answers ONLY from
 * the published data saved on the phone (places, their trust level, opening
 * status with its expiry) and a fixed list of general safety tips. It never
 * invents a place, a status or a route — routes come from the normal router
 * when the visitor taps "Show the way". No external AI service is used.
 */
import { normalizeText, opStatus, type OpStatus } from "./placeInfo";
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
const SAFETY_WORDS = ["safety", "safe", "tips", "rules", "advice", "crowd", "stampede", "सुरक्षा", "सूचना", "नियम", "सलाह", "सल्ला", "गर्दी", "भीड़"];

/** General tips (not official instructions); keys in i18n `ask.tip.*`. Version them with the app. */
export const SAFETY_TIPS = ["meet", "phone", "children", "barricades", "water", "deep", "help"] as const;
export const SAFETY_TIPS_VERSION = "2026-10-30";

export type PlaceHit = { node: QrNode; distanceM: number | null; status: OpStatus; fieldChecked: boolean };

export type Answer =
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

/** A place named in the question (longest name wins), from the saved data only. */
function namedPlace(q: string, places: QrNode[]): QrNode | null {
  let best: QrNode | null = null;
  let bestLen = 0;
  for (const p of places) {
    for (const name of [p.name, p.local_name ?? ""]) {
      const n = normalizeText(name);
      if (n.length >= 4 && q.includes(n) && n.length > bestLen) {
        best = p;
        bestLen = n.length;
      }
    }
  }
  return best;
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
      if (a.distanceM != null && b.distanceM != null && Math.abs(a.distanceM - b.distanceM) > 50)
        return a.distanceM - b.distanceM;
      return Number(b.fieldChecked) - Number(a.fieldChecked) || (a.distanceM ?? 0) - (b.distanceM ?? 0);
    });
  if (candidates.length === 0) return { kind: "none", topic };
  const top = candidates.slice(0, 3);
  return { kind: "nearest", topic, places: top, anyFieldChecked: top.some((h) => h.fieldChecked) };
}
