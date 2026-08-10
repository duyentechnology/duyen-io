-- What happened to the codes I printed.
--
-- Counting this in the client would mean pulling every row just to tally it,
-- and the jsonb columns it needs to test (giver_data, receiver_data) are the
-- heaviest ones on the table. One aggregate does it server-side.
--
-- Deliberately NOT admin-only and NOT security definer: it reports the caller's
-- own codes, so RLS already scopes it correctly and a business could be shown
-- the same panel later without a second function.
--
-- "Activated" is not activated_at. That column only started existing with 0013
-- and only batch activation sets it, so it reads zero for every code printed
-- before today — a panel built on it would show a column of zeros and look
-- broken. In use = claimed by a business, or carrying a message, or saved.
-- activated_at is returned alongside so the two can be compared as it fills in.

create or replace function public.my_print_runs()
returns table (
  kind      text,
  printed   bigint,
  scanned   bigint,
  in_use    bigint,
  saved     bigint,
  stamped   bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    case coalesce(source, 'duyen')
      when 'business' then 'Business profile'
      when 'product'  then 'Product tags'
      when 'moment'   then 'App moments'
      when 'external' then 'Saved links'
      else 'Duyen notes'
    end                                                        as kind,
    count(*)                                                   as printed,
    count(*) filter (where coalesce(scan_count, 0) > 0)        as scanned,
    count(*) filter (where business_user_id is not null
                        or giver_data    is not null
                        or receiver_data is not null)          as in_use,
    count(*) filter (where coalesce(save_count, 0) > 0)        as saved,
    count(*) filter (where activated_at is not null)           as stamped
  from public.qr_codes
  where user_id = auth.uid()
  group by 1
  order by printed desc;
$$;

revoke all on function public.my_print_runs() from public;
grant execute on function public.my_print_runs() to authenticated;

comment on function public.my_print_runs() is
  'Per-kind tally of the caller''s own codes: printed, scanned, in use, saved. RLS-scoped, no elevated rights.';
