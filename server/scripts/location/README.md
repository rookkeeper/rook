# Location validation scripts

Diagnostic/validation tooling for the `loc:` geo-identification feature. None of these run
in the test suite; they hit the live ptiles host and write results under `.var/` (gitignored).
Run from the `server/` directory via the npm aliases below.

| Script | npm alias | Purpose |
|--------|-----------|---------|
| `replay-gpx.ts` | `npm run replay:gpx -- <trace.gpx> <serverUrl> [stride]` | Replay GPX trackpoints against a running server's `/api/environments/register` and print candidates as they change. |
| `trace-map.ts` | `npm run trace:map -- <trace.gpx> [stride] [out.html]` | Render one trace + matched ptiles buildings/businesses to a self-contained Leaflet HTML map. |
| `render-trace-maps.ts` | `npm run maps:traces` | Batch-render all fixtures + downloaded traces to `.var/validation-traces/maps/`. |
| `dwell-analysis.ts` | `npm run dwell:analysis` | Classify motion mode and measure dwell vs ptiles matches (separates real visits from drive-bys). |
| `fetch-validation-traces.ts` | `npm run fetch:traces` | Download the OSM validation corpus described in `validation-traces.manifest.json` into `.var/validation-traces/`. |

`validation-traces.manifest.json` — list of OSM traces (state, id, mode, area) to download.
`fixtures/` — small sample GPX used for ad-hoc runs. Committed unit-test traces live in
`src/server/location/test-fixtures/gpx/`.
