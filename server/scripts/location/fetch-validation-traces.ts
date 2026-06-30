/**
 * Download the validation trace corpus described in validation-traces.manifest.json
 * into .var/validation-traces/ (gitignored). Entries that are already committed as
 * unit-test fixtures are skipped. OSM serves originals which may be bzip2/gzip — both
 * are decompressed. Usage: npm run fetch:traces
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../../src/server/paths.js";

interface TraceEntry {
  state: string;
  traceId: number;
  mode?: string;
  area?: string;
  fixture?: string;
}

const OUT = path.join(REPO_ROOT, ".var", "validation-traces");
const MANIFEST = path.join(path.dirname(fileURLToPath(import.meta.url)), "validation-traces.manifest.json");

function decompress(buf: Buffer): Buffer {
  // magic: BZh = bzip2, 0x1f8b = gzip
  if (buf.length >= 3 && buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) {
    const r = spawnSync("bunzip2", ["-c"], { input: buf, maxBuffer: 1 << 30 });
    if (r.status === 0) return r.stdout;
  }
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const r = spawnSync("gunzip", ["-c"], { input: buf, maxBuffer: 1 << 30 });
    if (r.status === 0) return r.stdout;
  }
  return buf;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { traces: TraceEntry[] };
  const toFetch = manifest.traces.filter((t) => !t.fixture);
  console.log(`Fetching ${toFetch.length} non-fixture trace(s) into ${OUT}\n`);

  for (const t of toFetch) {
    const url = `https://www.openstreetmap.org/traces/${t.traceId}/data`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.log(`  ${t.state} ${t.traceId} -> HTTP ${resp.status} (skipped)`);
        continue;
      }
      const gpx = decompress(Buffer.from(await resp.arrayBuffer()));
      const name = `${t.state.toLowerCase()}-${t.mode ?? "trace"}-${t.traceId}.gpx`;
      writeFileSync(path.join(OUT, name), gpx);
      const trkpts = (gpx.toString("utf8").match(/<trkpt/g) ?? []).length;
      console.log(`  ${name}  trkpts=${trkpts}`);
    } catch (e) {
      console.log(`  ${t.state} ${t.traceId} -> ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main();
