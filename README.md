# browser-bridge

`browser-bridge` is a live-first browser automation toolkit for AI agents.

It combines the strongest ideas from `chrome-cdp` and `dev-browser`:

- raw CDP attach to real, already-open Chrome-family browser sessions
- a long-lived daemon with warm tab sessions and stable aliases
- a Playwright-like SDK for common page actions
- JSON-first command responses optimized for agents instead of brittle text scraping
- managed Chromium fallback when a clean automation session is a better fit

## Why this exists

Existing browser tools tend to optimize for one of two paths:

- direct live-Chrome control with low overhead but rough ergonomics
- ergonomic page APIs with more runtime overhead and less predictable live-session attach

`browser-bridge` is designed to keep live-session attach fast and reliable while still feeling familiar to anyone who has used Playwright.

## Packages

- `@browser-bridge/core`: CDP transport, daemon, page registry, snapshots, and browser adapters
- `@browser-bridge/sdk`: JS/TS client API for scripts and agent wrappers
- `@browser-bridge/cli`: end-user CLI

## Quick start

```bash
corepack pnpm install
corepack pnpm exec playwright install chromium
corepack pnpm build
node ./packages/cli/dist/index.js daemon start
node ./packages/cli/dist/index.js browsers attach --browser-id chrome
node ./packages/cli/dist/index.js pages list --browser chrome
```

## Live browser attach

The live mode uses Chrome's DevTools Protocol directly. It can resolve a browser endpoint from:

- an explicit `ws://...` endpoint
- an explicit `http://...` endpoint
- an explicit `DevToolsActivePort` file
- standard `DevToolsActivePort` locations for Chrome-family browsers

Typical Windows launch flow:

```powershell
chrome.exe --remote-debugging-port=9222
```

Then:

```bash
node ./packages/cli/dist/index.js browsers attach --browser-id chrome
```

For explicit endpoints:

```bash
node ./packages/cli/dist/index.js browsers attach --browser-id chrome --http-endpoint http://127.0.0.1:9222
node ./packages/cli/dist/index.js browsers attach --browser-id chrome --ws-endpoint ws://127.0.0.1:9222/devtools/browser/...
```

## Managed fallback

Managed mode launches a fresh Chromium instance through Playwright and adapts it into the same page API.

```bash
node ./packages/cli/dist/index.js browsers launch --browser-id managed --url https://example.com
node ./packages/cli/dist/index.js pages list --browser managed
```

## Scripts and smoke checks

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm smoke:managed`

`bridge run <script.ts>` is supported on Node 22+ through Node's type-stripping runtime flag, so small trusted TS automation scripts can call the SDK without a separate build step.

```bash
node ./packages/cli/dist/index.js run ./examples/status.ts
```

## Current status

This repo is bootstrapped as an OSS-ready package, but it is still intentionally private while the API and attach flow stabilize.

See [docs/architecture.md](./docs/architecture.md) for the design.
