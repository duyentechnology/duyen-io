-- When a printed tag went live.
--
-- Product tags are printed blank and sit as physical stock, so created_at is
-- only the date they were PRINTED. The date that matters for analytics is the
-- date a business attached an item to one — five tags going onto the same
-- orange dress on the same afternoon is the event worth grouping by.
--
-- Set once, on the first attach, and never overwritten: updated_at already
-- moves on every later edit, so it cannot answer "when did this go live".
--
-- Nullable on purpose. Blank stock has no activation date, and that null is
-- the difference between "printed, never used" and "in the world" — which is
-- the first number worth reporting on a print run.

alter table public.qr_codes
  add column if not exists activated_at timestamptz;

-- Reporting reads this as "activations in a window", so index the non-null
-- rows only; blank stock is the majority of the table and never queried by it.
create index if not exists qr_codes_activated_at_idx
  on public.qr_codes (activated_at desc)
  where activated_at is not null;

comment on column public.qr_codes.activated_at is
  'First time an item/profile was attached to this code. Null = printed but never used. Set once, never updated.';
