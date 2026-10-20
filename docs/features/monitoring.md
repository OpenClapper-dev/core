# Monitoring

Epic [#67](https://github.com/OpenClapper-dev/core/issues/67). Storage monitoring inside the admin plane ([admin](admin.md)): how much R2 storage the instance occupies, per workspace and in total, how it grows, with marks the operator sets. Nothing to run or set up; an optional read-only Cloudflare token adds the account-wide numbers.

Two kinds of monitoring, and only one lives here:

- **Ops** (is it up, latency, error rates, platform usage): the Cloudflare dashboard shows Worker, D1 and R2 metrics, Workers Logs holds every `console.error` of both Workers (observability is enabled), and Cloudflare notifications alert. Neither Grafana nor a copy of those panels adds anything a self-hoster does not already have in their own account.
- **Product** (what the instance's own entities occupy): the admin plane, from its own tables. This page.

Parked with their own issues under the `monitoring` label: request metering per account (#218, groundwork for quotas) and a server error log tied to accounts (#219, support).

## The daily snapshot (#214)

The app Worker's daily cron (`scheduled` in `apps/worker/src/index.ts`, 03:17 UTC, next to the recycle-bin and session purges) runs `snapshotStorage` (`apps/worker/src/storage-stats.ts`), which writes the day's rows into `storage_daily`:

- one row per workspace with photos: `bytes` (the sum of `photos.size_bytes`), `objects` (its photos), `unsized` (photos from before migration 0021, whose size was never recorded). Binned shots count: their photos still occupy the bucket until the bin is emptied.
- one row with `workspace_id = ''`: the bound bucket's total bytes and object count from an R2 listing (one Class A operation per 1 000 objects). It also covers renders and orphans that no photo row accounts for, so it is larger than the sum of the workspace rows.

Days are UTC. Running the cron twice in a day rewrites the rows (`INSERT OR REPLACE`). The table is never purged: 365 rows a year per key. A failing snapshot is logged and never stops the other cron jobs.

Tested in `apps/worker/test/routes/storage.test.ts` (the cron, the bucket total against a listing, the rewrite).
