# Command reference

Generated from the live CLI help so the skill stays aligned with the shipped interface.

<!-- GENERATED:CLI-REFERENCE:START -->

### live-browser --help

```text
Usage: live-browser [options] [command]

Live-first browser automation

Options:
  -h, --help                               display help for command

Commands:
  daemon                                   Manage the local daemon
  browsers                                 Attach or launch browsers
  pages                                    Manage pages
  doctor [options] [page]
  snapshot [options] <page>
  screenshot [options] <page>
  html [options] <page>
  evaluate [options] <page> <expression>
  goto [options] <page> <url>
  reload [options] <page>
  click [options] <page> <locator>
  clickxy [options] <page> <x> <y>         Click CSS pixel coordinates within the page viewport.
  fill [options] <page> <locator> <value>  Replace the current field value and dispatch input/change events.
  type [options] <page> <locator> <value>  Type at the current caret position after focusing the target element.
  insert-text [options] <page> <value>     Insert text into the currently focused element without resolving a locator first.
  loadall [options] <page> <locator>       Repeatedly click a load-more style control until it disappears, disables, or hits a safety limit.
  press [options] <page> <key>
  hover [options] <page> <locator>
  wait [options] <page>
  network [options] <page>
  cdp [options] <page> <method> [json]
  run <scriptPath>                         Run a local JS or TS script that exports a default async function
  skill                                    Work with the packaged live-browser skill
  help [command]                           display help for command
```

### live-browser daemon --help

```text
Usage: live-browser daemon [options] [command]

Manage the local daemon

Options:
  -h, --help      display help for command

Commands:
  start
  status
  stop
  help [command]  display help for command
```

### live-browser browsers --help

```text
Usage: live-browser browsers [options] [command]

Attach or launch browsers

Options:
  -h, --help        display help for command

Commands:
  list
  attach [options]
  launch [options]
  detach [options]  Detach one browser session from the daemon without stopping
                    the whole daemon.
  help [command]    display help for command
```

### live-browser pages --help

```text
Usage: live-browser pages [options] [command]

Manage pages

Options:
  -h, --help                      display help for command

Commands:
  list [options]
  resolve [options] <page>
  alias [options] <page> <alias>
  open [options] <url>
  close [options] <page>
  warm [options] [pages...]
  help [command]                  display help for command
```

### live-browser skill --help

```text
Usage: live-browser skill [options] [command]

Work with the packaged live-browser skill

Options:
  -h, --help         display help for command

Commands:
  install [options]
  help [command]     display help for command
```
<!-- GENERATED:CLI-REFERENCE:END -->
