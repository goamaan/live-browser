# Live workflows

## Install or run once

```text
bunx live-browser --help
npx live-browser --help
```

## Attach to a logged-in Chrome session

```text
live-browser browsers attach --browser-id chrome
live-browser doctor --browser chrome
live-browser pages list --browser chrome
live-browser pages resolve "<part-of-url-or-title>" --browser chrome
live-browser pages alias <targetId> app --browser chrome
live-browser pages warm app --browser chrome
```

## Inspect before mutating

```text
live-browser snapshot app --browser chrome
live-browser html app --browser chrome
live-browser evaluate app "document.title" --browser chrome
live-browser network app --browser chrome
```

## Mutate with clear intent

```text
live-browser fill app "input[name='search']" "segments" --browser chrome
live-browser type app "input[name='search']" " more" --browser chrome
live-browser click app "text=Apply" --browser chrome
live-browser wait app --text "Updated" --browser chrome
```

## Parity helpers for chrome-cdp-style flows

```text
live-browser insert-text app "already-focused text" --browser chrome
live-browser clickxy app 640 240 --browser chrome
live-browser loadall app "text=Load more" --browser chrome --interval 250
live-browser browsers detach --browser-id chrome
```
