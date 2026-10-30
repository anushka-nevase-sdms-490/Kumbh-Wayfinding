/**
 * Prints the route the app would take (its own router and options), for the
 * browser smoke test: `npx tsx scripts/routeCodes.ts pack.json FROM TO`.
 */
import { readFileSync } from "fs";
import { findRoute } from "../src/lib/router";

const [file, from, to] = process.argv.slice(2);
const pack = JSON.parse(readFileSync(file, "utf-8"));
const r = findRoute(pack, from, to, { preferClearanceM: 1.0 });
console.log(JSON.stringify(r.valid ? r.codes : []));
