import { useCallback, useEffect, useRef, useState } from "react";
import { useDeviceHeading } from "../hooks/useDeviceHeading";
import type { QrNode } from "../lib/types";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onBack: () => void;
  onSaved: () => void;
};

type Waypoint = {
  lat: number;
  lon: number;
  heading_deg: number;
  t_ms: number;
};

type Phase = "setup" | "recording" | "saving" | "done";

/**
 * Volunteer walks the real corridor once. We record GPS + compass samples and
 * save a verified walkable edge (around desks/glass — not a straight GPS line).
 */
export function VolunteerRecordPath({ apiBase, onBack, onSaved }: Props) {
  const heading = useDeviceHeading();
  const [nodes, setNodes] = useState<QrNode[]>([]);
  const [fromCode, setFromCode] = useState("");
  const [toCode, setToCode] = useState("");
  const [phase, setPhase] = useState<Phase>("setup");
  const [points, setPoints] = useState<Waypoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);
  const headingRef = useRef(heading.heading);
  headingRef.current = heading.heading;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/pack/latest/json`);
        if (!res.ok) return;
        const data = (await res.json()) as { nodes?: QrNode[] };
        const list = (data.nodes ?? [])
          .filter((n) => /^KUMBH-A/i.test(n.code))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) {
          setNodes(list);
          if (list.length >= 2) {
            setFromCode(list[0].code);
            setToCode(list[1].code);
          } else if (list.length === 1) {
            setFromCode(list[0].code);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  useEffect(() => () => stopWatch(), [stopWatch]);

  const nameOf = (code: string) =>
    nodes.find((n) => n.code.toUpperCase() === code.toUpperCase())?.name ??
    code;

  function startRecording() {
    setErr(null);
    setMsg(null);
    if (!fromCode || !toCode || fromCode === toCode) {
      setErr("Pick two different registered boards (start and end).");
      return;
    }
    if (!navigator.geolocation) {
      setErr("GPS is required to record a walk.");
      return;
    }
    if (!window.isSecureContext) {
      setErr("Open the HTTPS (ngrok) link so GPS and compass work.");
      return;
    }
    void heading.requestPermission();
    setPoints([]);
    setPhase("recording");

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next: Waypoint = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          heading_deg: headingRef.current,
          t_ms: Date.now(),
        };
        setPoints((prev) => {
          if (prev.length === 0) return [next];
          const last = prev[prev.length - 1];
          // ~1.5 m or 2 s between samples — keep path light for offline pack.
          const dt = next.t_ms - last.t_ms;
          const moved =
            Math.hypot(
              (next.lat - last.lat) * 111320,
              (next.lon - last.lon) *
                111320 *
                Math.cos((next.lat * Math.PI) / 180)
            ) > 1.5;
          if (dt < 2000 && !moved) return prev;
          return [...prev, next];
        });
      },
      (e) => {
        setErr(
          e.code === e.PERMISSION_DENIED
            ? "Allow location to record the walk."
            : `GPS error: ${e.message}`
        );
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  async function finishAndSave() {
    setErr(null);
    if (points.length < 2) {
      setErr("Walk a bit farther so at least 2 GPS points are recorded.");
      return;
    }
    stopWatch();
    setPhase("saving");
    try {
      const res = await fetch(`${apiBase}/api/volunteer/record-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_code: fromCode,
          to_code: toCode,
          waypoints: points,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase("recording");
        setErr(
          typeof data?.detail === "string"
            ? data.detail
            : "Could not save verified path"
        );
        return;
      }
      setMsg(
        `Verified path saved: ${nameOf(fromCode)} → ${nameOf(toCode)} · ${Math.round(
          data.distance_m ?? 0
        )} m · ${data.waypoint_count} samples`
      );
      setPhase("done");
      onSaved();
    } catch (e) {
      setPhase("recording");
      setErr(e instanceof Error ? e.message : "Network error");
    }
  }

  function cancelRecording() {
    stopWatch();
    setPoints([]);
    setPhase("setup");
    setErr(null);
  }

  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <h2>Record verified path</h2>
          <p>Walk the real route once — system saves it as walkable</p>
        </div>
      </header>

      <div className="volunteer-form">
        {phase === "setup" && (
          <>
            <p className="field-hint">
              Stand at the start board, choose start → end, then walk the
              corridor around desks/glass. When you reach the end board, stop
              recording. That walk becomes the official offline path.
            </p>
            <label>
              Start board
              <select
                value={fromCode}
                onChange={(e) => setFromCode(e.target.value)}
              >
                {nodes.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.name} — {n.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              End board
              <select value={toCode} onChange={(e) => setToCode(e.target.value)}>
                {nodes.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.name} — {n.code}
                  </option>
                ))}
              </select>
            </label>
            <p className="gps-status">
              Compass: {heading.heading.toFixed(0)}° · {heading.note}
            </p>
            <button
              type="button"
              className="btn soft block"
              onClick={() => void heading.requestPermission()}
            >
              Enable compass / gyroscope
            </button>
            <button
              type="button"
              className="btn primary block"
              onClick={startRecording}
              disabled={nodes.length < 2}
            >
              Start walking & record
            </button>
            {nodes.length < 2 && (
              <p className="gps-status err">
                Register at least 2 boards before recording a path.
              </p>
            )}
          </>
        )}

        {phase === "recording" && (
          <>
            <p className="gps-status ok">
              Recording… walk from <strong>{nameOf(fromCode)}</strong> to{" "}
              <strong>{nameOf(toCode)}</strong>
            </p>
            <p className="gps-status">
              Samples: {points.length} · live heading{" "}
              {heading.heading.toFixed(0)}°
            </p>
            <p className="field-hint">
              Keep the phone facing the way you walk. Do not cut through
              desks/glass — follow the real corridor.
            </p>
            <button
              type="button"
              className="btn primary block"
              onClick={() => void finishAndSave()}
            >
              Arrived at end — save verified path
            </button>
            <button
              type="button"
              className="btn soft block"
              onClick={cancelRecording}
            >
              Cancel
            </button>
          </>
        )}

        {phase === "saving" && (
          <p className="gps-status">Saving verified path…</p>
        )}

        {phase === "done" && (
          <>
            <p className="gps-status ok">{msg}</p>
            <p className="field-hint">
              Users will now route on this walked path (A* uses the verified
              link + walk headings), not a straight line through obstacles.
            </p>
            <button type="button" className="btn primary block" onClick={onBack}>
              Done
            </button>
            <button
              type="button"
              className="btn soft block"
              onClick={() => {
                setPhase("setup");
                setPoints([]);
                setMsg(null);
              }}
            >
              Record another path
            </button>
          </>
        )}

        {err && <p className="gps-status err">{err}</p>}
      </div>
    </section>
  );
}
