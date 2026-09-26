import type { Checkpoint, Vec2 } from './spec.js';

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const length = (a: Vec2) => Math.hypot(a[0], a[1]);

/**
 * When a step from p to q crosses the line a–b, as a fraction of the step
 * (0 at p, 1 at q); null when it does not. Checked on every step between
 * frames, so a fast boat cannot jump a gate between two samples.
 */
export function crossesLine(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  const r = sub(q, p), s = sub(b, a);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-12) return null;
  const ap = sub(a, p);
  const t = cross(ap, s) / denominator;
  const u = cross(ap, r) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** When a step from p to q first comes within `radius` of a mark; 0 when it starts inside, null when it never does. */
export function passesMark(p: Vec2, q: Vec2, at: Vec2, radius: number): number | null {
  const d = sub(q, p), f = sub(p, at);
  const c = dot(f, f) - radius * radius;
  if (c <= 0) return 0;
  const a = dot(d, d);
  if (a < 1e-12) return null;
  const b = 2 * dot(f, d);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** When a step passes a checkpoint, as a fraction of the step; null when it does not. */
export function crossing(checkpoint: Checkpoint, p: Vec2, q: Vec2): number | null {
  return checkpoint.kind === 'line' ? crossesLine(p, q, checkpoint.a, checkpoint.b) : passesMark(p, q, checkpoint.at, checkpoint.radius_m);
}

/** The nearest point of a segment to a point. */
function nearestOnSegment(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(point, a), ab) / Math.max(dot(ab, ab), 1e-12)));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (crossesLine(a, b, c, d) !== null) return 0;
  return Math.min(
    length(sub(a, nearestOnSegment(a, c, d))), length(sub(b, nearestOnSegment(b, c, d))),
    length(sub(c, nearestOnSegment(c, a, b))), length(sub(d, nearestOnSegment(d, a, b))),
  );
}

/**
 * The shortest distance anyone could travel from passing one checkpoint to
 * passing the next: between their nearest edges. The world uses it to turn
 * away times nothing could have made.
 */
export function checkpointGap(from: Checkpoint, to: Checkpoint): number {
  const shape = (c: Checkpoint): { a: Vec2; b: Vec2; r: number } => c.kind === 'line' ? { a: c.a, b: c.b, r: 0 } : { a: c.at, b: c.at, r: c.radius_m };
  const x = shape(from), y = shape(to);
  return Math.max(0, segmentDistance(x.a, x.b, y.a, y.b) - x.r - y.r);
}

/** Where to aim for a checkpoint: a line's middle, a mark itself. */
export function checkpointTarget(checkpoint: Checkpoint): Vec2 {
  return checkpoint.kind === 'line' ? [(checkpoint.a[0] + checkpoint.b[0]) / 2, (checkpoint.a[1] + checkpoint.b[1]) / 2] : [...checkpoint.at];
}
