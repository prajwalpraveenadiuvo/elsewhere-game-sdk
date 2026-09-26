# Elsewhere Game SDK

Build mini-games that run inside Elsewhere. A game is a small JSON spec that
says where it's played, who can play, how a match starts and ends, what
counts, and what it pays. The world runs every game on the same engine (the
one in this package), so you can check a game on your own machine exactly as
the world will run it.

```
npm install @elsewhereprotocol/game-sdk
npx elsewhere-game validate my-race.json       # check it as the world will
npx elsewhere-game simulate my-race.json 4     # race it with four bots
npx elsewhere-game publish my-race.json --region <region_id>   # put it live
```

Node 20 or later. No runtime dependencies.

Version 1 supports one kind of game: **races**. Players pass checkpoints in
order, for a set number of laps, on foot, by boat or in any vehicle. The
[Ember Point Regatta](examples/boat-race.json) is the reference game: one lap
round a volcano island past six buoys, then back over the start line.

## How a game works

1. **You declare it.** You write a spec (below) and register it on a region
   you can build in (`POST /v1/regions/:id/games`). The world checks it with
   `validateSpec`, the same validator this package exports, and turns away
   anything outside the limits or outside the region.
2. **People play it.** Anyone who comes within reach of the play area sees
   the course, a **Join race** button and the best times. A match goes
   through four phases: `lobby` (waiting for players), `countdown` (the same
   moment on every screen, because it runs on the shared world clock),
   `running`, and `finished`. The results stay up for 30 seconds, then the
   game resets for the next match.
3. **The world keeps score.** Each client reports when its player crosses
   their next checkpoint. The world believes the report only if it passes all
   of these checks:
   - It is the player's next checkpoint.
   - The race has started.
   - The player's live presence is within 100 m of the checkpoint.
   - The player is moving the way the game is played (a boat race needs a
     boat or vehicle).
   - Nothing could have got there faster from the last checkpoint.

   Results are saved. Points go to the region's own scoreboard, capped at 100
   per player per match.

### What a game can't do

- It can't run code. A spec is data, and everything it can do is listed
  below.
- It can't build anything or change anything in the world. The course, the
  labels and the rings exist only in the viewer and disappear with the game.
- It can't reach outside its region. Every point must lie inside the play
  area, and the play area must lie inside the region.
- It can pay only through the platform's scoreboard, and only up to the
  points cap.

## The spec

Positions are `[x, z]` in metres from the region's centre. On a planet plot
this is the plot's own frame: x points east, z points south, and the sea is
at y = 0. These are the same coordinates builders use.

```jsonc
{
  "spec_version": 1,
  "kind": "race",
  "name": "Ember Point Regatta",              // ≤ 60 characters
  "description": "One lap round the island…", // optional, ≤ 500
  "area": { "center": [0, 0], "radius_m": 240 },        // where it's played; everything else stays inside
  "join": { "center": [179.2, -31.6], "radius_m": 30 }, // the start ring
  "players": { "min": 1, "max": 8 },          // max ≤ 32
  "teams": [{ "id": "red", "name": "Red", "colour": "#e5484d" }],  // optional
  "mode": "boat",                             // boat | vehicle | walk | any
  "lobby_s": 20,        // once there are enough players, wait this long for more (0–300)
  "countdown_s": 5,     // 3–30
  "time_limit_s": 300,  // from the start (20–3600); anyone still out is placed by progress
  "course": {
    "laps": 1,          // 1–20
    "checkpoints": [    // 1–64, passed in order; the last one is the finish
      { "id": "buoy-1", "kind": "mark", "at": [146.1, 102.6], "radius_m": 16, "label": "Buoy 1" },
      { "id": "finish", "kind": "line", "a": [149.4, 13.1], "b": [211.2, 18.5], "label": "Finish" }
    ]
  },
  "scoring": { "key": "score", "places": [30, 20, 10], "finish": 5 },
  "overlays": [         // optional, ≤ 64: drawn with the course, never built
    { "kind": "label", "at": [-205, -12], "text": "Halfway · island to starboard" },
    { "kind": "ring",  "at": [0, 0], "radius_m": 60, "colour": "#ff8a3d" },
    { "kind": "line",  "from": [0, 0], "to": [50, 0] }
  ]
}
```

- **Checkpoint kinds.** A `mark` is a buoy or flag: the player passes it by
  entering its `radius_m`. A `line` is a gate or a start/finish line: the
  player passes it by crossing the segment from `a` to `b`, in either
  direction. A line must be 2–400 m long.
- **Using the start line as the finish.** Make the finish line the last
  checkpoint and place the start ring just behind it. Players cross it on the
  way out, which doesn't count because it isn't their next checkpoint yet.
  They cross it again at the end, which does.
- **Scoring.** A finisher earns `places[place − 1]` plus `finish`, capped at
  100. A player who doesn't finish earns nothing. With `teams`, players are
  shared between teams as they join, and a team is placed by its best player.
- **Unknown fields are dropped.** Anything the validator doesn't recognise
  is removed, so a spec can't carry anything else into the world.

## The API

All endpoints are under the world API. Signed-in endpoints take a bearer
token.

| Endpoint | Who | What |
| --- | --- | --- |
| `POST /v1/regions/:id/games` `{ spec }` | Builders of the region | Register a game. A region can run at most 8. |
| `GET /v1/regions/:id/games` | Anyone who can see the region | Every game there, each with its live match. |
| `GET /v1/games/:id` | Anyone who can see the region | One game, its match with standings, and its best times. |
| `PUT /v1/games/:id` `{ spec }` | Builders | Replace the spec. A match in progress is dropped. |
| `DELETE /v1/games/:id` | Builders | Switch the game off. |
| `POST /v1/games/:id/join` / `leave` / `start` | Signed-in players | Join the next match, leave it, or start the countdown early. |
| `POST /v1/games/:id/pass` `{ checkpoint, at_ms }` | Players in the match | "I passed checkpoint `checkpoint` at `at_ms` on the world clock." |

A refused request returns `409` with `error.details.reason` set to one of
`full`, `started`, `already_joined`, `not_joined`, `not_running`,
`out_of_order`, `too_early`, `finished`, `not_enough_players`, `no_presence`,
`wrong_mode`, `not_near` or `implausible`.

## Using the engine directly

The engine is a set of pure functions over plain objects: no clock, no I/O.
That makes it easy to test your own tools against it.

```ts
import { createMatch, join, start, tick, pass, standings, results, validateSpec } from '@elsewhereprotocol/game-sdk';

const checked = validateSpec(json, { halfX: 250, halfZ: 250 });  // the region's half-size
if (!checked.ok) throw new Error(checked.errors.join('\n'));
const spec = checked.spec;

let match = createMatch('m1', Date.now());
match = join(spec, match, { id: 'ana', name: 'Ana' }, Date.now()).match;
match = start(spec, match, Date.now()).match;               // countdown_s from now
match = tick(spec, match, match.starts_at!);                 // → running
const outcome = pass(spec, match, 'ana', 0, match.starts_at! + 9_000);
if (outcome.refused) console.log(outcome.refused);          // e.g. 'out_of_order'
console.log(standings(spec, outcome.match), results(spec, outcome.match));
```

The package also exports the geometry the world uses: `crossing`,
`crossesLine`, `passesMark`, `checkpointGap` and `checkpointTarget`. It also
exports `simulate`, the harness behind the CLI, which races bots round a
course and reports the results.

## Publishing a game

A game goes live on a region you can build in: your own plot, or one whose
owner has let you build.

1. Get a developer key. Sign in, then call `POST /keys` with your session.
   The key is shown once, so keep it somewhere safe. It acts as you, with
   read and build rights.

   ```
   curl -X POST $ELSEWHERE_API_URL/keys -H "authorization: Bearer $TOKEN" \
     -H "content-type: application/json" -d '{"name":"my-games"}'
   ```

2. Publish:

   ```
   export ELSEWHERE_API_URL=https://<the world's API>
   export ELSEWHERE_API_KEY=sw_live_…
   npx elsewhere-game publish my-race.json --region reg_…
   ```

The CLI checks your spec first, then registers it. If a game with the same
name is already on that region, it replaces that game's spec instead of
adding a second copy. `--game <id>` replaces a particular game. The key is
read from the environment, never from the command line, and the CLI won't
send it over plain `http` to anything but `localhost`.

To take a game down, call `DELETE /v1/games/:id` with the same key.

## Not in version 1

- **Custom game code.** Scripted game logic would need a sandbox that can't
  reach anything but the game. Until that exists, games are declarations.
- **A public review queue for games.** Today a game is live as soon as a
  builder of the region registers it.
- **Physics simulated by the server.** Boats are simulated by each player's
  client. The world checks every report for presence, proximity, order and
  speed, which is enough for points on a scoreboard. It is not enough for
  prizes worth cheating for.
- **Surviving an API restart.** Matches in progress are kept in memory, so a
  restart loses them. Results and best times are saved.

## Contributing and licence

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Licensed under the [Apache License, Version 2.0](LICENSE). The licence covers
the code, not the Elsewhere name or brand; see [NOTICE](NOTICE).
