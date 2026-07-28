# GPX trace fixtures (real OSM public traces)

Real-world GPX traces used by `gpx.test.ts` to exercise `parseGpxPoints` against
varied creators/formats. All are public GPS traces from OpenStreetMap, in **NC/TN**
(chosen when those were the only states with a valid ptiles `buildings_v8` index; that
gap has since been fixed upstream, so any state now works with the `trace:map` diagnostic).

Source: `https://www.openstreetmap.org/traces/<id>/data` (originals were bzip2-compressed
and have been decompressed here). OSM GPS trace data is licensed **ODbL**.

| File | OSM trace id | Uploader | Area |
|------|--------------|----------|------|
| tn-middle-tennessee-3605997.gpx | 3605997 | V-JF | Nashville, TN (roads) |
| tn-maryville-trails-1283272.gpx | 1283272 | Jack Kittle | Maryville, TN |
| tn-maryville-hike-1063250.gpx | 1063250 | Jack Kittle | Maryville, TN (hike) |
| nc-umstead-trails-1184467.gpx | 1184467 | runbananas | Umstead / Raleigh, NC |
| nc-mine-creek-1184364.gpx | 1184364 | runbananas | Raleigh, NC |
| nc-sals-branch-1191748.gpx | 1191748 | runbananas | Raleigh, NC |

These fixture tests are **opt-in** (validation, not unit logic) — they don't run in the
normal `npm test`. Run them with `npm run test:fixtures` (sets `GPX_FIXTURES=1`).

Re-download example:
```
curl -fsSL "https://www.openstreetmap.org/traces/1184467/data" | bunzip2 > nc-umstead-trails-1184467.gpx
```
