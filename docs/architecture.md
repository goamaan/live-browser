# Architecture

## Core ideas

`browser-bridge` is built around a single principle: live browser automation should stay lightweight even when it is agent-friendly.

That leads to four choices:

1. Live attach uses raw CDP over WebSocket.
2. The daemon owns browser sessions and tab-session reuse.
3. CLI output is a view over structured daemon responses.
4. Managed automation uses Playwright only when a fresh browser is explicitly requested.

## Modes

### Live

- Attach to an already-running Chrome-family browser.
- Resolve the browser endpoint from `DevToolsActivePort`, an explicit URL, or a direct file path.
- Track pages with `Target` domain events.
- Attach to tabs lazily with `Target.attachToTarget({ flatten: true })`.

### Managed

- Launch Chromium through Playwright.
- Adapt Playwright pages into the same `PageLike` contract exposed by live sessions.

## Daemon

The daemon is a single local process that:

- owns all active browser sessions
- caches warm page sessions
- stores alias mappings
- handles RPC from the SDK and CLI
- persists no sensitive browser state outside runtime metadata

IPC is newline-delimited JSON over a local named pipe or Unix socket.

## Agent-focused contracts

`browser-bridge` is intentionally biased toward AI clients, so the primary contracts are structured:

- browser summaries for connection state and source metadata
- page summaries with stable `browserId`, `targetId`, and optional aliases
- action results that always include page context, URL, title, and optional diagnostics
- semantic snapshots with stable node ids, locator suggestions, and optional diffs

This keeps SDK and CLI output predictable enough for agents to chain actions without reparsing human prose.

## Page actions

Most page actions are implemented in a shared way:

- resolve page reference
- ensure page session is attached
- resolve locator
- perform the action
- return structured diagnostics

The raw CDP escape hatch exists for anything not wrapped yet.

## Testing strategy

The current repo includes:

- unit coverage for locator normalization and live-endpoint resolution
- a managed-browser smoke script that launches Playwright Chromium, exercises the daemon + SDK stack, and verifies snapshot/fill/click/wait/screenshot flow

Live authenticated-tab regression coverage is left as the next layer because it depends on a real local Chrome session with remote debugging enabled.
