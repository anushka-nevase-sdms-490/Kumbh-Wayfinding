import { useState } from "react";
import { parseReport, type ParsedReport, type ReportFields } from "../lib/reportParser";
import type { QrNode } from "../lib/types";
import "./Volunteer.css";

type Props = { places: QrNode[]; apply: (fields: ReportFields) => void };

/**
 * "Paste what the reporter said": suggested case fields (rule-based, offline)
 * that the operator ticks and applies, plus the questions still worth asking.
 */
export function ReportHelper({ places, apply }: Props) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedReport | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  return (
    <div className="report-helper">
      <label>
        What the reporter said (optional helper)
        <textarea
          rows={2}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. my son Ravi, 8 years, blue shirt, last seen near Ramkund at 3 pm, speaks Marathi"
        />
      </label>
      <div className="report-actions">
        <button
          type="button"
          className="btn soft"
          disabled={!text.trim()}
          onClick={() => {
            const p = parseReport(text, places);
            setParsed(p);
            setPicked(new Set(p.suggestions.map((_, i) => i)));
          }}
        >
          Suggest fields
        </button>
      </div>
      {parsed && (
        <>
          {parsed.suggestions.length === 0 ? (
            <small>Nothing recognised — fill the fields by hand.</small>
          ) : (
            <ul className="suggestions">
              {parsed.suggestions.map((s, i) => (
                <li key={i}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        setPicked(next);
                      }}
                    />
                    {s.label} <small>(from “{s.from}”)</small>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {parsed.suggestions.length > 0 && (
            <button
              type="button"
              className="btn soft"
              onClick={() => {
                const fields: ReportFields = {};
                parsed.suggestions.forEach((s, i) => {
                  if (picked.has(i)) fields[s.field] = s.value;
                });
                apply(fields);
              }}
            >
              Use ticked suggestions
            </button>
          )}
          {parsed.questions.length > 0 && (
            <div>
              <small>
                <strong>Still to ask:</strong>
              </small>
              <ul className="suggestions">
                {parsed.questions.map((q) => (
                  <li key={q}>
                    <small>{q}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <small>Suggestions only — check each one with the reporter. Nothing is saved until you open the case.</small>
        </>
      )}
    </div>
  );
}
