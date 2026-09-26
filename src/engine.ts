import { LIMITS, type GameSpec } from './spec.js';

/**
 * One match of a game, and every rule of how it goes.
 *
 * Pure functions over plain data: the world runs exactly these (the server
 * holds the match and feeds it the time and what players report), and so can
 * a developer's own tests and the harness. Every function returns a new match
 * rather than changing the one it was given. Times are milliseconds on the
 * world clock, which every screen in Elsewhere shares.
 */

export type Phase = 'lobby' | 'countdown' | 'running' | 'finished';

export interface MatchPlayer {
  id: string;
  name: string;
  team: string | null;
  joined_at: number;
  /** Laps completed. */
  lap: number;
  /** The checkpoint they are heading for, within the lap. */
  next: number;
  /** Milliseconds from the start at each checkpoint passed. */
  splits: number[];
  finished_ms: number | null;
}

export interface Match {
  id: string;
  phase: Phase;
  created_at: number;
  /** When the lobby first had enough players; it starts `lobby_s` after. */
  ready_at: number | null;
  starts_at: number | null;
  ended_at: number | null;
  players: MatchPlayer[];
}

export interface Standing {
  id: string;
  name: string;
  team: string | null;
  place: number;
  lap: number;
  next: number;
  /** Checkpoints passed, all laps together. */
  progress: number;
  finished_ms: number | null;
}

export interface Result extends Standing {
  points: number;
}

export type Refusal = 'full' | 'started' | 'already_joined' | 'not_joined' | 'not_running' | 'out_of_order' | 'too_early' | 'finished' | 'not_enough_players';

export type Outcome = { match: Match; refused?: undefined } | { match: Match; refused: Refusal };

export function createMatch(id: string, now: number): Match {
  return { id, phase: 'lobby', created_at: now, ready_at: null, starts_at: null, ended_at: null, players: [] };
}

/** Into the next match: while it gathers or counts down, and while there is room. Teams fill evenly. */
export function join(spec: GameSpec, match: Match, player: { id: string; name: string }, now: number): Outcome {
  if (match.players.some(p => p.id === player.id)) return { match, refused: 'already_joined' };
  if (match.phase === 'running' || match.phase === 'finished') return { match, refused: 'started' };
  if (match.players.length >= spec.players.max) return { match, refused: 'full' };
  const team = spec.teams?.length
    ? [...spec.teams].sort((a, b) => match.players.filter(p => p.team === a.id).length - match.players.filter(p => p.team === b.id).length)[0]!.id
    : null;
  const next: MatchPlayer = { id: player.id, name: player.name.slice(0, 40), team, joined_at: now, lap: 0, next: 0, splits: [], finished_ms: null };
  return { match: tick(spec, { ...match, players: [...match.players, next] }, now) };
}

/** Out of it. A lobby that drops below its minimum waits again; a race goes on without them. */
export function leave(spec: GameSpec, match: Match, playerId: string, now: number): Outcome {
  if (!match.players.some(p => p.id === playerId)) return { match, refused: 'not_joined' };
  const players = match.players.filter(p => p.id !== playerId);
  const back = match.phase === 'countdown' && players.length < spec.players.min;
  return { match: tick(spec, { ...match, players, ...(back ? { phase: 'lobby' as const, starts_at: null, ready_at: null } : {}) }, now) };
}

/** Start the countdown now, once there are enough players, rather than wait out the lobby. */
export function start(spec: GameSpec, match: Match, now: number): Outcome {
  if (match.phase !== 'lobby') return { match, refused: 'started' };
  if (match.players.length < spec.players.min) return { match, refused: 'not_enough_players' };
  return { match: { ...match, phase: 'countdown', starts_at: now + spec.countdown_s * 1000 } };
}

/** Let time pass: lobbies start, countdowns end, races finish or run out of time. */
export function tick(spec: GameSpec, match: Match, now: number): Match {
  let m = match;
  if (m.phase === 'lobby') {
    if (m.players.length < spec.players.min) return m.ready_at === null ? m : { ...m, ready_at: null };
    const ready = m.ready_at ?? now;
    if (now - ready >= spec.lobby_s * 1000) m = { ...m, ready_at: ready, phase: 'countdown', starts_at: now + spec.countdown_s * 1000 };
    else if (m.ready_at === null) return { ...m, ready_at: ready };
    else return m;
  }
  if (m.phase === 'countdown' && m.starts_at !== null && now >= m.starts_at) m = { ...m, phase: 'running' };
  if (m.phase === 'running' && m.starts_at !== null) {
    const done = m.players.length > 0 && m.players.every(p => p.finished_ms !== null);
    if (done || !m.players.length || now >= m.starts_at + spec.time_limit_s * 1000) m = { ...m, phase: 'finished', ended_at: now };
  }
  return m;
}

/**
 * A player passed checkpoint `index` at time `at`. Only the checkpoint they
 * are heading for counts, and only after the start: a line crossed early, a
 * buoy skipped, a checkpoint reported twice are all turned away.
 */
export function pass(spec: GameSpec, match: Match, playerId: string, index: number, at: number): Outcome {
  const m = tick(spec, match, at);
  if (m.phase !== 'running' || m.starts_at === null) return { match: m, refused: m.phase === 'countdown' || m.phase === 'lobby' ? 'too_early' : 'not_running' };
  const player = m.players.find(p => p.id === playerId);
  if (!player) return { match: m, refused: 'not_joined' };
  if (player.finished_ms !== null) return { match: m, refused: 'finished' };
  if (index !== player.next) return { match: m, refused: 'out_of_order' };
  if (at < m.starts_at) return { match: m, refused: 'too_early' };
  const n = spec.course.checkpoints.length;
  const elapsed = at - m.starts_at;
  let next = player.next + 1, lap = player.lap;
  if (next >= n) { next = 0; lap += 1; }
  const finished = lap >= spec.course.laps ? elapsed : null;
  const updated: MatchPlayer = { ...player, next, lap, splits: [...player.splits, elapsed], finished_ms: finished };
  return { match: tick(spec, { ...m, players: m.players.map(p => p.id === playerId ? updated : p) }, at) };
}

/** Who is where: finishers by time, then everyone else by how far they got, and who got there first. */
export function standings(spec: GameSpec, match: Match): Standing[] {
  const n = spec.course.checkpoints.length;
  const rows = match.players.map(p => ({ id: p.id, name: p.name, team: p.team, lap: p.lap, next: p.next, progress: p.lap * n + p.next, finished_ms: p.finished_ms, last: p.splits.at(-1) ?? Infinity, joined: p.joined_at }));
  rows.sort((a, b) => {
    if (a.finished_ms !== null || b.finished_ms !== null) {
      if (a.finished_ms === null) return 1;
      if (b.finished_ms === null) return -1;
      return a.finished_ms - b.finished_ms;
    }
    return b.progress - a.progress || a.last - b.last || a.joined - b.joined;
  });
  return rows.map(({ last: _last, joined: _joined, ...row }, i) => ({ ...row, place: i + 1 }));
}

/** What each player earned: points for their place and for finishing, within the platform's cap. Nothing for not finishing. */
export function results(spec: GameSpec, match: Match): Result[] {
  return standings(spec, match).map(s => ({
    ...s,
    points: s.finished_ms === null ? 0 : Math.min(LIMITS.pointsPerMatch, (spec.scoring.places[s.place - 1] ?? 0) + spec.scoring.finish),
  }));
}

/** Teams by their best player. */
export function teamStandings(spec: GameSpec, match: Match): Array<{ team: string; place: number; best: Standing | null }> {
  if (!spec.teams?.length) return [];
  const table = standings(spec, match);
  return spec.teams
    .map(t => ({ team: t.id, best: table.find(s => s.team === t.id) ?? null }))
    .sort((a, b) => (a.best?.place ?? Infinity) - (b.best?.place ?? Infinity))
    .map((row, i) => ({ ...row, place: i + 1 }));
}
