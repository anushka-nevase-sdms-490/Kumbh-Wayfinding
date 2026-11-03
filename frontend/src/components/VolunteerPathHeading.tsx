import { useEffect, useMemo, useState } from "react";
import { useDeviceHeading } from "../hooks/useDeviceHeading";
import { isRegisteredLocation, type GraphEdge, type QrNode } from "../lib/types";
import { authSender, sendOrQueue } from "../lib/outbox";
import { loadVolunteerData } from "../lib/volunteerData";
import { useI18n } from "../i18n/context";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onBack: () => void;
  onSaved: () => void;
};

/**
 * Capture real walk compass heading on an existing board↔board link so the
 * guide arrow follows the corridor — not the straight GPS line through desks.
 */
export function VolunteerPathHeading({ apiBase, onBack, onSaved }: Props) {
  const heading = useDeviceHeading();
  const { t, placeLabel } = useI18n();
  const [nodes, setNodes] = useState<QrNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [laneKey, setLaneKey] = useState("");
  // Which end of the lane the volunteer stands at; they face the other end.
  const [standAtA, setStandAtA] = useState(true);
  const [captured, setCaptured] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadVolunteerData(apiBase);
        if (data && !cancelled) {
          setNodes(data.nodes);
          setEdges(data.edges);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  // The Devanagari name in Hindi/Marathi when the place has one.
  const nameOf = (code: string) => {
    const n = nodes.find((x) => x.code.toUpperCase() === code.toUpperCase());
    return n ? placeLabel(n) : code;
  };

  const linkedPairs = useMemo(() => {
    // Volunteer lanes between real places (map roads have thousands of hidden junctions).
    const codes = new Set(nodes.filter(isRegisteredLocation).map((n) => n.code.toUpperCase()));
    const pairs: { key: string; a: string; b: string; hasHeading: boolean }[] = [];
    for (const e of edges) {
      if (e.source === "osm") continue;
      const A = e.from_code.toUpperCase();
      const B = e.to_code.toUpperCase();
      if (!codes.has(A) || !codes.has(B)) continue;
      pairs.push({
        key: `${A}|${B}`,
        a: e.from_code,
        b: e.to_code,
        hasHeading:
          typeof e.heading_ab === "number" && typeof e.heading_ba === "number",
      });
    }
    return pairs;
  }, [edges, nodes]);

  const lane = linkedPairs.find((p) => p.key === laneKey) ?? null;
  // API naming: to_code = board you stand at, from_code = board you face.
  const toCode = lane ? (standAtA ? lane.a : lane.b) : "";
  const fromCode = lane ? (standAtA ? lane.b : lane.a) : "";

  async function save() {
    setErr(null);
    setMsg(null);
    if (!lane) {
      setErr(t("vol.chooseLaneFirst"));
      return;
    }
    if (captured == null) {
      setErr(t("vol.heading.captureFirst"));
      return;
    }
    setBusy(true);
    try {
      const r = await sendOrQueue(
        "/api/volunteer/path-heading",
        { from_code: fromCode, to_code: toCode, path_heading_deg: captured },
        {
          label: `Walk direction ${nameOf(toCode)} → ${nameOf(fromCode)}`,
          labelKey: "vol.label.heading",
          labelVars: { from: nameOf(toCode), to: nameOf(fromCode) },
        },
        authSender(apiBase)
      );
      if (r.kind === "refused") {
        setErr(r.message);
        return;
      }
      if (r.kind === "queued") {
        setMsg(t("vol.queued"));
        return;
      }
      setMsg(
        t("vol.heading.saved", { from: nameOf(toCode), to: nameOf(fromCode), deg: captured.toFixed(0) })
      );
      onSaved();
    } catch {
      setErr(t("vol.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label={t("vol.back")}>
          ←
        </button>
        <div>
          <h2>{t("vol.heading.title")}</h2>
          <p>{t("vol.heading.subtitle")}</p>
        </div>
      </header>

      {loaded && linkedPairs.length === 0 ? (
        <div className="empty-state">
          <strong>{t("vol.noLanesTitle")}</strong>
          <p>{t("vol.noLanesBody")}</p>
        </div>
      ) : (
      <div className="volunteer-form">
        <p className="field-hint">{t("vol.heading.intro")}</p>

        <label>
          {t("vol.lane")}
          <select
            value={laneKey}
            onChange={(e) => {
              setLaneKey(e.target.value);
              setStandAtA(true);
              setCaptured(null);
              setMsg(null);
            }}
          >
            <option value="" disabled>
              {t("vol.chooseLane")}
            </option>
            {linkedPairs.map((p) => (
              <option key={p.key} value={p.key}>
                {nameOf(p.a)} ↔ {nameOf(p.b)}
                {p.hasHeading ? " ✓" : ""}
              </option>
            ))}
          </select>
        </label>

        {lane && (
          <label>
            {t("vol.heading.standingAt")}
            <select
              value={standAtA ? "a" : "b"}
              onChange={(e) => {
                setStandAtA(e.target.value === "a");
                setCaptured(null);
                setMsg(null);
              }}
            >
              <option value="a">{nameOf(lane.a)}</option>
              <option value="b">{nameOf(lane.b)}</option>
            </select>
            <span className="field-hint">{t("vol.heading.faceToward", { place: nameOf(fromCode) })}</span>
          </label>
        )}

        <div className="coord-block">
          <p className="section-label">{t("vol.heading.compass")}</p>
          <p className="gps-status">
            {t("vol.heading.live", { deg: heading.heading.toFixed(0), note: heading.note })}
          </p>
          {!heading.secure && (
            <p className="gps-status err">{t("vol.heading.needHttps")}</p>
          )}
          <button
            type="button"
            className="btn soft block"
            onClick={() => void heading.requestPermission()}
          >
            {t("vol.enableCompass")}
          </button>
          <button
            type="button"
            className="btn secondary block"
            // No compass reading yet: the heading would be a meaningless 0° (north),
            // and visitors' turn directions are built from it.
            disabled={!heading.live}
            onClick={() => {
              if (!heading.live) return;
              setCaptured(Math.round(heading.heading * 10) / 10);
              setMsg(null);
              setErr(null);
            }}
          >
            {t("vol.heading.capture", { deg: heading.heading.toFixed(0) })}
          </button>
          {captured != null && (
            <p className="gps-status ok">
              {t("vol.heading.captured", { deg: captured.toFixed(0), from: nameOf(toCode), to: nameOf(fromCode) })}
            </p>
          )}
        </div>

        {err && <p className="gps-status err">{err}</p>}
        {msg && <p className="gps-status ok">{msg}</p>}

        <button
          type="button"
          className="btn primary block"
          disabled={busy || captured == null || !lane}
          onClick={() => void save()}
        >
          {busy ? t("vol.saving") : t("vol.heading.save")}
        </button>

        <p className="field-hint">{t("vol.heading.cornerHint")}</p>
      </div>
      )}
    </section>
  );
}
