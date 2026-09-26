#!/usr/bin/env node
// elsewhere-game validate <spec.json>                        check a game spec as the world will
// elsewhere-game simulate <spec.json> [bots]                 race it with bots and print the results
// elsewhere-game publish  <spec.json> --region <region_id>   put it live on a region you can build in
//                                     [--game <game_id>]     (or replace that game's spec)
import { readFileSync } from 'node:fs';
import { simulate, validateSpec } from '../dist/index.js';

const USAGE = `Usage:
  elsewhere-game validate <spec.json>
  elsewhere-game simulate <spec.json> [bots=3]
  elsewhere-game publish  <spec.json> --region <region_id> [--game <game_id>]

publish reads ELSEWHERE_API_URL (the world's API) and ELSEWHERE_API_KEY
(a developer key, from POST /keys) from the environment.`;

const args = process.argv.slice(2);
const [command, file] = args;
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (!['validate', 'simulate', 'publish'].includes(command) || !file) {
  console.log(USAGE);
  process.exit(command && !['-h', '--help', 'help'].includes(command) ? 1 : 0);
}

let input;
try { input = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { console.error(`Could not read ${file}: ${error.message}`); process.exit(1); }
const checked = validateSpec(input);
if (!checked.ok) {
  console.error(`${file} is not a valid game:`);
  for (const message of checked.errors) console.error(`  • ${message}`);
  process.exit(1);
}
const spec = checked.spec;
console.log(`✓ ${spec.name}: ${spec.course.checkpoints.length} checkpoints × ${spec.course.laps} lap(s), ${spec.players.min}–${spec.players.max} players`);

if (command === 'validate') process.exit(0);

if (command === 'simulate') {
  const count = Math.max(1, Math.min(spec.players.max, Number(args[2]) || 3));
  const bots = Array.from({ length: count }, (_, i) => ({ name: `Bot ${i + 1}`, speed_mps: 10 + i * 2 }));
  const run = simulate(spec, bots);
  for (const line of run.log) console.log(`  ${line}`);
  console.log('\nPlace  Player   Time      Points');
  for (const r of run.results) console.log(`${String(r.place).padEnd(7)}${r.name.padEnd(9)}${(r.finished_ms === null ? 'DNF' : `${(r.finished_ms / 1000).toFixed(1)} s`).padEnd(10)}${r.points}`);
  process.exit(0);
}

// publish
const api = (process.env.ELSEWHERE_API_URL ?? '').trim().replace(/\/+$/, '');
const key = (process.env.ELSEWHERE_API_KEY ?? '').trim();
const region = option('region');
const gameId = option('game');
if (!api || !key) { console.error('Set ELSEWHERE_API_URL and ELSEWHERE_API_KEY (a developer key from POST /keys).'); process.exit(1); }
if (!region && !gameId) { console.error('Give --region <region_id> for a new game, or --game <game_id> to replace one.'); process.exit(1); }
let url;
try { url = new URL(api); } catch { console.error(`ELSEWHERE_API_URL is not a URL: ${api}`); process.exit(1); }
// A key is a password: never send it in the clear, except to this machine.
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  console.error(`Refusing to send your key over ${url.protocol} to ${url.hostname}; use https.`);
  process.exit(1);
}

async function call(method, path, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { 'x-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: { message: text.slice(0, 300) } }; }
  if (!response.ok) {
    const error = data.error ?? {};
    console.error(`${method} ${path} → ${response.status}: ${error.message ?? 'failed'}`);
    for (const message of error.details?.errors ?? []) console.error(`  • ${message}`);
    process.exit(1);
  }
  return data;
}

// The same name on the same region is the same game: replace it rather than run it twice.
let target = gameId;
if (!target) {
  const { games } = await call('GET', `/v1/regions/${encodeURIComponent(region)}/games`);
  target = games.find(g => g.game.spec.name === spec.name)?.game.id;
}
const { game } = target
  ? await call('PUT', `/v1/games/${encodeURIComponent(target)}`, { spec })
  : await call('POST', `/v1/regions/${encodeURIComponent(region)}/games`, { spec });
console.log(`${target ? 'Updated' : 'Published'} “${game.spec.name}” as ${game.id} on ${game.region_id}.`);
