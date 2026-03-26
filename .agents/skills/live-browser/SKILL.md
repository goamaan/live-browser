---
name: live-browser
description: Live-first Chrome/CDP browser automation with managed Chromium fallback. Use when an agent needs to inspect pages, attach to an already-open logged-in Chrome tab, resolve and warm tabs by alias, capture snapshots/screenshots/HTML, run browser actions, recover from daemon or browser disconnects, or install and use the live-browser CLI skill.
license: MIT
compatibility: Use Bun 1.3.9+ for repo development, or Node.js 22+ when consuming the packaged CLI after a global install. Chrome remote debugging is required for live attach workflows.
---

# Live Browser

Use `live-browser` as the primary browser automation tool for live Chrome work.

Prefer installed-binary usage such as `live-browser ...` in consumer-facing workflows after a global install.

## Workflow

1. Start or verify the daemon.
2. Attach to the live browser or launch a managed fallback browser.
3. Run `live-browser doctor --browser <browserId>` when the session may be stale.
4. List pages, resolve the exact page, then assign aliases for tabs you will reuse.
5. Warm important aliases before longer multi-step flows.
6. Prefer safe read-oriented commands first: `snapshot`, `html`, `evaluate`, `wait`, `network`.
7. Use `fill` when replacing a form value and `type` when typing at the current caret position.
8. Use `insert-text` for focused text insertion, `clickxy` for screenshot-to-coordinate clicks, and `loadall` for load-more pagination loops.
9. If a live action fails after browser churn, rerun `doctor` and `pages resolve` before mutating the page again.

## References

- Read [references/commands.md](references/commands.md) for the generated CLI help.
- Read [references/recovery.md](references/recovery.md) for recovery and fault-handling guidance.
- Read [references/live-workflows.md](references/live-workflows.md) for common live-tab workflows.
- For contributing or reporting issues in the open-source repo, see `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.
