/**
 * Render every GPX trace (committed fixtures + downloaded validation traces) to a
 * self-contained HTML map under .var/validation-traces/maps/ (gitignored) — a results
 * folder that visually verifies the route + matched ptiles buildings/businesses.
 *
 * Usage: npm run maps:traces
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGpxPoints } from "../../src/server/location/gpx.js";
import { REPO_ROOT } from "../../src/server/paths.js";
import { writeTraceMap } from "./trace-map.js";

const FIXTURES = path.join(REPO_ROOT, "server", "src", "server", "location", "test-fixtures", "gpx");
const VALIDATION = path.join(REPO_ROOT, ".var", "validation-traces");
const OUT = path.join(VALIDATION, "maps");

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const inputs: Array<{ name: string; full: string }> = [];
  for (const dir of [FIXTURES, VALIDATION]) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".gpx")) inputs.push({ name: f, full: path.join(dir, f) });
    } catch {
      /* dir may not exist */
    }
  }
  console.log(`Rendering ${inputs.length} trace(s) into ${OUT}\n`);

  for (const { name, full } of inputs) {
    // ~500 lookups max per trace: stride by point count.
    const count = parseGpxPoints(readFileSync(full, "utf8")).length;
    const stride = Math.max(1, Math.ceil(count / 500));
    const out = path.join(OUT, name.replace(/\.gpx$/i, "") + ".map.html");
    try {
      const stats = await writeTraceMap(full, stride, out);
      if (!stats) {
        console.log(`  ${name}  (skipped — no points / non-US)`);
        continue;
      }
      console.log(`  ${name}  ${stats.state}  matches=${stats.matches}/${stats.sampled}  buildings=${stats.buildings}`);
    } catch (e) {
      console.log(`  ${name}  ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nDone. Open ${OUT}/<trace>.map.html`);
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main();
