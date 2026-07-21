# Supabase read-only access for Claude Code (debugging)

Purpose: let Claude inspect the live database (rows, schema, RLS policies, logs,
advisors) to diagnose issues quickly — including from a phone via the Claude Code
web/mobile app — **without** standing write access to production.

## TL;DR

1. Allow Supabase egress in the environment's **network policy** (blocker — see below).
2. Create a **read-only** Supabase personal access token, scoped to this project.
3. Store it as an **environment-level secret** (not laptop-local) so any session inherits it.
4. Register the Supabase MCP server with `--read-only --project-ref=qnlaaieyipeglfuepmor`.

---

## 0. Network egress (do this first — it is the blocker)

As checked on 2026-07-19, this Claude Code environment's egress policy **blocks**
Supabase: outbound to both `api.supabase.com` and
`qnlaaieyipeglfuepmor.supabase.co` returns HTTP 403 at the proxy. Until the policy
allows those hosts, the MCP server cannot reach Supabase regardless of token.

Fix: when configuring the Claude Code web environment, choose/adjust the network
policy to allow egress to:

- `api.supabase.com`         (Supabase Management API — schema, logs, advisors)
- `*.supabase.co`            (your project's Postgres/REST/Auth endpoints)

Docs: https://code.claude.com/docs/en/claude-code-on-the-web

## 1. Create a read-only token

Supabase dashboard → Account → **Access Tokens** → generate a token.
Name it something like `claude-readonly-debug`. Keep it out of git.

## 2. Store it as an environment secret (not laptop-local)

For the "I'm away from my computer" case to work, the token must live at the
**environment level** so a session started from the mobile app inherits it —
a token that only sits in your laptop's local config is absent exactly when
you're away from the laptop.

Set it as a secret / env var in the Claude Code web environment config:

```
SUPABASE_ACCESS_TOKEN=<your read-only token>
```

## 3. Register the MCP server (read-only)

```jsonc
// MCP server entry — read-only, scoped to this one project
{
  "command": "npx",
  "args": [
    "-y", "@supabase/mcp-server-supabase@latest",
    "--read-only",
    "--project-ref=qnlaaieyipeglfuepmor"
  ],
  "env": { "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}" }
}
```

`--read-only` restricts DB access to read-only queries. `--project-ref` scopes
the server to this project only. With this, a session gets `mcp__supabase__*`
tools for inspection but cannot mutate data or schema.

## What read-only covers vs. doesn't

Covers (the bulk of debugging):
- Read rows to confirm what actually got stored (e.g. is `occurred_at` null? did
  the day shift by timezone?)
- Inspect tables, columns, types, defaults — catch schema drift
- Inspect RLS policies and test selects as a role — the usual "returns empty, not
  an error" bug in a browser-direct-to-Supabase app like this one
- Read logs; run Supabase security/performance advisors

Does NOT cover:
- Applying migrations or fixing data — that needs write access. Prefer doing that
  against a **staging/branch project**, or enable write deliberately per-migration
  then revert to read-only.
- Client-side JS bugs in `index.html` — those need no Supabase access; Claude
  debugs them from the repo directly.

## Safety notes

- **Never use the `service_role` key for debugging.** It bypasses RLS, so you'd
  see data through a lens real users never have — hiding the very RLS bugs you're
  hunting. Use a scoped read-only token.
- Production holds real users' moments (PII). Keep production access **read-only**;
  keep any write access on a separate dev/staging project.
- Rotate the token if it's ever exposed; it is not needed in the repo.

## Making away-from-computer fixes actually ship

Read-only access gets Claude to a **diagnosis** from your phone. To also *ship* a
fix without a laptop, pair it with:
- **Auto-deploy on merge** to `main`, so a Claude-pushed code fix goes live when
  you tap "merge" in the GitHub mobile app.
- Optionally a **staging project** with write access for Claude to test fixes safely.
