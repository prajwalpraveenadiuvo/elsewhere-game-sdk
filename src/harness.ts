import { createMatch, join, pass, results, start, tick, type Match, type Result } from './engine.js';
import { checkpointTarget, crossing } from './geometry.js';
import type { GameSpec, Vec2 } from './spec.js';

export interface Bot {
  name: string;
  /** Metres per second. */
  speed_mps: number;
  /** Where it waits for the start; the join zone's centre when not given. */
  start?: Vec2;
}

export interface Simulation {
  results: Result[];
  /** What happened, in order, for reading. */
  log: string[];
  match: Match;
}

/**
 * Race a spec with bots before anyone else does: each joins, the match
 * counts down, and each sails straight for the next checkpoint at its speed,
 * passing it by the same geometry the world uses. A course nobody can finish
 * in its time limit, or a checkpoint nobody can reach, shows up here.
 */
export function simulate(spec: GameSpec, bots: Bot[], options: { stepMs?: number; t0?: number } = {}): Simulation {
  const step = options.stepMs ?? 100;
  let now = options.t0 ?? 0;
  const log: string[] = [];
  let match = createMatch('simulation', now);
  bots.forEach((bot, i) => {
    const outcome = join(spec, match, { id: `bot-${i}`, name: bot.name }, now);
    match = outcome.match;
    if (outcome.refused) log.push(`${bot.name} could not join: ${outcome.refused}`);
  });
  const started = start(spec, match, now);
  if (started.refused) { log.push(`could not start: ${started.refused}`); return { results: results(spec, match), log, match }; }
  match = started.match;
  log.push(`countdown ${spec.countdown_s} s`);
  const at = bots.map(b => [...(b.start ?? spec.join.center)] as Vec2);
  const checkpoints = spec.course.checkpoints;
  while (match.phase !== 'finished') {
    const before = match.phase;
    now += step;
    match = tick(spec, match, now);
    if (before !== 'running' && match.phase === 'running') log.push('go');
    if (match.phase !== 'running') continue;
    bots.forEach((bot, i) => {
      const player = match.players.find(p => p.id === `bot-${i}`);
      if (!player || player.finished_ms !== null) return;
      const checkpoint = checkpoints[player.next]!;
      const here = at[i]!, target = checkpointTarget(checkpoint);
      const dx = target[0] - here[0], dz = target[1] - here[1], d = Math.hypot(dx, dz);
      const move = Math.min(d + 0.5, bot.speed_mps * step / 1000);
      const there: Vec2 = d < 1e-9 ? [here[0] + 0.5, here[1]] : [here[0] + dx / d * move, here[1] + dz / d * move];
      const t = crossing(checkpoint, here, there);
      at[i] = there;
      if (t === null) return;
      const outcome = pass(spec, match, player.id, player.next, now - step + t * step);
      match = outcome.match;
      const after = match.players.find(p => p.id === player.id)!;
      if (after.finished_ms !== null) log.push(`${bot.name} finished in ${(after.finished_ms / 1000).toFixed(1)} s`);
    });
  }
  log.push('finished');
  return { results: results(spec, match), log, match };
}
