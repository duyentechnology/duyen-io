-- The gift loop, stage by stage, across everyone.
--
-- Print runs is caller-scoped and answers "what did I print". This answers a
-- different question — does a moment actually make it all the way to someone —
-- and it has to look across all users to be worth anything, so it is SECURITY
-- DEFINER and gated to the admin email rather than RLS.
--
-- The stages are deliberately raw counts of the same population, so the drop
-- between them is readable at a glance:
--   created  every moment started
--   written  a message was actually composed
--   sent     left draft (status active)
--   opened   scanned by anyone at least once
--   replied  the receiver wrote back
--
-- sent can exceed written on old rows that went active without giver_data;
-- that is real data, not a bug, and flattening it would hide it.

create or replace function public.moment_funnel()
returns table (
  created bigint,
  written bigint,
  sent    bigint,
  opened  bigint,
  replied bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'redruffles@live.com' then
    raise exception 'not_authorised';
  end if;

  return query
    select
      count(*)                                                as created,
      count(*) filter (where giver_data is not null)          as written,
      count(*) filter (where status = 'active')                as sent,
      count(*) filter (where coalesce(scan_count, 0) > 0)      as opened,
      count(*) filter (where receiver_data is not null)        as replied
    from public.qr_codes
    where source = 'moment';
end $$;

revoke all on function public.moment_funnel() from public;
grant execute on function public.moment_funnel() to authenticated;

comment on function public.moment_funnel() is
  'Platform-wide gift-loop funnel for moments: created, written, sent, opened, replied. Admin only.';
