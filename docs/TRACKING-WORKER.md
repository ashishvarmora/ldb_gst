# The tracking worker

How the background engine works, where to schedule it, and what to check when it
misbehaves. The code is [src/lib/tracking.ts](../src/lib/tracking.ts) with the HTTP
entry point at [src/app/api/cron/track/route.ts](../src/app/api/cron/track/route.ts).

## Scheduling

The worker is one HTTP endpoint. Whatever calls it on a schedule is the *tick*.
Nothing in this repo schedules it.

A truck is checked only when one of its own alerts is due, so a 5-minute tick does
not mean a 30-minute alert gets hammered — the tick just decides when to look. But
**no alert can fire faster than the tick**, so this interval is the real floor on
every alert in the app.

**This deployment uses [cron-job.org](https://cron-job.org).** Create a job:

| Field | Value |
| --- | --- |
| URL | `https://<your-domain>/api/cron/track` |
| Schedule | every 5 minutes |
| Header | `Authorization: Bearer <CRON_SECRET>` |

Any scheduler works — Supabase `pg_cron` with `pg_net`, a VPS crontab, anything that
can make an HTTP call:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/track
```

A `?key=<CRON_SECRET>` query parameter is accepted too, for schedulers that cannot set
headers.

### Check the body, not the status code

Whatever you use, assert that the response is JSON containing `"ok": true`.

A wrong secret returns 403, which any scheduler will notice. But **Vercel's
deployment protection returns HTTP 200 with an HTML login page**, so a scheduler
that only checks the status code reports success for ever while nothing runs. If
tracking looks dead but the scheduler looks green, that is the first thing to
check.

### Two schedulers that were removed

`vercel.json` used to carry a daily cron and the repo shipped a GitHub Actions
workflow. Both are gone:

- **Vercel Hobby** allows one cron run per day. A `*/5 * * * *` schedule is
  rejected at deploy time, and once a day is not tracking.
- **GitHub Actions on a private repo** bills scheduled runs against the free
  2,000 minutes a month. Every 5 minutes is about 8,600 billed minutes, so it
  runs for roughly a week and then stops silently mid-month. (On a public repo
  it is free, and the workflow was fine.)

You can also run a sweep by hand from **Admin → Settings → Run the worker now**,
which is the fastest way to confirm the whole chain after a deploy.

## What one tick does

```
if app_settings.tracking_enabled is false            -> stop, report nothing polled
select active trucks belonging to ACTIVE officers    -> at most 500 candidates
keep the ones whose interval has elapsed             -> "due"
take the first 60 (batch cap), 4 at a time

per truck:
  consume_quota(user, 'tracking', 1)
    refused, reason quota_exhausted   -> skip, try again next tick
    refused, plan_expired / suspended -> skip AND set is_active = false
  POST { vehiclenumber } to app_settings.ldb_api_url
  walk the response oldest-first, seeded from truck.last_location
    -> drop every reading whose plaza equals the one before it
    -> what is left is MOVEMENTS: a time and a new location
  upsert the movements on (user_id, seq_no) with ON CONFLICT DO NOTHING ... RETURNING
    -> the database itself reports which rows are new
  evaluate the officer's alert rules against the NEW rows only
  insert alert_logs, push Telegram, bump the alerts_sent counter
  update the truck: last_polled_at, last_event_at, last_location, status, errors
  log the call in search_logs IF it found a movement or failed

after the loop: flush queued rows into each officer's Google Sheet
```

Per-officer data (alert rules, Telegram config, sheet config, effective limits,
recent alerts for cooldowns) is loaded **once per sweep**, not once per truck.

`deferred` in the response counts trucks that were due but did not fit the batch cap.
It is reported rather than hidden — a silently truncated sweep looks identical to a
quiet one.

## Guarantees worth knowing

- **`consume_quota()` is the only writer of `usage_counters`.** Never increment it
  from application code, or the admin numbers stop being trustworthy.
- **Only movements are stored.** A reading that reports the plaza the truck is
  already at is never written - not to `truck_events`, not to the sheet. The
  comparison is seeded from `trucks.last_location`, so the same reading is judged
  the same way on every poll, and a return trip A -> B -> A is three real rows.
- **Billing lives in `usage_counters`, not in `search_logs`.** Every poll calls
  `consume_quota()`, so the quota is exact. `search_logs` is the readable record:
  every manual search, and the background checks that found a movement or failed.
  A quiet check writes no row - fifty trucks on a ten-minute interval would
  otherwise add over 200,000 rows a month saying "nothing happened".
- **Duplicate crossings are impossible.** `seq_no` is unique per officer, and the
  worker relies on `RETURNING` to learn what was new — so two overlapping sweeps
  cannot double-alert.
- **A broken sheet never stops tracking.** Sheet errors land in
  `google_sheet_configs.last_error` and the sweep carries on.
- **Telegram failures never lose an alert.** The alert row is written with
  `delivered = false` and the reason, and shows up on the officer's Alerts page and
  in Admin → Alerts.
- **Enough consecutive failures pause a truck** so a dead registration cannot burn
  quota forever. The threshold is the truck's own `max_consecutive_failures` when
  it has one, otherwise the `tracking_failure_cutoff` setting, which ships at 10.
  A warning is messaged at 5 (`FAILURE_WARN_AT` in `src/lib/tracking.ts`).
  This line used to say a flat 20, which no version of the code has ever done —
  found while writing the user guide, which reads its figures from the same
  places and so had to be checked against them.
- **Suspending an officer or letting a plan expire pauses their trucks**, so a
  lapsed account stops consuming API calls.

## Alert rules

Evaluation lives in [src/lib/alerts.ts](../src/lib/alerts.ts) as a pure function, so
it is testable without a database.

| kind | config | fires when |
| --- | --- | --- |
| `approaching_city` | `{ city, tolls[] }` | a new crossing matches one of the toll keywords |
| `state_entry` | `{ state? }` | the inferred state changes (to `state`, if named) |
| `state_exit` | `{ state }` | the truck was in `state` and the new crossing is not |
| `no_movement` | `{ hours }` | no crossing for that long **and** nothing new this tick |
| `excessive_movement` | `{ tolls, hours }` | that many plazas inside the window |
| `watchlist_move` | `{}` | any crossing by a truck flagged watchlist |
| `night_travel` | `{ from, to }` | a crossing inside the window, wrapping past midnight |
| `route_prediction` | `{ sequence[], destination }` | crossings advance along the corridor; names the next stop |

Every kind takes an optional `cooldown_minutes`. The worker suppresses a repeat of
the same rule for the same truck inside that window by checking `alert_logs`, so an
officer is not messaged five times about one approach.

State is **inferred from toll-plaza names** using the keyword table in
[src/lib/geo.ts](../src/lib/geo.ts) — it is not a boundary lookup. Add districts
there as you meet them.

## Telegram

One platform bot (`TELEGRAM_BOT_TOKEN`). Officers only ever supply a numeric chat id,
which they get by sending `/start` to the bot. A per-officer `bot_token` column exists
for the rare officer who insists on their own bot; leave it null otherwise.

Before sending, the worker checks the *effective* `telegram_enabled` — a plan or a
per-officer override can switch it off.

## Google Sheets

One platform service account, no officer credentials. The officer shares their own
sheet as Editor with the service-account address (shown on both settings pages) and
pastes the link.

Tabs are created on first write:

| Tab | Contents |
| --- | --- |
| `Truck Events` | every crossing: time, truck, location, lat, lng, direction, event, seqNo |
| `Alerts` | time, truck, alert type, title, message |
| `Manual Searches` | time, truck, crossings found, result |
| `Usage Summary` | rewritten each sync — date, manual searches, tracking queries |

`Usage Summary` is a full rewrite rather than an append, so it never accumulates
duplicate rows. The Sheets client in [src/lib/sheets.ts](../src/lib/sheets.ts) signs
its own JWT with `node:crypto` and calls the REST API directly — the `googleapis`
package is ~10 MB for the three calls actually needed.

## Quota arithmetic

One truck at a 10-minute interval is 144 calls a day, about **4,320 a month**.

So Professional (50 trucks, 10,000 queries/month) really supports about two trucks at
10 minutes, or eight at 30. The plan editor warns about this when you save, and the
officer's own **My trucks** page shows what their current list costs per month against
their pool.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Nothing is being polled | Admin → Settings: is tracking switched on? Is the officer active and the plan unexpired? |
| `HTTP 403` from the portal | It is rate-limiting. Raise intervals; the message says so verbatim in `search_logs.error`. |
| Alerts recorded but not delivered | Admin → Alerts, `delivery_error` column. Usually a missing chat id or the officer never sent `/start`. |
| Sheet not updating | Officer settings → Test connection. Almost always the sheet was not shared with the service account. |
| Officer says searches are refused | Admin → officer page: plan assigned? expired? daily quota used up? The officer's own screen states the exact reason. |
| Worker returns `deferred > 0` every tick | More trucks are due than the batch cap allows. Raise `batch`, tick more often, or slow the intervals down. |
