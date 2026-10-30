/**
 * Download the offline basemap for the Kumbh area into public/map/.
 *
 * Tiles come from a Protomaps OpenStreetMap build (vector, zoom 0–15) and are
 * written as plain files public/map/tiles/{z}/{x}/{y}.mvt, so the app (and
 * later the service worker) serves them like any other static asset — no map
 * server and no internet at runtime. Fonts and sprites for the style are
 * copied next to them.
 *
 * Run: npm run map:fetch            (pinned build below)
 *      npx --yes tsx scripts/fetchOfflineMap.ts latest|YYYYMMDD
 */
import fs from "fs";
import path from "path";
import { PMTiles } from "pmtiles";
import { BASEMAP_MAX_ZOOM, KUMBH_BOUNDS } from "../src/lib/mapArea";

const MAX_ZOOM = BASEMAP_MAX_ZOOM;
// Pinned so re-running gives the same map. Bump deliberately to refresh.
const PINNED_BUILD = "20261029";
const CONCURRENCY = 8;

const ASSETS = "https://protomaps.github.io/basemaps-assets";
const FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
// Latin, Latin-ext, Devanagari, Latin Extended Additional (ṭ ṇ …), punctuation.
const GLYPH_RANGES = ["0-255", "256-511", "2304-2559", "7680-7935", "8192-8447"];
// Hindi/Marathi map labels: the style draws Devanagari names pre-shaped
// (conjuncts joined) with this font, whose glyphs sit in these ranges only.
const DEVANAGARI_FONT = "Noto Sans Devanagari Regular v1";
const DEVANAGARI_RANGES = ["0-255", "62720-62975", "62976-63231", "63232-63487", "63488-63743"];
const SPRITES = ["light.json", "light.png", "light@2x.json", "light@2x.png"];

const OUT = path.resolve("public/map");

function lonToX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tilesInBounds(maxZoom: number): [number, number, number][] {
  const [w, s, e, n] = KUMBH_BOUNDS;
  const out: [number, number, number][] = [];
  for (let z = 0; z <= maxZoom; z++) {
    for (let x = lonToX(w, z); x <= lonToX(e, z); x++) {
      for (let y = latToY(n, z); y <= latToY(s, z); y++) out.push([z, x, y]);
    }
  }
  return out;
}

async function latestBuild(): Promise<string> {
  const res = await fetch("https://build-metadata.protomaps.dev/builds.json");
  const builds = (await res.json()) as { key: string }[];
  return builds[builds.length - 1].key.replace(".pmtiles", "");
}

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const arg = process.argv[2];
  const build = !arg ? PINNED_BUILD : arg === "latest" ? await latestBuild() : arg;
  const source = `https://build.protomaps.com/${build}.pmtiles`;
  console.log(`Basemap build ${build}`);

  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  const tiles = tilesInBounds(Math.min(MAX_ZOOM, header.maxZoom));
  console.log(`${tiles.length} tiles for bounds ${KUMBH_BOUNDS.join(",")}`);

  let done = 0;
  let bytes = 0;
  let empty = 0;
  const queue = [...tiles];
  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const [z, x, y] = t;
      const file = path.join(OUT, "tiles", `${z}`, `${x}`, `${y}.mvt`);
      if (!fs.existsSync(file)) {
        const tile = await archive.getZxy(z, x, y); // decompressed by pmtiles
        if (tile) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.from(tile.data));
          bytes += tile.data.byteLength;
        } else {
          empty += 1;
        }
      }
      done += 1;
      if (done % 200 === 0) console.log(`  ${done}/${tiles.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Tiles done: ${(bytes / 1e6).toFixed(1)} MB new, ${empty} empty`);

  const fontRanges: [string, string[]][] = [
    ...FONTS.map((f): [string, string[]] => [f, GLYPH_RANGES]),
    [DEVANAGARI_FONT, DEVANAGARI_RANGES],
  ];
  for (const [font, ranges] of fontRanges) {
    for (const range of ranges) {
      const file = path.join(OUT, "fonts", font, `${range}.pbf`);
      if (!fs.existsSync(file)) {
        await download(`${ASSETS}/fonts/${encodeURIComponent(font)}/${range}.pbf`, file);
      }
    }
  }
  for (const sprite of SPRITES) {
    const file = path.join(OUT, "sprites", sprite);
    if (!fs.existsSync(file)) await download(`${ASSETS}/sprites/v4/${sprite}`, file);
  }

  fs.writeFileSync(
    path.join(OUT, "meta.json"),
    JSON.stringify(
      {
        build,
        bounds: KUMBH_BOUNDS,
        minzoom: 0,
        maxzoom: Math.min(MAX_ZOOM, header.maxZoom),
        tiles: tiles.length - empty,
        attribution: "© OpenStreetMap contributors · Protomaps",
      },
      null,
      2
    )
  );
  console.log(`Offline map ready in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
