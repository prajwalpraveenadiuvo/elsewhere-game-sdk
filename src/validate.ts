import { GAME_SPEC_VERSION, LIMITS, type Checkpoint, type GameSpec, type Overlay, type Vec2 } from './spec.js';

export type Validation = { ok: true; spec: GameSpec } | { ok: false; errors: string[] };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec2 = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && isNumber(v[0]) && isNumber(v[1]);
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,39}$/;
const KEY = /^[a-z][a-z0-9_:-]{0,39}$/;

/**
 * Check a game spec and return it clean, or say everything wrong with it.
 *
 * `bounds` is the region's half-size in metres, when known: a game must fit
 * inside the region it is registered on (an ocean plot of width w has half
 * sizes w/2). Every message names the field, so a developer can fix a spec
 * without reading this file.
 */
export function validateSpec(input: unknown, bounds?: { halfX: number; halfZ: number }): Validation {
  const errors: string[] = [];
  const fail = (message: string) => { errors.push(message); };
  if (!isObject(input)) return { ok: false, errors: ['A game spec is a JSON object.'] };
  const s = input;

  if (s['spec_version'] !== GAME_SPEC_VERSION) fail(`spec_version must be ${GAME_SPEC_VERSION}.`);
  if (s['kind'] !== 'race') fail('kind must be "race" (the only kind in this version).');
  const name = typeof s['name'] === 'string' ? s['name'].trim() : '';
  if (!name || name.length > LIMITS.name) fail(`name must be 1–${LIMITS.name} characters.`);
  if (s['description'] !== undefined && (typeof s['description'] !== 'string' || s['description'].length > LIMITS.description)) fail(`description must be text of at most ${LIMITS.description} characters.`);

  // The play area, and everything inside it.
  const area = s['area'];
  let centre: Vec2 = [0, 0], radius = 0;
  if (!isObject(area) || !isVec2(area['center']) || !isNumber(area['radius_m'])) fail('area needs center [x, z] and radius_m.');
  else {
    centre = area['center']; radius = area['radius_m'];
    if (radius < 5 || radius > LIMITS.areaRadius) fail(`area.radius_m must be 5–${LIMITS.areaRadius}.`);
    if (bounds && (Math.abs(centre[0]) + radius > bounds.halfX + 1e-6 || Math.abs(centre[1]) + radius > bounds.halfZ + 1e-6)) {
      fail(`area must fit inside the region (±${bounds.halfX} m east–west, ±${bounds.halfZ} m north–south).`);
    }
  }
  const inside = (p: Vec2, margin = 0) => Math.hypot(p[0] - centre[0], p[1] - centre[1]) + margin <= radius + 1e-6;

  const join = s['join'];
  if (!isObject(join) || !isVec2(join['center']) || !isNumber(join['radius_m'])) fail('join needs center [x, z] and radius_m.');
  else {
    if (join['radius_m'] < 2 || join['radius_m'] > 200) fail('join.radius_m must be 2–200.');
    if (radius && !inside(join['center'])) fail('join.center must be inside the area.');
  }

  const players = s['players'];
  if (!isObject(players) || !Number.isInteger(players['min']) || !Number.isInteger(players['max'])) fail('players needs whole numbers min and max.');
  else if ((players['min'] as number) < 1 || (players['max'] as number) > LIMITS.players || (players['min'] as number) > (players['max'] as number)) {
    fail(`players must have 1 ≤ min ≤ max ≤ ${LIMITS.players}.`);
  }

  if (s['teams'] !== undefined) {
    const teams = s['teams'];
    if (!Array.isArray(teams) || teams.length < 2 || teams.length > 8) fail('teams, when given, is a list of 2–8 teams.');
    else {
      const seen = new Set<string>();
      teams.forEach((t, i) => {
        if (!isObject(t) || typeof t['id'] !== 'string' || !ID.test(t['id']) || typeof t['name'] !== 'string' || !t['name'].trim() || typeof t['colour'] !== 'string' || !COLOUR.test(t['colour'])) {
          fail(`teams[${i}] needs an id, a name and a colour like #ff8a3d.`);
        } else if (seen.has(t['id'])) fail(`teams[${i}].id "${t['id']}" is used twice.`);
        else seen.add(t['id']);
      });
    }
  }

  if (!['boat', 'vehicle', 'walk', 'any'].includes(s['mode'] as string)) fail('mode must be "boat", "vehicle", "walk" or "any".');
  const within = (field: string, [lo, hi]: readonly [number, number]) => {
    const v = s[field];
    if (!isNumber(v) || v < lo || v > hi) fail(`${field} must be ${lo}–${hi} seconds.`);
  };
  within('lobby_s', LIMITS.lobby);
  within('countdown_s', LIMITS.countdown);
  within('time_limit_s', LIMITS.timeLimit);

  const course = s['course'];
  if (!isObject(course) || !Array.isArray(course['checkpoints'])) fail('course needs a list of checkpoints and a number of laps.');
  else {
    const list = course['checkpoints'] as unknown[];
    if (list.length < 1 || list.length > LIMITS.checkpoints) fail(`course.checkpoints must have 1–${LIMITS.checkpoints} checkpoints.`);
    const ids = new Set<string>();
    list.forEach((c, i) => {
      const where = `course.checkpoints[${i}]`;
      if (!isObject(c) || typeof c['id'] !== 'string' || !ID.test(c['id'])) { fail(`${where} needs an id.`); return; }
      if (ids.has(c['id'])) fail(`${where}.id "${c['id']}" is used twice.`);
      ids.add(c['id']);
      if (c['label'] !== undefined && (typeof c['label'] !== 'string' || c['label'].length > 40)) fail(`${where}.label must be at most 40 characters.`);
      if (c['kind'] === 'line') {
        if (!isVec2(c['a']) || !isVec2(c['b'])) fail(`${where} is a line: it needs a and b as [x, z].`);
        else {
          const length = Math.hypot(c['a'][0] - c['b'][0], c['a'][1] - c['b'][1]);
          if (length < 2 || length > 400) fail(`${where} must be 2–400 m long.`);
          if (radius && (!inside(c['a']) || !inside(c['b']))) fail(`${where} must be inside the area.`);
        }
      } else if (c['kind'] === 'mark') {
        if (!isVec2(c['at']) || !isNumber(c['radius_m'])) fail(`${where} is a mark: it needs at [x, z] and radius_m.`);
        else {
          if (c['radius_m'] < 2 || c['radius_m'] > 100) fail(`${where}.radius_m must be 2–100.`);
          if (radius && !inside(c['at'])) fail(`${where} must be inside the area.`);
        }
      } else fail(`${where}.kind must be "line" or "mark".`);
    });
    if (!Number.isInteger(course['laps']) || (course['laps'] as number) < 1 || (course['laps'] as number) > LIMITS.laps) fail(`course.laps must be a whole number 1–${LIMITS.laps}.`);
  }

  const scoring = s['scoring'];
  if (!isObject(scoring) || typeof scoring['key'] !== 'string' || !Array.isArray(scoring['places']) || !isNumber(scoring['finish'])) {
    fail('scoring needs a key, a list of points for places and points for finishing.');
  } else {
    if (!KEY.test(scoring['key'])) fail('scoring.key must be lower case letters, digits, _ : or -, starting with a letter.');
    const places = scoring['places'] as unknown[];
    if (places.length > LIMITS.players || places.some(p => !Number.isInteger(p) || (p as number) < 0)) fail('scoring.places must be whole numbers of points, at most one per player.');
    if (!Number.isInteger(scoring['finish']) || (scoring['finish'] as number) < 0) fail('scoring.finish must be a whole number of points.');
    const best = Math.max(0, ...places.filter((p): p is number => typeof p === 'number')) + (isNumber(scoring['finish']) ? scoring['finish'] : 0);
    if (best > LIMITS.pointsPerMatch) fail(`A player can earn at most ${LIMITS.pointsPerMatch} points a match (best place plus finishing).`);
  }

  if (s['overlays'] !== undefined) {
    const overlays = s['overlays'];
    if (!Array.isArray(overlays) || overlays.length > LIMITS.overlays) fail(`overlays is a list of at most ${LIMITS.overlays}.`);
    else overlays.forEach((o, i) => {
      const where = `overlays[${i}]`;
      if (!isObject(o)) { fail(`${where} must be an object.`); return; }
      if (o['colour'] !== undefined && (typeof o['colour'] !== 'string' || !COLOUR.test(o['colour']))) fail(`${where}.colour must look like #ff8a3d.`);
      const points = o['kind'] === 'label' ? [o['at']] : o['kind'] === 'line' ? [o['from'], o['to']] : o['kind'] === 'ring' ? [o['at']] : null;
      if (!points) { fail(`${where}.kind must be "label", "line" or "ring".`); return; }
      if (points.some(p => !isVec2(p))) { fail(`${where} needs its points as [x, z].`); return; }
      if (radius && points.some(p => !inside(p as Vec2))) fail(`${where} must be inside the area.`);
      if (o['kind'] === 'label' && (typeof o['text'] !== 'string' || !o['text'].trim() || o['text'].length > 40)) fail(`${where}.text must be 1–40 characters.`);
      if (o['kind'] === 'ring' && (!isNumber(o['radius_m']) || o['radius_m'] < 1 || o['radius_m'] > 200)) fail(`${where}.radius_m must be 1–200.`);
    });
  }

  if (errors.length) return { ok: false, errors };
  // Clean copy: only the fields this version knows, so nothing unknown rides along.
  const c = s['course'] as Json, sc = s['scoring'] as Json;
  const spec: GameSpec = {
    spec_version: GAME_SPEC_VERSION,
    kind: 'race',
    name,
    ...(typeof s['description'] === 'string' && s['description'].trim() ? { description: s['description'].trim() } : {}),
    area: { center: [...(area as Json)['center'] as Vec2], radius_m: (area as Json)['radius_m'] as number },
    join: { center: [...(join as Json)['center'] as Vec2], radius_m: (join as Json)['radius_m'] as number },
    players: { min: (players as Json)['min'] as number, max: (players as Json)['max'] as number },
    ...(Array.isArray(s['teams']) ? { teams: (s['teams'] as Json[]).map(t => ({ id: t['id'] as string, name: (t['name'] as string).trim(), colour: t['colour'] as string })) } : {}),
    mode: s['mode'] as GameSpec['mode'],
    lobby_s: s['lobby_s'] as number,
    countdown_s: s['countdown_s'] as number,
    time_limit_s: s['time_limit_s'] as number,
    course: {
      laps: c['laps'] as number,
      checkpoints: (c['checkpoints'] as Json[]).map((cp): Checkpoint => cp['kind'] === 'line'
        ? { id: cp['id'] as string, kind: 'line', a: [...cp['a'] as Vec2], b: [...cp['b'] as Vec2], ...(typeof cp['label'] === 'string' ? { label: cp['label'] } : {}) }
        : { id: cp['id'] as string, kind: 'mark', at: [...cp['at'] as Vec2], radius_m: cp['radius_m'] as number, ...(typeof cp['label'] === 'string' ? { label: cp['label'] } : {}) }),
    },
    scoring: { key: sc['key'] as string, places: [...sc['places'] as number[]], finish: sc['finish'] as number },
    ...(Array.isArray(s['overlays']) ? { overlays: (s['overlays'] as Json[]).map((o): Overlay => {
      const colour = typeof o['colour'] === 'string' ? { colour: o['colour'] } : {};
      if (o['kind'] === 'label') return { kind: 'label', at: [...o['at'] as Vec2], text: (o['text'] as string).trim(), ...colour };
      if (o['kind'] === 'line') return { kind: 'line', from: [...o['from'] as Vec2], to: [...o['to'] as Vec2], ...colour };
      return { kind: 'ring', at: [...o['at'] as Vec2], radius_m: o['radius_m'] as number, ...colour };
    }) } : {}),
  };
  return { ok: true, spec };
}
