-- Private memory layer on saved business entries.
--
-- A business QR is ONE row in qr_codes shared by everyone who scans it, and
-- its business_data is overwritten whenever the business edits their profile.
-- Personal annotations therefore cannot live there: they would be visible to
-- every other saver and wiped on the next profile push.
--
-- tapestry is already one row per (user_id, qr_code_id, role) with owner-only
-- RLS on select/insert/update/delete, so it is the correct home. These columns
-- make each save carry its own memories, invisible to every other saver by
-- database policy rather than by UI.

alter table public.tapestry
    add column if not exists memory_note text,                    -- their own words ('note' holds the external link URL)
    add column if not exists media       jsonb not null default '[]'::jsonb,  -- photos/videos, same shape as qr_codes.media
    add column if not exists voice       text;                    -- voice memo URL

-- Which QR codes offer the memory layer. Stamped, not computed: the $20 is a
-- one-time purchase, so a business that paid keeps it permanently and it never
-- flickers off when a subscription lapses. Set true on every code a business
-- owns at purchase time, and on anything they generate afterwards.
alter table public.qr_codes
    add column if not exists memory_enabled boolean not null default false;

comment on column public.tapestry.memory_note   is 'Saver''s private note about this entry. Never leaves their tapestry row.';
comment on column public.tapestry.media         is 'Saver''s private photos/videos. Per-user; never written to the shared qr_codes row.';
comment on column public.tapestry.voice         is 'Saver''s private voice memo URL.';
comment on column public.qr_codes.memory_enabled is 'True once the owning business has paid for QR generation; unlocks the memory layer for savers.';
