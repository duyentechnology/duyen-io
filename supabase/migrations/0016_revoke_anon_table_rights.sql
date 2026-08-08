-- Close the hole: anon loses every direct right on qr_codes.
--
-- Before this, the public anon key (which is in the page source by design)
-- could:
--   * SELECT every row and column — so every gift message ever written was
--     readable, and the whole table enumerable without knowing any code;
--   * UPDATE every row and column — the policy was named "scan count updates",
--     but RLS cannot restrict columns and anon held column-level UPDATE on all
--     31, so url, user_id, business_user_id, giver_data and the rest were all
--     rewritable by anyone.
--
-- INSERT and DELETE were already blocked by their with-check clauses; the
-- grants are dropped anyway so nothing is left leaning on a policy.
--
-- A scanner keeps working through the four functions in 0014/0015:
--   get_qr_for_scan(code), bump_scan_count(id), bump_share_count(id),
--   bump_save_count(id)
-- each keyed to one code, so nothing can be listed and nothing else written.
--
-- ORDER MATTERS. Apply this only once the client calling those functions is
-- actually live. Applied early, every scan in production breaks — and because
-- the service worker caches the app shell, a client already open on an old
-- version keeps calling the table until it is fully reloaded.

-- ---- the two blanket read policies -----------------------------------------
drop policy if exists "Anyone can read QR codes"           on public.qr_codes;
drop policy if exists "Public can view single QR code by ID" on public.qr_codes;

-- ---- the write policy that was never limited to the counter ----------------
drop policy if exists "Allow public scan count updates" on public.qr_codes;

-- ---- and the underlying grants, so no future policy can re-open it ---------
revoke select, insert, update, delete, references on public.qr_codes from anon;

-- Authenticated keeps table access; its reads are owner-scoped (own rows,
-- rows in its tapestry, its claimed business codes, codes it gave or received)
-- and its writes still go through the existing update policies. Narrowing the
-- remaining broad authenticated UPDATE (using auth.uid() is not null, which
-- lets any signed-in account write any row) is the next step and is NOT done
-- here: it needs the giver/receiver writes moved behind functions first.
