import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LIMITS, checkpointGap, createMatch, crossesLine, join, leave, pass, passesMark, results, simulate, standings, start, teamStandings, tick, validateSpec,
  type GameSpec,
} from '../src/index.js';

const example = JSON.parse(readFileSync(new URL('../examples/boat-race.json', import.meta.url), 'utf8'));
const spec = (() => { const v = validateSpec(example); if (!v.ok) throw new Error(v.errors.join('\n')); return v.spec; })();
const tiny: GameSpec = {
  ...spec, name: 'Tiny', lobby_s: 10, countdown_s: 3, time_limit_s: 60, players: { min: 2, max: 3 },
  course: { laps: 2, checkpoints: [
    { id: 'a', kind: 'mark', at: [0, -20], radius_m: 3 },
    { id: 'line', kind: 'line', a: [-5, 0], b: [5, 0] },
  ] },
};

describe('validating a spec', () => {
  it('accepts the boat race example, cleaned', () => {
    expect(spec.name).toBe('Ember Point Regatta');
    expect(spec.course.checkpoints).toHaveLength(7);
  });

  it('says what is wrong, field by field', () => {
    const bad = { ...example, spec_version: 2, players: { min: 5, max: 2 }, scoring: { key: 'Score!', places: [90], finish: 20 },
      course: { laps: 0, checkpoints: [{ id: 'far', kind: 'mark', at: [900, 0], radius_m: 5 }, { id: 'far', kind: 'line', a: [0, 0], b: [0, 1] }] } };
    const checked = validateSpec(bad);
    expect(checked.ok).toBe(false);
    const errors = checked.ok ? [] : checked.errors.join('\n');
    for (const fragment of ['spec_version', 'players must', 'scoring.key', `at most ${LIMITS.pointsPerMatch} points`, 'course.laps', 'inside the area', 'used twice', '2–400 m long']) {
      expect(errors).toContain(fragment);
    }
  });

  it('keeps a game inside the region it is registered on', () => {
    expect(validateSpec(example, { halfX: 250, halfZ: 250 }).ok).toBe(true);
    const checked = validateSpec(example, { halfX: 100, halfZ: 100 });
    expect(checked.ok).toBe(false);
  });

  it('drops fields it does not know', () => {
    const checked = validateSpec({ ...example, script: 'fetch("https://evil")' });
    expect(checked.ok && 'script' in checked.spec).toBe(false);
  });
});

describe('the geometry', () => {
  it('catches a gate crossed between two frames, and when', () => {
    expect(crossesLine([0, 5], [0, -5], [-3, 0], [3, 0])).toBeCloseTo(0.5, 5);
    expect(crossesLine([10, 5], [10, -5], [-3, 0], [3, 0])).toBeNull();
    expect(passesMark([-10, 0], [10, 0], [0, 0], 2)).toBeCloseTo(0.4, 5);
    expect(passesMark([-10, 5], [10, 5], [0, 0], 2)).toBeNull();
  });

  it('knows the least anyone could travel between checkpoints', () => {
    expect(checkpointGap({ id: 'a', kind: 'mark', at: [0, 0], radius_m: 5 }, { id: 'b', kind: 'mark', at: [100, 0], radius_m: 5 })).toBeCloseTo(90, 5);
    expect(checkpointGap({ id: 'a', kind: 'line', a: [0, -5], b: [0, 5] }, { id: 'b', kind: 'mark', at: [30, 0], radius_m: 10 })).toBeCloseTo(20, 5);
  });
});

describe('a match', () => {
  it('gathers, counts down, runs and finishes, in that order', () => {
    let m = createMatch('m1', 0);
    m = join(tiny, m, { id: 'ana', name: 'Ana' }, 0).match;
    expect(m.phase).toBe('lobby');
    expect(m.ready_at).toBeNull();
    m = join(tiny, m, { id: 'ben', name: 'Ben' }, 1000).match;
    expect(m.ready_at).toBe(1000);
    m = tick(tiny, m, 5000);
    expect(m.phase).toBe('lobby');
    m = tick(tiny, m, 11_000);
    expect(m.phase).toBe('countdown');
    expect(m.starts_at).toBe(14_000);
    expect(join(tiny, m, { id: 'cy', name: 'Cy' }, 12_000).match.players).toHaveLength(3);
    m = tick(tiny, m, 14_000);
    expect(m.phase).toBe('running');
    expect(join(tiny, m, { id: 'dee', name: 'Dee' }, 15_000).refused).toBe('started');
  });

  it('counts only the next checkpoint, after the start, and laps to the finish', () => {
    let m = start(tiny, join(tiny, join(tiny, createMatch('m', 0), { id: 'ana', name: 'Ana' }, 0).match, { id: 'ben', name: 'Ben' }, 0).match, 0).match;
    expect(pass(tiny, m, 'ana', 0, 1000).refused).toBe('too_early');
    m = tick(tiny, m, 3000);
    expect(pass(tiny, m, 'ana', 1, 4000).refused).toBe('out_of_order');
    for (const [who, index, at] of [['ana', 0, 5000], ['ana', 1, 7000], ['ben', 0, 6000], ['ana', 0, 9000], ['ana', 1, 11000]] as const) {
      const outcome = pass(tiny, m, who, index, at);
      expect(outcome.refused).toBeUndefined();
      m = outcome.match;
    }
    expect(pass(tiny, m, 'ana', 0, 12000).refused).toBe('finished');
    const table = standings(tiny, m);
    expect(table.map(s => [s.name, s.place, s.finished_ms])).toEqual([['Ana', 1, 8000], ['Ben', 2, null]]);
    expect(m.phase).toBe('running');
    m = tick(tiny, m, 3000 + 60_000);
    expect(m.phase).toBe('finished');
    expect(results(tiny, m).map(r => r.points)).toEqual([35, 0]);
  });

  it('goes back to waiting if the countdown loses its players', () => {
    let m = start(tiny, join(tiny, join(tiny, createMatch('m', 0), { id: 'ana', name: 'Ana' }, 0).match, { id: 'ben', name: 'Ben' }, 0).match, 0).match;
    m = leave(tiny, m, 'ben', 1000).match;
    expect(m.phase).toBe('lobby');
    expect(m.starts_at).toBeNull();
  });

  it('shares players between teams and places a team by its best', () => {
    const teams: GameSpec = { ...tiny, players: { min: 1, max: 4 }, teams: [{ id: 'red', name: 'Red', colour: '#ff0000' }, { id: 'blue', name: 'Blue', colour: '#0000ff' }] };
    let m = createMatch('m', 0);
    for (const id of ['a', 'b', 'c']) m = join(teams, m, { id, name: id }, 0).match;
    expect(m.players.map(p => p.team)).toEqual(['red', 'blue', 'red']);
    m = tick(teams, start(teams, m, 0).match, 3000);
    m = pass(teams, m, 'b', 0, 4000).match;
    expect(teamStandings(teams, m).map(t => t.team)).toEqual(['blue', 'red']);
  });
});

describe('the harness', () => {
  it('races the boat race example with bots: everyone finishes, fastest first', () => {
    const run = simulate(spec, [{ name: 'Slow', speed_mps: 10 }, { name: 'Fast', speed_mps: 16 }]);
    expect(run.results.map(r => r.name)).toEqual(['Fast', 'Slow']);
    expect(run.results.every(r => r.finished_ms !== null)).toBe(true);
    // Round the island in about a minute and a half at 16 m/s.
    expect(run.results[0]!.finished_ms! / 1000).toBeGreaterThan(50);
    expect(run.results[0]!.finished_ms! / 1000).toBeLessThan(120);
    expect(run.results[0]!.points).toBe(35);
  });
});
