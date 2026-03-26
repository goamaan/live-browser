# Contributing

## Local setup

```bash
bun install
bun run playwright:install
bun run build
```

## Validation

Before sending a change, run:

```bash
bun run lint
bun run typecheck
bun run test
bun run docs:generate
bun run skill:sync
```

For changes that affect packaging, install flows, or the managed browser path, also run:

```bash
bun run pack:check
bun run consumer:smoke
bun run smoke:managed
```

## Development rules

- Keep the live attach path raw-CDP only.
- Do not add Playwright `connectOverCDP` to live mode.
- Keep CLI responses machine-readable.
- Return structured faults for recoverable failures.
- Keep examples, skills, and docs generic and public-safe.

## Project layout

- `packages/core`: transport, daemon, actions, snapshots, browser adapters
- `packages/sdk`: JS/TS client wrapper
- `packages/cli`: command surface and packaged skill payload
- `.agents/skills/live-browser`: source skill
- `docs/`: architecture and generated CLI docs

## Community expectations

- Be respectful and constructive in issues and pull requests.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Report sensitive security issues through [SECURITY.md](SECURITY.md), not public issues.
