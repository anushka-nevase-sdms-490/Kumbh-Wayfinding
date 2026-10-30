import { useState } from "react";
import { useI18n } from "../i18n/context";
import { resolveBoard } from "../lib/placeInfo";
import type { QrNode } from "../lib/types";

type Props = {
  nodes: QrNode[];
  onFound: (node: QrNode, boardCode: string | null) => void;
  /** A valid code not in the saved data: the app checks for newer data when online. */
  onUnknown: () => void;
};

/**
 * "Code on a Setu board": the printed code is looked up in the data saved on
 * the phone, so it works without internet (and without a camera).
 */
export function BoardCodeEntry({ nodes, onFound, onUnknown }: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = resolveBoard(nodes, value);
    if (r.kind === "found") {
      setMsg(null);
      onFound(r.node, r.boardCode);
    } else if (r.kind === "unknown") {
      setMsg(t("board.unknown", { code: r.code }));
      onUnknown();
    } else {
      setMsg(t("board.invalid"));
    }
  }

  return (
    <form className="board-entry" onSubmit={submit}>
      <label htmlFor="board-code">{t("board.label")}</label>
      <p className="gps-note">{t("board.hint")}</p>
      <div className="board-row">
        <input
          id="board-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("board.placeholder")}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
        />
        <button type="submit" className="btn primary" disabled={!value.trim()}>
          {t("board.go")}
        </button>
      </div>
      {msg && (
        <p className="gps-status err" role="alert">
          {msg}
        </p>
      )}
    </form>
  );
}
