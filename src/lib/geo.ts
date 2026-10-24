export type LatLng = [number, number]

const R = 6371000

/** Great-circle distance in meters. */
export function distanceM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Local equirectangular projection to meters, good enough at neighborhood scale. */
function project(p: LatLng, origin: LatLng): [number, number] {
  const k = Math.cos((origin[0] * Math.PI) / 180)
  return [
    ((p[1] - origin[1]) * Math.PI * R * k) / 180,
    ((p[0] - origin[0]) * Math.PI * R) / 180,
  ]
}

function pointToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const [px, py] = project(p, a)
  const [bx, by] = project(b, a)
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  return Math.hypot(px - t * bx, py - t * by)
}

/** Shortest distance from a point to a polyline, in meters. */
export function pointToPathM(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity
  if (path.length === 1) return distanceM(p, path[0])
  let min = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    min = Math.min(min, pointToSegmentM(p, path[i], path[i + 1]))
  }
  return min
}

/** Closest approach between a path and any of a set of points. */
export function pathClearanceM(path: LatLng[], points: LatLng[]): number {
  let min = Infinity
  for (const p of points) min = Math.min(min, pointToPathM(p, path))
  return min
}

export function pathLengthM(path: LatLng[]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i++) total += distanceM(path[i], path[i + 1])
  return total
}

/** Position at fraction t (0..1) of the way along a path. */
export function alongPath(path: LatLng[], t: number): LatLng {
  if (path.length === 0) return [0, 0]
  if (t <= 0 || path.length === 1) return path[0]
  if (t >= 1) return path[path.length - 1]
  const target = pathLengthM(path) * t
  let acc = 0
  for (let i = 0; i < path.length - 1; i++) {
    const seg = distanceM(path[i], path[i + 1])
    if (acc + seg >= target) {
      const f = seg === 0 ? 0 : (target - acc) / seg
      return [
        path[i][0] + (path[i + 1][0] - path[i][0]) * f,
        path[i][1] + (path[i + 1][1] - path[i][1]) * f,
      ]
    }
    acc += seg
  }
  return path[path.length - 1]
}

/** The remaining part of a path from fraction t onward. */
export function slicePathFrom(path: LatLng[], t: number): LatLng[] {
  if (t <= 0) return path
  if (t >= 1) return [path[path.length - 1]]
  const target = pathLengthM(path) * t
  let acc = 0
  for (let i = 0; i < path.length - 1; i++) {
    const seg = distanceM(path[i], path[i + 1])
    if (acc + seg >= target) return [alongPath(path, t), ...path.slice(i + 1)]
    acc += seg
  }
  return [path[path.length - 1]]
}

/** Convex hull (monotone chain) — used to draw an approximate fire perimeter. */
export function convexHull(points: LatLng[]): LatLng[] {
  if (points.length < 3) return points
  const pts = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1])
  const lower: LatLng[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: LatLng[] = []
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Rough human phrasing for a walking-scale distance between neighbors. */
export function blocksAway(m: number): string {
  const blocks = Math.max(1, Math.round(m / 120))
  return blocks === 1 ? 'a block away' : `${blocks} blocks away`
}
