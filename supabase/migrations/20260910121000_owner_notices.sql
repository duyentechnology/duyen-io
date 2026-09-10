-- Owner notices — small in-app inbox so a business owner learns when the admin
-- rejects or removes one of their links (requirement 3/4). The business
-- dashboard shows unseen notices as a banner and marks them seen. Additive:
-- one new table, nothing existing is touched. Email is layered on later through
-- the same link-admin write path (a clean hook), per the "both" choice.

create table if not exists public.owner_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,   -- link_rejected | link_removed
  title      text not null,
  message    text not null,
  link_id    uuid,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists owner_notices_unseen_idx
  on public.owner_notices (user_id, created_at desc) where seen_at is null;

alter table public.owner_notices enable row level security;

-- Owner reads and dismisses (marks seen) their own; service role writes them.
drop policy if exists owner_notices_select_own on public.owner_notices;
create policy owner_notices_select_own on public.owner_notices
  for select using (auth.uid() = user_id);

drop policy if exists owner_notices_update_own on public.owner_notices;
create policy owner_notices_update_own on public.owner_notices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, update on public.owner_notices to authenticated;
grant all on public.owner_notices to service_role;
