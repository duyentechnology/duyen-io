# Scheduled jobs (pg_cron)

These run inside Postgres via `pg_cron` + `pg_net`. They are configured **live**
on the project (not applied by a migration, because the command embeds a secret
that must not live in the repo). Recorded here so the setup is reproducible.

## whatsnew-weekly — the "What's New" digest

- **Schedule:** `15 16 * * 4` (Thursday 16:15 UTC ≈ 9:15am US Pacific; drifts 1h with DST)
- **What it does:** HTTP POST to the `send-whatsnew-digest` edge function, which
  emails each customer a roundup of new promotions from businesses they saved.
- **Auth:** the `x-digest-secret` header must equal the `DIGEST_SECRET` edge-function
  secret. The function is deployed `verify_jwt=false`.

Setup SQL (run once, with the real secret substituted for `<DIGEST_SECRET>`):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'whatsnew-weekly',
  '15 16 * * 4',
  $cron$
    select net.http_post(
      url     := 'https://qnlaaieyipeglfuepmor.supabase.co/functions/v1/send-whatsnew-digest',
      headers := jsonb_build_object('Content-Type','application/json','x-digest-secret','<DIGEST_SECRET>'),
      body    := '{}'::jsonb
    );
  $cron$
);
```

To change cadence: `select cron.unschedule('whatsnew-weekly');` then re-run with a
new cron expression. To pause: `update cron.job set active=false where jobname='whatsnew-weekly';`.

> If `DIGEST_SECRET` is ever rotated, update BOTH the edge-function secret and this
> cron command (the secret is stored inline in `cron.job.command`). For a cleaner
> rotation story, move the secret into Supabase Vault and read it via
> `vault.decrypted_secrets` inside the cron command.

## Manual trigger / dry run

```bash
# Dry run (counts only, sends nothing):
curl -X POST 'https://qnlaaieyipeglfuepmor.supabase.co/functions/v1/send-whatsnew-digest' \
  -H 'Content-Type: application/json' -H 'x-digest-secret: <DIGEST_SECRET>' \
  -d '{"dryRun":true}'

# Real send:
curl -X POST 'https://qnlaaieyipeglfuepmor.supabase.co/functions/v1/send-whatsnew-digest' \
  -H 'Content-Type: application/json' -H 'x-digest-secret: <DIGEST_SECRET>' -d '{}'
```
