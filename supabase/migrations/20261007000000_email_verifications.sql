-- Email verification — real magic-link flow (replaces the old client-side 6-digit
-- mock). One row per user tracks whether their email is confirmed and holds the
-- hash of the current magic-link token. Signup stays frictionless: the user is
-- let straight into the app and a soft, dismissible banner asks them to confirm.
-- Nothing is gated on verification yet — this is a reminder, not a wall.
--
-- Shared backend: both apps (duyen.io customers, dayduyen.tech businesses) write
-- here through the same edge functions; `app` records which app a given user
-- verified from so the right branded sender / link is used. Additive: one new
-- table, nothing existing is touched.
--
-- Writes are service-role only (the send-verify-email / verify-email functions).
-- The client may read ONLY its own row, to decide whether to show the banner.
-- The raw token never lives here — only its sha256 hash — so a DB read can't be
-- replayed as a working magic link.

create table if not exists public.email_verifications (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  app         text not null default 'duyen'  check (app in ('duyen','dayduyen')),
  token_hash  text,                           -- sha256(hex) of the magic-link token; null once consumed
  verified_at timestamptz,                    -- null = not yet confirmed
  sent_at     timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  created_at  timestamptz not null default now()
);

-- Lookup by token at verify time (service role). Partial: only live tokens.
create unique index if not exists email_verifications_token_hash_idx
  on public.email_verifications (token_hash) where token_hash is not null;

alter table public.email_verifications enable row level security;

-- The signed-in user can read their own row (banner: verified or not). No client
-- insert/update/delete — all writes go through the service-role edge functions.
drop policy if exists email_verifications_select_own on public.email_verifications;
create policy email_verifications_select_own on public.email_verifications
  for select using (auth.uid() = user_id);

grant select on public.email_verifications to authenticated;
grant all    on public.email_verifications to service_role;
