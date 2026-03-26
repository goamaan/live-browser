# Contributing

## Local setup

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm lint
corepack pnpm test
```

## Development rules

- Keep the live attach path raw-CDP only.
- Do not add Playwright `connectOverCDP` to the live mode.
- Playwright is allowed only for managed-browser fallback.
- Prefer JSON-first daemon contracts over human-only CLI formatting.
- Add new agent-facing actions only when they return stable, machine-readable data.

## Repo layout

- `packages/core`: transport, daemon, actions, snapshots, browser adapters
- `packages/sdk`: client-side ergonomic wrapper over daemon RPC
- `packages/cli`: command parsing and output formatting

## Testing focus

- live attach discovery
- page aliasing and resolution
- snapshot stability
- structured action results
- managed-browser fallback smoke paths
