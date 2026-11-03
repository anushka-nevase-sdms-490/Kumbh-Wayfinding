import { useEffect, useMemo, useState } from "react";
import { formatDistance } from "../lib/nearest";
import { haversineM, isRegisteredLocation, type GraphEdge, type QrNode } from "../lib/types";
import { authSender, sendOrQueue } from "../lib/outbox";
import { loadVolunteerData } from "../lib/volunteerData";
import { VisitorReports } from "./VisitorReports";
import { useI18n } from "../i18n/context";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onBack: () => void;
  onSaved: () => void;
};

/** Volunteer marks corridors blocked / doors closed so A* never routes through them. */
export function VolunteerObstacle({ apiBase, onBack, onSaved }: Props) {
  const { t, placeLabel } = useI18n();
  const [nodes, setNodes] = useState<QrNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [laneKey, setLaneKey] = useState("");
  const [blocked, setBlocked] = useState(true);
  const [doorState, setDoorState] = useState("none");
  const [passageKind, setPassageKind] = useState("corridor");
  const [note, setNote] = useState("");
  /** Hours until the block ends by itself; 0 = until a volunteer reopens it. */
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Bumped after a saved change, so the list shows the lane's new state (no stale "✕ blocked").
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadVolunteerData(apiBase, true);
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
  }, [apiBase, reloadKey]);

  // The Devanagari name in Hindi/Marathi when the place has one.
  const nameOf = (code: string) => {
    const n = nodes.find((x) => x.code.toUpperCase() === code.toUpperCase());
    return n ? placeLabel(n) : code;
  };

  // Every known lane between registered boards, including blocked ones (✕) so
  // they can be reopened.
  const lanes = useMemo(() => {
    // Volunteer lanes between real places (map roads have thousands of hidden
    // junctions), plus any map-road lane that is closed now — e.g. a visitor's
    // report a volunteer confirmed — so it can be reopened here too.
    const places = nodes.filter(isRegisteredLocation);
    const codes = new Set(places.map((n) => n.code.toUpperCase()));
    const byCode = new Map(nodes.map((n) => [n.code.toUpperCase(), n]));
    // A map road joins hidden junctions: its street name and the nearest named place say where it is.
    const mapRoadName = (e: GraphEdge) => {
      const a = byCode.get(e.from_code.toUpperCase());
      const b = byCode.get(e.to_code.toUpperCase());
      let near = "";
      if (a && b) {
        const lat = (a.lat + b.lat) / 2;
        const lon = (a.lon + b.lon) / 2;
        const best = places
          .map((n) => [n, haversineM(lat, lon, n.lat, n.lon)] as const)
          .sort((x, y) => x[1] - y[1])[0];
        if (best) near = t("vol.obstacle.near", { place: placeLabel(best[0]), dist: formatDistance(best[1]) });
      }
      return [e.name || t("vol.obstacle.mapRoad"), near, `#${e.id}`].filter(Boolean).join(" · ");
    };
    // A "wall" lane is impassable on phones too (lib/router.ts), so it counts as closed.
    const isClosed = (e: (typeof edges)[number]) =>
      !!e.blocked || e.door_state === "closed" || e.walkable === false ||
      ["wall", "glass_wall"].includes((e.passage_kind ?? "").toLowerCase());
    return edges
      .filter(
        (e) =>
          (e.source !== "osm" && codes.has(e.from_code.toUpperCase()) && codes.has(e.to_code.toUpperCase())) ||
          (e.source === "osm" && isClosed(e))
      )
      .map((e) => ({
        key: `${e.from_code.toUpperCase()}|${e.to_code.toUpperCase()}|${e.id}`,
        id: e.id,
        a: e.from_code,
        b: e.to_code,
        closed: isClosed(e),
        mapRoad: e.source === "osm" ? mapRoadName(e) : null,
      }));
  }, [edges, nodes, t, placeLabel]);

  const lane = lanes.find((l) => l.key === laneKey) ?? null;
  // One name for the lane in messages and the queue: map roads have no place names at their ends.
  const laneText = lane ? (lane.mapRoad ?? `${nameOf(lane.a)} ↔ ${nameOf(lane.b)}`) : "";
  const fromCode = lane?.a ?? "";
  const toCode = lane?.b ?? "";

  async function save() {
    setErr(null);
    setMsg(null);
    if (!lane) {
      setErr(t("vol.chooseLaneFirst"));
      return;
    }
    setBusy(true);
    try {
      const closing = blocked || doorState === "closed";
      const r = await sendOrQueue(
        "/api/volunteer/edge-status",
        {
          from_code: fromCode,
          to_code: toCode,
          lane_id: lane?.id,
          blocked,
          door_state: doorState,
          passage_kind: passageKind,
          obstacle_note: note.trim() || null,
          hours: blocked && hours > 0 ? hours : null,
          walkable:
            blocked ||
            doorState === "closed" ||
            passageKind === "glass_wall" ||
            passageKind === "wall"
              ? false
              : true,
        },
        {
          label: `${closing ? "Block" : "Update"} ${laneText}`,
          labelKey: closing ? "vol.label.blockLane" : "vol.label.updateLane",
          labelVars: { lane: laneText },
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
      setMsg(t(closing ? "vol.obstacle.removedLane" : "vol.obstacle.reopenedLane", { lane: laneText }));
      setReloadKey((k) => k + 1);
      onSaved();
    } catch {
      setErr(t("vol.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!lane) {
      setErr(t("vol.chooseLaneFirst"));
      return;
    }
    setBlocked(false);
    setDoorState("open");
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await sendOrQueue(
        "/api/volunteer/edge-status",
        {
          from_code: fromCode,
          to_code: toCode,
          lane_id: lane?.id,
          blocked: false,
          door_state: doorState === "closed" ? "open" : doorState,
          walkable: true,
          obstacle_note: null,
        },
        {
          label: `Reopen ${laneText}`,
          labelKey: "vol.label.reopenLane",
          labelVars: { lane: laneText },
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
      setMsg(t("vol.obstacle.reopenedLane", { lane: laneText }));
      setReloadKey((k) => k + 1);
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
          <h2>{t("vol.obstacle.title")}</h2>
          <p>{t("vol.obstacle.subtitle")}</p>
        </div>
      </header>

      <VisitorReports
        apiBase={apiBase}
        onSaved={() => {
          // A confirmed report closes a lane: show it in the list below (to reopen later).
          setReloadKey((k) => k + 1);
          onSaved();
        }}
      />

      {loaded && lanes.length === 0 ? (
        <>
          {/* The lane just reopened leaves the list: its confirmation still shows. */}
          {msg && <p className="gps-status ok">{msg}</p>}
          <div className="empty-state">
            <strong>{t("vol.noLanesTitle")}</strong>
            <p>{t("vol.noLanesBody")}</p>
          </div>
        </>
      ) : (
      <div className="volunteer-form">
        <p className="field-hint">{t("vol.obstacle.intro")}</p>

        <label>
          {t("vol.lane")}
          <select value={laneKey} onChange={(e) => setLaneKey(e.target.value)}>
            <option value="" disabled>
              {t("vol.chooseLane")}
            </option>
            {lanes.map((l) => (
              <option key={l.key} value={l.key}>
                {l.mapRoad ?? `${nameOf(l.a)} ↔ ${nameOf(l.b)}`}
                {l.closed ? t("vol.obstacle.blockedTag") : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("vol.obstacle.type")}
          <select
            value={passageKind}
            onChange={(e) => setPassageKind(e.target.value)}
          >
            <option value="corridor">{t("vol.obstacle.kind.corridor")}</option>
            <option value="door">{t("vol.obstacle.kind.door")}</option>
            <option value="wall">{t("vol.obstacle.kind.wall")}</option>
            <option value="passage">{t("vol.obstacle.kind.passage")}</option>
          </select>
        </label>

        <label>
          {t("vol.obstacle.door")}
          <select
            value={doorState}
            onChange={(e) => setDoorState(e.target.value)}
          >
            <option value="none">{t("vol.obstacle.door.none")}</option>
            <option value="open">{t("vol.obstacle.door.open")}</option>
            <option value="closed">{t("vol.obstacle.door.closed")}</option>
            <option value="unknown">{t("vol.obstacle.door.unknown")}</option>
          </select>
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={blocked}
            onChange={(e) => setBlocked(e.target.checked)}
          />
          {t("vol.obstacle.blocked")}
        </label>

        {blocked && (
          <label>
            {t("vol.obstacle.for")}
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              <option value={1}>{t("vol.obstacle.h1")}</option>
              <option value={4}>{t("vol.obstacle.h4")}</option>
              <option value={12}>{t("vol.obstacle.h12")}</option>
              <option value={0}>{t("vol.obstacle.untilReopen")}</option>
            </select>
          </label>
        )}

        <label>
          {t("vol.obstacle.note")}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("vol.obstacle.notePlaceholder")}
            maxLength={64}
          />
        </label>

        {err && <p className="gps-status err">{err}</p>}
        {msg && <p className="gps-status ok">{msg}</p>}

        <button
          type="button"
          className="btn primary block"
          disabled={busy || !lane}
          onClick={() => void save()}
        >
          {busy ? t("vol.saving") : t("vol.obstacle.save")}
        </button>
        <button
          type="button"
          className="btn soft block"
          disabled={busy || !lane}
          onClick={() => void reopen()}
        >
          {t("vol.obstacle.reopen")}
        </button>
      </div>
      )}
    </section>
  );
}
