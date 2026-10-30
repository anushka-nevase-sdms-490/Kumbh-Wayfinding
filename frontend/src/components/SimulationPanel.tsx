/**
 * Development-only Nashik simulation (see docs/NASHIK_SIMULATION_MODE.md):
 * a simulated visitor walks the app's real route, so navigation can be
 * tested from anywhere. Loaded only when the build allows simulation and
 * the developer opened the app with ?sim=1 — never for normal visitors.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { leaveSimulation } from "../lib/location/config";
import { SimulationLocationProvider } from "../lib/location/simulation";
import { pathLength, WALK_SPEED_MPS, type LonLat } from "../lib/location/simulationWalk";
import { formatDistance } from "../lib/nearest";
import type { QrNode } from "../lib/types";
import "./SimulationPanel.css";

type Props = {
  /** Where the simulated visitor stands at first ([lon, lat]). */
  start: LonLat;
  /** The app's current route line from the current place (empty: no route yet). */
  route: LonLat[];
  /** Changes whenever the route changes (reroute, next place). */
  routeKey: string;
  places: QrNode[];
  picking: boolean;
  onPickingChange: (on: boolean) => void;
  /** Hands the provider to the app (null when the panel goes away). */
  onProvider: (p: SimulationLocationProvider | null) => void;
  /** Volunteer screens: walk from where the simulated volunteer stands to a place (real lanes). */
  routeTo?: (from: { lat: number; lon: number }, code: string) => LonLat[];
};

const SPEEDS = [1, 2, 5, 10];

export default function SimulationPanel({
  start,
  route,
  routeKey,
  places,
  picking,
  onPickingChange,
  onProvider,
  routeTo,
}: Props) {
  const [sim] = useState(() => new SimulationLocationProvider({ lat: start[1], lon: start[0] }));
  const [open, setOpen] = useState(true);
  const [walkNote, setWalkNote] = useState<string | null>(null);
  const state = useSyncExternalStore(sim.subscribe, sim.getState);

  useEffect(() => {
    onProvider(sim);
    return () => {
      onProvider(null);
      sim.dispose();
    };
  }, [sim, onProvider]);

  // The route moved on (next place) or changed (reroute): keep walking along it.
  useEffect(() => {
    if (route.length >= 2) sim.followRoute(route);
    // routeKey stands in for route (a new array on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, sim]);

  const total = pathLength(state.path);
  const left = Math.max(0, total - state.along);
  const speed = WALK_SPEED_MPS * state.speedX;
  const walking = state.path.length >= 2;
  const fix = sim.getLastFix();

  return (
    <>
      <div className="sim-banner" role="status">
        SIMULATION MODE — positions are simulated, not this phone's GPS
      </div>
      <aside className={`sim-panel ${open ? "" : "closed"}`} aria-label="Simulation controls">
        <button type="button" className="sim-toggle" onClick={() => setOpen(!open)}>
          {open ? "▾ Simulation" : "▸ Simulation"}
        </button>
        {open && (
          <div className="sim-body">
            <p className="sim-line">
              <strong>Position</strong> {state.pos.lat.toFixed(6)}, {state.pos.lon.toFixed(6)}
              {fix ? ` · reported ±${Math.round(fix.accuracyM)} m` : ""}
              {state.lost ? " · signal lost" : ""}
            </p>
            {walking ? (
              <p className="sim-line">
                <strong>{state.arrived ? "End of route" : state.offRoute ? "Off route" : state.playing ? "Walking" : "Paused"}</strong>{" "}
                {formatDistance(state.along)} of {formatDistance(total)} · {formatDistance(left)} left · ~
                {Math.max(1, Math.ceil(left / speed / 60))} min at {state.speedX}×
              </p>
            ) : (
              <p className="sim-line">
                Standing still. Pick a start and destination in the app, open the guide, then press Start.
              </p>
            )}

            <div className="sim-row">
              <button
                type="button"
                disabled={route.length < 2}
                title={route.length < 2 ? "Open the guide for a route first" : "Walk the route from its start"}
                onClick={() => sim.walk(route)}
              >
                ▶ Start
              </button>
              {walking && !state.arrived && (
                <button type="button" onClick={() => (state.playing ? sim.pause() : sim.play())}>
                  {state.playing ? "❚❚ Pause" : "▶ Resume"}
                </button>
              )}
              <button type="button" onClick={() => sim.reset()}>
                ↺ Reset
              </button>
              <select
                aria-label="Speed"
                value={state.speedX}
                onChange={(e) => sim.setSpeed(Number(e.target.value))}
              >
                {SPEEDS.map((x) => (
                  <option key={x} value={x}>
                    {x}× {x === 1 ? "(walk)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="sim-row">
              <button
                type="button"
                className={picking ? "on" : ""}
                onClick={() => onPickingChange(!picking)}
              >
                {picking ? "Tap the map…" : "📍 Place me on map"}
              </button>
              <select
                aria-label="Place me at a place"
                value=""
                onChange={(e) => {
                  const p = places.find((x) => x.code === e.target.value);
                  if (p) sim.placeAt(p.lat, p.lon);
                }}
              >
                <option value="">Place me at…</option>
                {places.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {routeTo && (
              <div className="sim-row">
                <select
                  aria-label="Walk to a place"
                  value=""
                  onChange={(e) => {
                    const r = routeTo(state.pos, e.target.value);
                    setWalkNote(r.length >= 2 ? null : "No route there from here (place yourself at a place first)");
                    if (r.length >= 2) sim.walk(r);
                  }}
                >
                  <option value="">Walk to…</option>
                  {places.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {walkNote && <span>{walkNote}</span>}
              </div>
            )}

            <label className="sim-row">
              GPS ±{state.accuracyM} m
              <input
                type="range"
                min={3}
                max={80}
                value={state.accuracyM}
                onChange={(e) => sim.setAccuracy(Number(e.target.value))}
              />
            </label>

            <div className="sim-row">
              <label>
                <input type="checkbox" checked={state.noise} onChange={(e) => sim.setNoise(e.target.checked)} /> Noise
              </label>
              <button type="button" onClick={() => sim.jump()}>
                ⚡ GPS jump
              </button>
              <button type="button" className={state.offRoute ? "on" : ""} onClick={() => sim.setOffRoute(!state.offRoute)} disabled={!walking}>
                {state.offRoute ? "↩ Back to route" : "↗ Walk off route"}
              </button>
              <button type="button" className={state.lost ? "on" : ""} onClick={() => sim.setLost(!state.lost)}>
                {state.lost ? "📶 Signal back" : "🚫 Lose signal"}
              </button>
            </div>

            <button
              type="button"
              className="sim-exit"
              onClick={() => {
                leaveSimulation();
                // Reload without ?sim=1: back to the phone's real GPS.
                window.location.href = window.location.pathname;
              }}
            >
              Exit simulation (back to real GPS)
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
