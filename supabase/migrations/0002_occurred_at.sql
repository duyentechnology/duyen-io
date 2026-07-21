-- Backfill dates for the life tapestry
-- ---------------------------------------------------------------------------
-- Adds an optional "when did this actually happen?" timestamp to tapestry rows.
--
-- created_at  = when the moment was SAVED (ingest time, DB default now())
-- occurred_at = when the moment actually HAPPENED (event time, user-entered)
--
-- occurred_at is nullable on purpose: existing rows keep working untouched,
-- and the app treats the moment's effective timeline date as
-- COALESCE(occurred_at, created_at). Users can enter a past date in
-- "Add a moment" to weave a memory back into the days of their life.

alter table public.tapestry
  add column if not exists occurred_at timestamptz;

-- Speeds up the newest-first timeline sort/grouping, which now keys off the
-- effective date rather than created_at alone.
create index if not exists tapestry_effective_date_idx
  on public.tapestry (coalesce(occurred_at, created_at) desc);
