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

## The storage report and the marks (#215)

The admin Worker (`apps/admin/src/storage.ts`) serves:

- `GET /api/storage?days=90` (1..365): `total` (the latest bucket row of all time: `bytes`, `objects`, `day`, so the board can say how old it is; `null` before the first cron run), `workspaces` (every workspace with its photos and bytes now, from the database, largest first), `days` (the window's snapshots grouped by day, each with `total_bytes`, `total_objects` and its workspace rows), `marks` and `crossed` (the marks the latest total is at or above).
- `GET /api/settings` → `{ storage_marks }` and `PUT /api/settings` with `{ storage_marks: [{ bytes, label }] }`: the whole list, at most 10, `bytes` a positive integer, `label` up to 40 characters, stored sorted ascending in `admin_settings` under `storage_marks` with the operator's email. Validated strictly (an interactive edit). The change is audited (`settings.update`).

A mark is a plain threshold the operator chooses ("5 GB", "where I start paying"); nothing in the code knows about plans or free tiers. A crossed mark shows as a banner on the board; push alerts are Cloudflare notifications' job.

Tested in `apps/admin/test/storage.test.ts`.

## The Monitoring tab (#216)

`apps/admin/ui/src/Monitoring.tsx`, reached with the **Board · Monitoring** switch in the header (`#monitoring`). The board's pages are split: `App.tsx` (shell, tabs, the banner), `Accounts.tsx`, `Workspaces.tsx`, `Monitoring.tsx`, `charts.tsx`, `shared.tsx` (tile, section, formats).

- **Tiles**: the bucket total with its snapshot day (UTC), the photos' bytes from the database, the difference (renders, orphans, photos without a size), unsized photos.
- **Storage**: the bucket total over 30 days, 90 days or a year as a line, the operator's marks as dashed lines with their label, a crosshair and a tooltip on hover. Before the first snapshot the chart says so.
- **Workspaces**: photos, bytes, share of the photos' bytes and a sparkline of the window, largest first.
- **Marks**: a size with a unit (MB, GB) and a label per row, at most 10; Save sends the whole list. The empty state explains what marks do.
- **Banner** on both tabs while the latest bucket total is past a mark, naming the highest crossed one (`role="alert"`); on the Board it links to Monitoring.

The charts (`charts.tsx`) are hand-written SVG with no dependency, one hue (the accent) only: the design system has no categorical palette, so a comparison across workspaces is a table with sparklines, never stacked colours. Marks are drawn on the warning ink and always carry their text. Text is sized by the container's width, not by viewBox scaling. Both themes (Sun, Set) were checked with screenshots.

## The Cloudflare overlay (#217, optional)

Some numbers only Cloudflare's analytics know: R2 storage across **every bucket of the account** (what storage is billed on; there can be more than this instance's bucket), Worker requests, errors and CPU, D1 rows. The admin Worker reads them from the GraphQL Analytics API (`apps/admin/src/cloudflare.ts`) once a read-only API token with only *Account · Account Analytics · Read* is set as the secret `CF_ANALYTICS_TOKEN` ([self-hosting](../self-hosting.md#6-monitoring-optional)). Without it `GET /api/cloudflare` answers `{ configured: false }` and the board's Cloudflare section says how to enable it.

- `GET /api/cloudflare?days=30` (1..31, the storage dataset's window): `r2` (buckets with bytes, metadata, objects, the app's one marked; the account total; a per-day series of the summed daily peaks), `r2_ops` (class A and B, by action), `worker` (requests, errors, subrequests, CPU p50/p99 of the latest day, per-day series, filtered to `APP_WORKER_NAME`), `d1` (rows and queries, per-day series), `history` (the stored snapshots). Each dataset is read on its own: one failing (a renamed field, a missing permission) reports its `error` in place and the others stay. Answers are cached per isolate for 5 minutes (the API allows 300 queries per 5 minutes).
- The admin Worker's own daily cron (03:47 UTC, `triggers` in `apps/admin/wrangler.jsonc`) keeps yesterday's values in `cf_usage_daily` (`r2.bytes.total`, `r2.bytes.<bucket>`, `r2.objects.total`, `worker.requests`, `worker.errors`, `d1.rows_read`, `d1.rows_written`), so the R2 chart reaches beyond the API's 31 days. Without the token it logs "not configured" and does nothing.
- The board's Cloudflare section: tiles, the account-wide R2 total over time with the operator's marks, the bucket table. The banner judges the larger of the bucket's own snapshot and the account total.

Cloudflare's storage metric is sampled, so it lags uploads and deletes. Whether metadata counts toward billed storage is undocumented: the total shown is payload plus metadata, and the table lists the metadata apart. The GraphQL field names are the documented ones (October 2026) and were checked against a stubbed endpoint only (`apps/admin/test/cloudflare.test.ts`); the first real answer is checked against the Cloudflare dashboard after deploy.
