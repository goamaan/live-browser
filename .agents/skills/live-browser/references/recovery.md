# Recovery

## Start here

- Run `live-browser doctor --browser <browserId>` when the daemon, browser, or page mapping might be stale.
- Use `live-browser pages resolve <ref> --browser <browserId>` before retrying a multi-step workflow if a tab may have been replaced.
- Prefer aliases plus `pages warm` for tabs you will revisit repeatedly.

## Fault handling expectations

- Safe read-oriented operations can recover once after daemon or live-browser transport loss.
- Mutating actions such as `click`, `clickxy`, `fill`, `type`, `insert-text`, `loadall`, `press`, `hover`, `open`, and `close` are not silently replayed after disconnects.
- `fill` replaces the field value; `type` appends at the current caret after focusing the target element; `insert-text` writes into the already focused control.

## Live browser recovery

- Keep Chrome remote debugging enabled for live attach.
- If the daemon restarts, persisted live browser metadata is used to restore the browser session.
- If Chrome reopens tabs with new target ids, aliases can be rebound using the stored URL/title metadata.
