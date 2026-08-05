-- Businesses want three numbers about their audience — scans, saves, shares.
-- Scans and saves were already counted; shares were not tracked at all.
--
-- Incremented from the client on the share action, the same way scan_count is
-- (the existing "Allow public scan count updates" policy covers it).

alter table public.qr_codes
    add column if not exists share_count integer not null default 0;

comment on column public.qr_codes.share_count is 'Times this code''s link was shared from the app.';
