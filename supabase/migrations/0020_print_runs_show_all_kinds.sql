-- Always show the three printable kinds, even at zero.
--
-- The first version grouped over existing rows, so a kind with nothing printed
-- simply had no row — Product tags vanished from the panel entirely. A missing
-- row reads as "this doesn't exist" when the truth is "none printed yet", which
-- is exactly the number someone opens this panel to check.
--
-- Notes, Business profile and Product tags are the kinds this account prints, so
-- they are always listed, in that order. Anything else (App moments, Saved
-- links — created in the consumer app, not printed) appears only when it has
-- rows, after the three.

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
  with tally as (
    select
      case coalesce(source, 'duyen')
        when 'business' then 'Business profile'
        when 'product'  then 'Product tags'
        when 'moment'   then 'App moments'
        when 'external' then 'Saved links'
        else 'Duyen notes'
      end                                                      as kind,
      count(*)                                                 as printed,
      count(*) filter (where coalesce(scan_count, 0) > 0)      as scanned,
      count(*) filter (where business_user_id is not null
                          or giver_data    is not null
                          or receiver_data is not null)        as in_use,
      count(*) filter (where coalesce(save_count, 0) > 0)      as saved,
      count(*) filter (where activated_at is not null)         as stamped
    from public.qr_codes
    where user_id = auth.uid()
    group by 1
  ),
  always as (
    select * from (values
      ('Duyen notes', 1), ('Business profile', 2), ('Product tags', 3)
    ) as k(kind, ord)
  )
  select
    coalesce(a.kind, t.kind)      as kind,
    coalesce(t.printed, 0)        as printed,
    coalesce(t.scanned, 0)        as scanned,
    coalesce(t.in_use,  0)        as in_use,
    coalesce(t.saved,   0)        as saved,
    coalesce(t.stamped, 0)        as stamped
  from always a
  full outer join tally t on t.kind = a.kind
  order by coalesce(a.ord, 9), printed desc;
$$;

comment on function public.my_print_runs() is
  'Per-kind tally of the caller''s own codes. The three printable kinds always appear, at zero if nothing was printed.';
