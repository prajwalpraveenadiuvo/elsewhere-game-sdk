# Changelog

## 0.1.0

First release.

- Game spec v1 with one kind of game, `race`. A race is checkpoints (marks
  and lines) passed in order for a number of laps, by boat, vehicle, on foot
  or any of these. It has a join ring, player limits, optional teams,
  lobby, countdown and time limit, scoring, and overlays drawn with the
  course.
- `validateSpec` gives field-by-field errors. It checks that the game fits
  inside the region, and it drops unknown fields.
- The match engine is pure functions: `createMatch`, `join`, `leave`,
  `start`, `tick`, `pass`, `standings`, `results` and `teamStandings`. It
  is the same engine the Elsewhere world runs.
- Geometry: `crossing`, `crossesLine`, `passesMark`, `checkpointGap` and
  `checkpointTarget`.
- `simulate` races bots round a course.
- The `elsewhere-game` CLI has three commands: `validate`, `simulate` and
  `publish`.
- The Ember Point Regatta is included as the reference boat race.
