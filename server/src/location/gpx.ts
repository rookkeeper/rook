export interface GpxPoint {
  lat: number;
  lon: number;
}

/** Extract `{lat, lon}` from every `<trkpt>/<wpt>/<rtept>` in a GPX document. */
export function parseGpxPoints(xml: string): GpxPoint[] {
  const points: GpxPoint[] = [];
  const tagRe = /<(?:trkpt|wpt|rtept)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrs = m[1];
    const lat = /\blat\s*=\s*"([-0-9.]+)"/.exec(attrs);
    const lon = /\blon\s*=\s*"([-0-9.]+)"/.exec(attrs);
    if (lat && lon) points.push({ lat: parseFloat(lat[1]), lon: parseFloat(lon[1]) });
  }
  return points;
}

/** A track point that also carries its timestamp (ms since epoch) when present. */
export interface GpxTrackPoint extends GpxPoint {
  t?: number;
}

/**
 * Ordered `<trkpt>/<rtept>` points with their `<time>` child parsed to epoch ms
 * (when present) — needed for dwell/speed analysis. Handles both child-bearing and
 * self-closing point tags.
 */
export function parseGpxTrack(xml: string): GpxTrackPoint[] {
  const points: GpxTrackPoint[] = [];
  const re = /<(?:trkpt|rtept)\b([^>]*?)\/>|<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? m[2] ?? "";
    const body = m[3] ?? "";
    const lat = /\blat\s*=\s*"([-0-9.]+)"/.exec(attrs);
    const lon = /\blon\s*=\s*"([-0-9.]+)"/.exec(attrs);
    if (!lat || !lon) continue;
    const tm = /<time>([^<]+)<\/time>/.exec(body);
    const t = tm ? Date.parse(tm[1]) : NaN;
    points.push({ lat: parseFloat(lat[1]), lon: parseFloat(lon[1]), ...(Number.isFinite(t) ? { t } : {}) });
  }
  return points;
}
