/**
 * The ball drawn as a football: white, with the twelve black pentagons of the
 * classic ball, turned as it rolls.
 *
 * The ball's orientation is a Spin, a unit quaternion taking a point on the
 * ball as made to where it now faces. Directions are those of the canvas, seen
 * from above: x to the right, y down the screen, and z away from the viewer,
 * so the half of the ball facing them is z < 0.
 *
 * A ball rolling along the ground turns about the horizontal axis square to
 * the way it is going, by the distance it went over its radius. The radius is
 * the one it is drawn at, so the pattern moves as a ball that size would.
 * Rolled at a real ball's rate it would turn several times a frame, and a
 * pattern that turns more than about half the gap between its patches in a
 * frame seems to turn backwards, or not at all: a step turns no more than
 * MAX_ROLL_STEP_RAD.
 */

/** A unit quaternion [w, x, y, z]. */
export type Spin = readonly [number, number, number, number]
type Vec = readonly [number, number, number]

/** The ball as made, not turned. */
export const UPRIGHT: Spin = [1, 0, 0, 0]

/**
 * The most a ball turns in one step, in radians. The pentagons are 63 degrees
 * apart: well under half that, so it never seems to turn the wrong way.
 */
export const MAX_ROLL_STEP_RAD = (25 * Math.PI) / 180

const normal = (v: Vec): Vec => {
  const n = Math.hypot(...v)
  return [v[0] / n, v[1] / n, v[2] / n]
}

const times = (a: Spin, b: Spin): Spin => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
]

/** Where the point `v` on the ball as made faces once turned by `spin`. */
export function turned(spin: Spin, v: Vec): Vec {
  const [, x, y, z] = times(times(spin, [0, v[0], v[1], v[2]]), [spin[0], -spin[1], -spin[2], -spin[3]])
  return [x, y, z]
}

/**
 * The ball turned on from `spin` by rolling `dx`, `dy` across the canvas, at
 * `radius` in the same units.
 */
export function rolled(spin: Spin, dx: number, dy: number, radius: number): Spin {
  const distance = Math.hypot(dx, dy)
  if (distance === 0 || radius <= 0) return spin
  const angle = Math.min(distance / radius, MAX_ROLL_STEP_RAD)
  // The axis is the ground's normal, toward the viewer, crossed with the way
  // it went: (0, 0, -1) x (dx, dy, 0).
  const s = Math.sin(angle / 2) / distance
  const turn: Spin = [Math.cos(angle / 2), dy * s, -dx * s, 0]
  const next = times(turn, spin)
  const n = Math.hypot(...next)
  return [next[0] / n, next[1] / n, next[2] / n, next[3] / n]
}

/**
 * The pentagons on the ball as made, each as points on its outline, in order.
 * They sit on the corners of an icosahedron, each cut a third of the way along
 * the edges from it (the truncated icosahedron), with points added along each
 * side so it bends with the ball.
 */
const PENTAGONS: Vec[][] = (() => {
  const phi = (1 + Math.sqrt(5)) / 2
  const corners: Vec[] = []
  for (const a of [-1, 1]) {
    for (const b of [-phi, phi]) corners.push([0, a, b], [a, b, 0], [b, 0, a])
  }
  return corners.map((v) => {
    // Its five neighbours are the corners an edge (2 long) away.
    const near = corners.filter((n) => Math.abs(Math.hypot(n[0] - v[0], n[1] - v[1], n[2] - v[2]) - 2) < 1e-9)
    const points = near.map((n) =>
      normal([v[0] + (n[0] - v[0]) / 3, v[1] + (n[1] - v[1]) / 3, v[2] + (n[2] - v[2]) / 3]),
    )
    // In order around the corner: by angle in the plane square to it.
    const c = normal(v)
    const u = normal(Math.abs(c[0]) < 0.9 ? [0, -c[2], c[1]] : [-c[2], 0, c[0]])
    const w: Vec = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]]
    const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    points.sort((a, b) => Math.atan2(dot(a, w), dot(a, u)) - Math.atan2(dot(b, w), dot(b, u)))
    return points.flatMap((p, i) => {
      const q = points[(i + 1) % points.length]!
      return [1, 2, 3].map((k) =>
        normal([
          p[0] + ((q[0] - p[0]) * (k - 1)) / 3,
          p[1] + ((q[1] - p[1]) * (k - 1)) / 3,
          p[2] + ((q[2] - p[2]) * (k - 1)) / 3,
        ]),
      )
    })
  })
})()

/**
 * The black patches seen on a ball turned by `spin`, each an outline in units
 * of the ball's radius about its centre, x right and y down. A patch running
 * round the edge of the ball has the part out of sight drawn along the edge.
 */
export function footballPatches(spin: Spin): Array<Array<[number, number]>> {
  const seen: Array<Array<[number, number]>> = []
  for (const pentagon of PENTAGONS) {
    const points = pentagon.map((p) => turned(spin, p))
    if (!points.some((p) => p[2] < 0)) continue
    seen.push(
      points.map(([x, y, z]) => {
        if (z < 0) return [x, y]
        const r = Math.hypot(x, y) || 1
        return [x / r, y / r]
      }),
    )
  }
  return seen
}
