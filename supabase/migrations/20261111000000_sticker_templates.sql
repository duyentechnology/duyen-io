-- Sticker-sheet templates — per-user saved label layouts for the dayduyen.tech
-- sticker-sheet tool, so a business's custom templates follow them across devices
-- instead of living only in one browser's localStorage. Each row is one named
-- template (sticker size, gaps, margins, paper) owned by the user who made it.
--
-- The built-in "Duyên 1.25 squares" template ships in the app code and is NOT
-- stored here. RLS scopes every row to its owner (auth.uid()), so the client
-- reads/writes its own templates directly with the anon key + user JWT — no
-- SECURITY DEFINER RPC needed. Shared backend: only dayduyen.tech writes here,
-- but the table lives on the one shared project like everything else.

create table if not exists public.sticker_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  lw         double precision not null,   -- label width  (inches)
  lh         double precision not null,   -- label height (inches)
  gx         double precision not null,   -- gap across   (inches)
  gy         double precision not null,   -- gap down      (inches)
  mt         double precision not null,   -- top margin    (inches)
  ml         double precision not null,   -- left margin   (inches)
  page       text not null default 'letter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)                  -- one template per name per user (upsert target)
);

alter table public.sticker_templates enable row level security;

-- Owner-only access. No blanket grants: a user only ever sees/edits their own rows.
drop policy if exists sticker_templates_select_own on public.sticker_templates;
create policy sticker_templates_select_own on public.sticker_templates
  for select using (auth.uid() = user_id);

drop policy if exists sticker_templates_insert_own on public.sticker_templates;
create policy sticker_templates_insert_own on public.sticker_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists sticker_templates_update_own on public.sticker_templates;
create policy sticker_templates_update_own on public.sticker_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists sticker_templates_delete_own on public.sticker_templates;
create policy sticker_templates_delete_own on public.sticker_templates
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.sticker_templates to authenticated;
