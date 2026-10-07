-- "What's New" digest — periodic email to customers summarizing new promotions
-- from the businesses they saved to their tapestry (tapestry.role='business').
-- Mirrors the in-app promo notifications (syncPromoNotifications), but as an
-- email batch. Additive: one prefs/watermark table + one read-only function.
--
-- No digest state existed before this. We track, per customer: whether they want
-- the email (email_opt_in, default on), a stable unsubscribe token for one-click
-- CAN-SPAM unsubscribe without login, and the last time we sent them a digest
-- (the watermark that makes "what's NEW" mean new since last send).

create table if not exists public.digest_prefs (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  email_opt_in      boolean not null default true,
  -- 64 hex chars, unguessable; used only in the unsubscribe link (no login needed)
  unsubscribe_token text not null unique
                    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  last_digest_at    timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.digest_prefs enable row level security;

-- The signed-in user can read and toggle their own email preference (for an
-- in-app toggle later). The watermark + token are managed by the service role.
drop policy if exists digest_prefs_select_own on public.digest_prefs;
create policy digest_prefs_select_own on public.digest_prefs
  for select using (auth.uid() = user_id);

drop policy if exists digest_prefs_update_own on public.digest_prefs;
create policy digest_prefs_update_own on public.digest_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, update on public.digest_prefs to authenticated;
grant all            on public.digest_prefs to service_role;

-- Candidate rows for a digest run: one row per customer who has at least one NEW,
-- non-empty promotion from a business they saved, since their last digest (or
-- since they joined, if never sent). Returns the promos already aggregated so the
-- edge function just formats + emails. SECURITY DEFINER so it can read auth.users
-- and cross-user tapestry/qr_codes; locked to the service role only.
create or replace function public.whatsnew_digest_candidates()
returns table (user_id uuid, email text, promos jsonb)
language sql
security definer
set search_path = public
as $$
  select
    u.id as user_id,
    u.email,
    jsonb_agg(
      jsonb_build_object(
        'business',  coalesce(q.business_data->>'name', 'A shop you saved'),
        'text',      q.promotion->>'text',
        'photos',    coalesce(q.promotion->'photos', '[]'::jsonb),
        'pushedAt',  q.promotion->>'pushedAt',
        'qr_code_id', q.id
      )
      order by (q.promotion->>'pushedAt')::timestamptz desc
    ) as promos
  from auth.users u
  join public.tapestry t on t.user_id = u.id and t.role = 'business'
  join public.qr_codes q on q.id = t.qr_code_id
  left join public.digest_prefs d on d.user_id = u.id
  where q.promotion is not null
    and (q.promotion->>'pushedAt') is not null
    and (
      coalesce(q.promotion->>'text', '') <> ''
      or jsonb_array_length(coalesce(q.promotion->'photos', '[]'::jsonb)) > 0
    )
    and (q.promotion->>'pushedAt')::timestamptz > coalesce(d.last_digest_at, u.created_at)
    and coalesce(d.email_opt_in, true) = true
    and u.email is not null
  group by u.id, u.email;
$$;

revoke all on function public.whatsnew_digest_candidates() from public, anon, authenticated;
grant execute on function public.whatsnew_digest_candidates() to service_role;
