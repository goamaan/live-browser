# AGENTS.md

## Purpose

Contributor contract for `live-browser`.

## Product rules

- Keep live mode raw-CDP only.
- Do not add Playwright `connectOverCDP` to the live attach path.
- Keep structured JSON responses and structured faults as the main machine contract.
- Treat recovery as part of the product, not caller-side glue.
- Keep command semantics stable:
  - `fill` replaces a value
  - `type` types at the caret after focusing a locator
  - `insert-text` writes into the currently focused element
  - `clickxy` uses viewport CSS pixels

## Docs and skills

- Update docs and the packaged skill in the same change when CLI or SDK behavior changes.
- Keep `.agents/skills/live-browser/` as the source of truth.
- Run `bun run docs:generate` after changing CLI help text or command structure.
- Run `bun run skill:sync` after changing anything under `.agents/skills/live-browser/`.
- Prefer relative links in repo docs. Do not commit local absolute filesystem paths.

## Validation

Run this full set for CLI, packaging, or skill changes:

- `bun run build`
- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run docs:generate`
- `bun run skill:sync`
- `bun run skill:validate`
- `bun run pack:check`
- `bun run smoke:managed`

Also run these for install-flow or release changes:

- `bun run consumer:smoke`
- `bun run release:check`

## Public repo expectations

- Keep examples generic and reusable.
- Keep the README product-focused: install, quick start, command overview, examples, and docs links.
- Put detailed generated command help in docs, not in the contributor contract.
- Keep security, conduct, and contribution docs usable for outside contributors without private internal assumptions.
