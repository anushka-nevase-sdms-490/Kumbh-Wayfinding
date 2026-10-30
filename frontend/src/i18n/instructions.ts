/** Turn-by-turn wording in the visitor's language (from router fields, not its English text). */
import type { PathInstruction } from "../lib/router";
import { formatDist, translate, type Lang } from "./messages";

/** "Turn right onto MG Road" / "उजवीकडे MG Road वर वळा". */
export function turnText(lang: Lang, ins: PathInstruction): string {
  if (ins.turn === "around") return translate(lang, "turn.around");
  const side = ins.turn ?? (ins.kind === "left" ? "left" : "right");
  if (ins.street) {
    return translate(lang, side === "left" ? "turn.leftOnto" : "turn.rightOnto", {
      street: ins.street,
    });
  }
  return translate(lang, side === "left" ? "turn.left" : "turn.right");
}

/** Main line and small line of one instruction; `placeName` names a place by code. */
export function instructionLines(
  lang: Lang,
  ins: PathInstruction,
  placeName: (code: string) => string
): { text: string; detail: string } {
  const name = ins.toCode ? placeName(ins.toCode) : ins.detail;
  const dist = formatDist(lang, Math.max(1, ins.distanceM));
  const toward = ins.street
    ? translate(lang, "ins.alongToward", { street: ins.street, name })
    : translate(lang, "ins.toward", { name });
  if (ins.kind === "arrive") return { text: translate(lang, "ins.arrive"), detail: name };
  if (ins.kind === "straight") {
    return { text: translate(lang, ins.first ? "ins.start" : "ins.continue", { dist }), detail: toward };
  }
  return {
    text: turnText(lang, ins),
    detail:
      ins.turn === "around" ? toward : translate(lang, "ins.thenToward", { dist, name }),
  };
}
