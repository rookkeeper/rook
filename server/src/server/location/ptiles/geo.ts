/** Great-circle distance in meters between two lat/lon points. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = ((lat2 - lat1) * Math.PI) / 180;
  const dlon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ray-casting point-in-polygon. `poly` is an array of [lon, lat] pairs (the
 * PTILES coordinate order). Returns true if (lat, lon) is inside.
 */
export function pointInPolygon(lat: number, lon: number, poly: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const METERS_PER_DEGREE = 111_320;

/**
 * Distance in meters from (lat, lon) to a polygon (`[lon, lat]` pairs): 0 when
 * the point is inside, else the minimum distance to any edge. Uses a local
 * equirectangular projection around the point — accurate and cheap at building
 * scale. `dist <= buffer` is equivalent to membership in the buffer-enlarged
 * polygon.
 */
export function distanceToPolygonMeters(lat: number, lon: number, poly: number[][]): number {
  if (poly.length === 0) return Infinity;
  if (pointInPolygon(lat, lon, poly)) return 0;

  const cosLat = Math.cos((lat * Math.PI) / 180);
  const toXY = (lo: number, la: number): [number, number] => [
    (lo - lon) * METERS_PER_DEGREE * cosLat,
    (la - lat) * METERS_PER_DEGREE,
  ];

  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = toXY(poly[j][0], poly[j][1]);
    const b = toXY(poly[i][0], poly[i][1]);
    min = Math.min(min, pointToSegmentMeters(a, b));
  }
  return min;
}

/** Distance from the origin (0,0) to segment a-b, all in local meters. */
function pointToSegmentMeters(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : -(a[0] * dx + a[1] * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  return Math.sqrt(px * px + py * py);
}
