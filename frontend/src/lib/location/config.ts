/**
 * Simulation exists only in development builds (`npm run dev`), or in a build
 * made with VITE_ENABLE_SIMULATION=1 for testing. In a normal production
 * build this is the constant `false`, so the simulation code is left out.
 */
export const SIMULATION_ALLOWED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_SIMULATION === "1";

const KEY = "setu-sim";

/** The developer asked for it: ?sim=1 in the URL (kept for this tab), ?sim=0 turns it off. */
export function simulationRequested(): boolean {
  if (!SIMULATION_ALLOWED || typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("sim");
    if (q === "1") sessionStorage.setItem(KEY, "1");
    if (q === "0") sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return new URLSearchParams(window.location.search).get("sim") === "1";
  }
}

export function leaveSimulation(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
