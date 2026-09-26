/**
 * An Elsewhere game, declared.
 *
 * A game is data, not code: where it is played, who may play, how a match
 * starts and ends, what counts, and what it pays. The world runs every game
 * with the same engine (./engine.ts), so a game cannot reach outside its own
 * play area, and the only way it touches the persistent world is the reward
 * it declares here, paid through the platform's scoreboard within its limits.
 *
 * Positions are in the region's own metres, about its centre: on a planet
 * plot that is the plot's frame, x east, z south, the sea at y = 0.
 */

export const GAME_SPEC_VERSION = 1;

/** A point on the ground: [x east, z south], in metres from the region's centre. */
export type Vec2 = [number, number];

/** How players move in a game: a boat (the stock one or one built there), any vehicle, on foot, or however they like. */
export type MoveMode = 'boat' | 'vehicle' | 'walk' | 'any';

/** Something to pass, in order. */
export type Checkpoint =
  /** A line to cross, from a to b: a start or finish line, a gate between two buoys. */
  | { id: string; kind: 'line'; a: Vec2; b: Vec2; label?: string }
  /** A mark to pass close by: a buoy to round, a flag to touch. */
  | { id: string; kind: 'mark'; at: Vec2; radius_m: number; label?: string };

/** Something drawn over the course for whoever is at the game: never built into the world, and gone with the game. */
export type Overlay =
  | { kind: 'label'; at: Vec2; text: string; colour?: string }
  | { kind: 'line'; from: Vec2; to: Vec2; colour?: string }
  | { kind: 'ring'; at: Vec2; radius_m: number; colour?: string };

export interface Team {
  id: string;
  name: string;
  /** #rrggbb. */
  colour: string;
}

/**
 * A race: pass every checkpoint in order, `laps` times. The last checkpoint
 * is the finish; make it the start line too and players, starting behind it,
 * cross it last. Fastest wins; whoever has not finished when time runs out is
 * placed by how far they got.
 */
export interface RaceCourse {
  checkpoints: Checkpoint[];
  laps: number;
}

export interface Scoring {
  /** The scoreboard key points go to (the region's own scoreboard). */
  key: string;
  /** Points for first, second, third… */
  places: number[];
  /** Points for finishing at all, on top of a place. */
  finish: number;
}

export interface GameSpec {
  spec_version: typeof GAME_SPEC_VERSION;
  kind: 'race';
  name: string;
  description?: string;
  /** Where the game is played. Checkpoints, the join zone and overlays all stay inside it. */
  area: { center: Vec2; radius_m: number };
  /** Where players stand (or float) to join the next match. */
  join: { center: Vec2; radius_m: number };
  players: { min: number; max: number };
  /** Optional; players are shared between teams as they join, and a team's place is its best player's. */
  teams?: Team[];
  mode: MoveMode;
  /** Seconds a lobby with enough players waits for more before it starts by itself. */
  lobby_s: number;
  countdown_s: number;
  time_limit_s: number;
  course: RaceCourse;
  scoring: Scoring;
  overlays?: Overlay[];
}

/** Limits the platform holds every game to. */
export const LIMITS = {
  name: 60,
  description: 500,
  players: 32,
  checkpoints: 64,
  laps: 20,
  overlays: 64,
  /** Most points one player can earn from one match, place and finish together. */
  pointsPerMatch: 100,
  countdown: [3, 30] as const,
  lobby: [0, 300] as const,
  timeLimit: [20, 3600] as const,
  /** A play area as big as the largest plot's reach. */
  areaRadius: 1000,
} as const;
