# Reconciling Missed Deployment Statuses (#407)

**Applies to:** deployments already stranded at a non-terminal status (e.g. `waiting`) before the
pending-floor fix shipped. The fix prevents future occurrences; it does **not** retroactively
recover pre-existing stranded rows. This runbook covers that manual recovery.

## 1. Purpose

A deployment held in `waiting` (or another non-terminal status) longer than the fetcher's
1-day scan window was silently dropped from the poll window. Its later `success` (or other
terminal status) was never fetched, leaving the dashboard tile permanently stuck at the
non-terminal status.

This runbook drives a bounded backfill against the GitHub Deployments API to retrieve those
missed terminal statuses and ingest them.

## 2. Prerequisites

1. **Deploy the build that includes:**
   - The idempotent-ingest change (`POST /api/deployments` returns `200` on duplicate,
     `201` on insert — no new row created on conflict on `(deployment_id, status, happened_at)`).
   - The database migration that adds the unique index on `(deployment_id, status, happened_at)`.
2. **Verify the migration ran** (`GET /readyz` on the API returns `200`).

Without idempotent ingest, running backfill can append duplicate events. Run the migration
**before** this procedure.

## 3. Steps

1. **Snapshot the database** before proceeding:

   ```sql
   -- Record current event counts per slot for comparison after backfill
   SELECT service, environment, status, count(*) AS events
   FROM deployment_events
   GROUP BY 1, 2, 3
   ORDER BY 1, 2, 3;
   ```

2. **Identify the oldest stranded deployment.** Find the earliest `happened_at` among tiles
   currently showing a non-terminal status that you believe should have resolved:

   ```sql
   SELECT deployment_id, service, environment, status, happened_at
   FROM deployment_events
   WHERE status IN ('waiting', 'pending', 'queued', 'in-progress')
   ORDER BY happened_at ASC
   LIMIT 20;
   ```

3. **Set fetcher-host environment variables** on the `fetcher-host` service. Replace the
   example values with your actual oldest stranded deployment age:

   | Variable | Value | Notes |
   |---|---|---|
   | `BACKFILL` | `true` | Forces backfill regardless of existing cursor. |
   | `BACKFILL_MAX_AGE` | e.g. `60.00:00:00` | Must reach the oldest stranded deployment. Format: `DD.HH:MM:SS`. Default `30.00:00:00` will not reach a 60-day-old deployment. |
   | `BACKFILL_DEPTH` | e.g. `200` | Depth counts mapped status events per `(service, environment)` slot. The default `2` stops early and will miss a deployment sitting behind newer ones. Set high enough to reach the stranded deployment. |
   | `GITHUB_RATE_LIMIT_BUDGET_PCT` | e.g. `20` | Optional — reduce if the token is shared with other consumers. Default `30`. |

4. **Recreate the container** (cold start required — `BACKFILL=true` is read at startup):

   ```bash
   docker compose up -d --force-recreate fetcher-host
   ```

5. **Monitor progress** via the fetcher logs and the control-events stream:

   ```bash
   docker compose logs -f fetcher-host
   ```

   Backfill completion is logged as `Backfill complete` per repo.

## 4. Verify

1. **Tile status.** The previously stranded tile(s) should now show their terminal status in
   the dashboard matrix.

2. **No duplicate rows.** Run the dedup check — must return zero rows:

   ```sql
   SELECT deployment_id, status, happened_at, count(*)
   FROM deployment_events
   GROUP BY 1, 2, 3
   HAVING count(*) > 1;
   ```

3. **Analytics counts.** Compare aggregate counts against the pre-backfill snapshot — only
   the newly added terminal events should differ; no existing rows should be replaced or removed.

## 5. Revert to normal polling

Once verified, restore normal polling so backfill does not re-run on the next container restart:

1. Set `BACKFILL=false` (or unset).
2. Restore `BACKFILL_MAX_AGE` and `BACKFILL_DEPTH` to their defaults (or remove the overrides).
3. Recreate the container:

   ```bash
   docker compose up -d --force-recreate fetcher-host
   ```

---

See [GitHub issue #407](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/407)
for the root-cause analysis and the prevention fix.
