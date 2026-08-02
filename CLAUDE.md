# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Deploy workflow (important)

- **`duyen.io` deploys from the `main` branch.** A push to `main` triggers the
  production deploy (static site, Netlify-style — see `_redirects`; there is no
  in-repo build config).
- **Merge small and often.** After finishing a change (or a small related
  batch), get it to `main` so it deploys on its own. Do not let commits pile
  up unmerged on a feature branch.
- **Claude does the merge — but asks first.** Once a change is ready and
  tested, Claude performs the merge to `main` itself (the user does not have
  to). Before each production merge, ask the user for the go-ahead and state
  exactly what's in the batch so they can ship it or hold. Merge only after
  they confirm.
- **No big batched deploys.** Shipping a large pile of accumulated changes at
  once makes bugs hard to isolate and easy to break production. Prefer small,
  independently verifiable increments — each one easy to test and roll back.

## Project overview

- Single-page PWA. The entire app is **`index.html`** (no build step); assets
  are `sw.js` (service worker — caches Storage images cache-first; never caches
  DB/auth), `manifest.json`, icons.
- Two domains, one codebase: **duyen.io** is primary/canonical; **duyen.tech**
  (matched in code as `dayduyen.tech`) is the secondary domain.
- Backend is **Supabase** (project ref `qnlaaieyipeglfuepmor`, configured in
  `.mcp.json`). Edge functions live in `supabase/functions/`; migrations in
  `supabase/migrations/`.

## Testing frontend changes

The service worker caches the app shell, so after a deploy the user must fully
close/reopen the PWA (or hard-reload duyen.io) to pick up the new `index.html`.

## Media pipeline — verify data, not just CSS

- **Supabase image transforms distort with width-only params.** The render
  endpoint (`/storage/v1/render/image/public/...`) with only `?width=` squeezes
  width but keeps original height (1200x1800 → 340x1800). Always pass
  `width`+`height`+`resize=contain` (see `thumbUrl()` in `index.html`).
- **Any change to image/media URLs must be verified against a real photo**:
  fetch the actual URL the app will request (curl through the proxy with the
  public anon key from `index.html`) and check the returned dimensions with
  `file`, then render it in the real CSS frame (Playwright headless) before
  merging. Layout smoothness alone is not a test.
- **When a visual regression appears, bisect by layer, not by guessing CSS**:
  first confirm what bytes the server returns, then the CSS. If a screenshot
  of a "known good" state exists, diff the code of that exact commit
  (`git show <commit>:index.html`) instead of iterating on new layouts.
