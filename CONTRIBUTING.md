# Contributing

Thanks for helping. Issues and pull requests are welcome, especially:

- bug reports with a spec that shows the problem (`elsewhere-game validate`
  or `simulate` output helps);
- example games;
- clearer docs.

## Working on it

```
npm install
npm run build
npm test
node bin/elsewhere-game.mjs simulate examples/boat-race.json 4
```

The engine is the rulebook the world runs. A change to how matches start,
end or score changes every game already published, so it needs a test that
shows the old and new behaviour.

## How changes land

This repository is published from the Elsewhere monorepo, where the SDK sits
beside the world that runs it. A merged pull request is carried over there,
then released from there, with the change credited to you.

By contributing you agree that your contribution is licensed under the
Apache License, Version 2.0.
