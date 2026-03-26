# live-browser

`live-browser` is a live-first browser automation toolkit for AI agents.

It can attach to an already-open Chrome session over raw CDP, keep page aliases warm across commands, and fall back to managed Chromium when you want a clean browser instead of a live one.

## Install

```bash
bunx live-browser --help
npx live-browser --help
```

For a persistent install:

```bash
bun add -g live-browser
npm i -g live-browser
```

The installed binary is `live-browser`.

## Quick start

Launch Chrome with remote debugging enabled, then attach:

```powershell
chrome.exe --remote-debugging-port=9222
```

```bash
live-browser browsers attach --browser-id chrome
live-browser pages list --browser chrome
live-browser pages alias <targetId> app --browser chrome
live-browser snapshot app --browser chrome
live-browser screenshot app --browser chrome
```

If you want a clean browser instead of your real Chrome session:

```bash
live-browser browsers launch --browser-id managed --url https://example.com
live-browser pages list --browser managed
live-browser snapshot <targetId> --browser managed
```

## Why live-browser

- Raw CDP in live mode, so attach goes straight to Chrome instead of relying on Playwright `connectOverCDP`.
- A long-lived daemon that keeps browser sessions, warmed pages, and aliases stable across commands.
- JSON-first CLI responses and structured error envelopes that are easy for agents to consume.
- Managed Chromium fallback for isolated automation or CI smoke testing.

## Common commands

Inspect and resolve pages:

```bash
live-browser doctor --browser chrome
live-browser pages list --browser chrome
live-browser pages resolve app --browser chrome
live-browser html app --browser chrome
live-browser evaluate app "document.title" --browser chrome
```

Mutate pages:

```bash
live-browser fill app "input[name='email']" "test@example.com" --browser chrome
live-browser type app "input[name='email']" " more" --browser chrome
live-browser insert-text app "already-focused text" --browser chrome
live-browser click app "text=Submit" --browser chrome
live-browser clickxy app 640 240 --browser chrome
live-browser loadall app "text=Load more" --browser chrome
```

Manage browser sessions:

```bash
live-browser browsers list
live-browser browsers detach --browser-id chrome
live-browser daemon status
live-browser daemon stop
```

For the full generated command reference, see [docs/cli.md](docs/cli.md).

## Examples

- [examples/alias-tabs.ts](examples/alias-tabs.ts): repo-local example for aliasing and warming tabs in a workspace checkout
- [examples/status.ts](examples/status.ts): repo-local example for fetching daemon status in a workspace checkout

## Skills

The repository includes a standard Agent Skills skill at `.agents/skills/live-browser/` and packages a copy with the CLI.

Install it with:

```bash
live-browser skill install --global
live-browser skill install --project .
```

## Development

`live-browser` uses Bun for local development and npm for publish/auth checks.

```bash
bun install
bun run playwright:install
bun run build
bun run test
```

Useful validation commands:

- `bun run lint`
- `bun run typecheck`
- `bun run docs:generate`
- `bun run skill:sync`
- `bun run skill:validate`
- `bun run smoke:managed`

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow and [docs/architecture.md](docs/architecture.md) for the design notes.


## Security and community

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending changes.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in issues, discussions, and pull requests.
- Report sensitive security concerns through [SECURITY.md](SECURITY.md), not public issues.
