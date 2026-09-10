-- Link vetting for business-profile URLs (website + social links).
--
-- Additive only: two NEW tables. No existing table is altered. Profiles and
-- qr_codes keep their current shape; vetting verdicts live here, and the public
-- fan-out (handled in the app + edge functions) publishes only 'live' links.
--
--   business_links     — current verdict per profile link slot (admin queue)
--   link_review_audit  — append-only history of every submission/check/decision
--
-- Writes happen through the vet-link / link-admin edge functions with the
-- service role. RLS lets an owner read only their own rows; the admin reads
-- across all businesses through the edge function (service role), never here.

-- ── current state ──────────────────────────────────────────────────────────
create table if not exists public.business_links (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  profile_id       text not null,
  kind             text not null,   -- website | facebook | pinterest | youtube | yelp | linkedin | x | instagram | tiktok
  url              text not null,   -- as submitted (https-normalised)
  final_url        text,            -- where it lands after redirects
  submitted_domain text,
  final_domain     text,
  status           text not null default 'flagged',  -- live | flagged | rejected | removed
  reasons          text[] not null default '{}',     -- why it was flagged (empty when live)
  checks           jsonb not null default '{}'::jsonb, -- full per-check result
  is_shortener     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  decided_at       timestamptz,     -- when an admin approved/rejected/removed
  decided_by       uuid,            -- admin user id
  constraint business_links_kind_chk
    check (kind in ('website','facebook','pinterest','youtube','yelp','linkedin','x','instagram','tiktok')),
  constraint business_links_status_chk
    check (status in ('live','flagged','rejected','removed'))
);

-- One current row per profile slot; re-submitting a slot updates it in place.
create unique index if not exists business_links_slot_uniq
  on public.business_links (user_id, profile_id, kind);
-- Admin queue: flagged first, newest first.
create index if not exists business_links_status_idx
  on public.business_links (status, created_at desc);

-- ── append-only audit (requirement 5) ──────────────────────────────────────
create table if not exists public.link_review_audit (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid references public.business_links(id) on delete set null,
  user_id    uuid,            -- owner of the link
  profile_id text,
  kind       text,
  url        text,
  event      text not null,   -- submitted | auto_live | auto_flagged | approved | rejected | removed | revet
  detail     jsonb not null default '{}'::jsonb,  -- check results / reason / actor note
  actor      text,            -- 'system' or a user id (owner/admin)
  created_at timestamptz not null default now()
);
create index if not exists link_review_audit_link_idx
  on public.link_review_audit (link_id, created_at desc);
create index if not exists link_review_audit_user_idx
  on public.link_review_audit (user_id, created_at desc);

-- ── RLS: owners read their own; all writes go through service-role fns ───────
alter table public.business_links    enable row level security;
alter table public.link_review_audit enable row level security;

drop policy if exists business_links_select_own on public.business_links;
create policy business_links_select_own on public.business_links
  for select using (auth.uid() = user_id);

drop policy if exists link_review_audit_select_own on public.link_review_audit;
create policy link_review_audit_select_own on public.link_review_audit
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for authenticated: only the service role
-- (which bypasses RLS) writes, via the edge functions.
grant select on public.business_links    to authenticated;
grant select on public.link_review_audit to authenticated;
grant all    on public.business_links    to service_role;
grant all    on public.link_review_audit to service_role;
