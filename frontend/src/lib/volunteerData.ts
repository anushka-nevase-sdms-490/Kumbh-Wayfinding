/**
 * Places and lanes for the volunteer screens: from the server when online,
 * otherwise from the copy saved on this phone (so volunteers can keep working
 * without internet; their changes wait in lib/outbox.ts).
 */
import { authFetch } from "./auth";
import { loadStoredPack } from "./packStore";
import type { GraphEdge, QrNode } from "./types";

export type VolunteerData = { nodes: QrNode[]; edges: GraphEdge[]; fromPhone: boolean };

export async function loadVolunteerData(apiBase: string, allEdges = false): Promise<VolunteerData | null> {
  try {
    const res = await fetch(`${apiBase}/api/pack/latest/json`);
    if (res.ok) {
      const data = (await res.json()) as { nodes?: QrNode[]; edges?: GraphEdge[] };
      let edges = data.edges ?? [];
      // The pack leaves out blocked/closed lanes; the full list lets them be reopened.
      if (allEdges) {
        try {
          // Every lane in the database: staff only (visitors get the published pack).
          const er = await authFetch(`${apiBase}/api/edges`);
          if (er.ok) edges = (await er.json()) as GraphEdge[];
        } catch {
          /* use pack lanes */
        }
      }
      return { nodes: sortByName(data.nodes ?? []), edges, fromPhone: false };
    }
  } catch {
    /* offline: use the saved copy */
  }
  const saved = await loadStoredPack();
  if (saved.kind !== "ok") return null;
  return { nodes: sortByName(saved.stored.pack.nodes), edges: saved.stored.pack.edges, fromPhone: true };
}

function sortByName(nodes: QrNode[]): QrNode[] {
  return [...nodes].sort((a, b) => a.name.localeCompare(b.name));
}
