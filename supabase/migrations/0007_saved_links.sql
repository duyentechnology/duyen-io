-- 0007: Saved Links — a personal vault for external QR-code links
-- ---------------------------------------------------------------------------
-- Users scan or paste any external QR/link and save it here so they never
-- lose it. Not a "moment" (no sharing, no tokens) — just the owner's private
-- bookmarks. Clients read/write their own rows directly via RLS.

create table if not exists public.saved_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  url        text not null,
  title      text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists saved_links_user_idx on public.saved_links(user_id, created_at desc);

alter table public.saved_links enable row level security;

-- Owner-only CRUD.
drop policy if exists saved_links_select_own on public.saved_links;
create policy saved_links_select_own on public.saved_links
  for select using (auth.uid() = user_id);

drop policy if exists saved_links_insert_own on public.saved_links;
create policy saved_links_insert_own on public.saved_links
  for insert with check (auth.uid() = user_id);

drop policy if exists saved_links_update_own on public.saved_links;
create policy saved_links_update_own on public.saved_links
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists saved_links_delete_own on public.saved_links;
create policy saved_links_delete_own on public.saved_links
  for delete using (auth.uid() = user_id);
