# GST Truck Intelligence

A private truck-tracking platform for GST officers. Two apps and a background worker
in one Vercel deployment:

- **Admin console** (`/admin`) — you create officer accounts, put each on a plan,
  override individual limits, and watch what everyone is consuming.
- **Officer dashboard** (`/portal`) — officers search trucks, track them, get Telegram
  alerts, and group vehicles into case folders.
- **Tracking worker** (`/api/cron/track`) — polls LDB on each truck's own interval,
  stores crossings, fires alerts, mirrors everything into the officer's Google Sheet.

Hierarchy is `Super Admin (you) → Officer (user)`. No tenant layer, no self-signup.

Next.js 15 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind CSS v4.

---

## What each app does

### Admin console — `/admin`

| Page | What you can do |
| --- | --- |
| **Overview** | Platform totals, 30-day usage chart, "needs attention" list (expired plan, out of credits, truck limit hit), credits outstanding, recent admin activity |
| **Officers** | Create accounts (password generated and shown once), filter by name, office, district, plan or status, credit balance per officer and top-ups |
| **Officer detail** | Assign plan + expiry · per-officer limit overrides · Telegram + Sheet setup · 30-day usage chart · reset counters · tracked trucks · last 10 LDB calls · last 10 alerts · suspend · reset password · delete |
| **Plans** | Create, edit, duplicate, archive, delete. Warns when a truck limit cannot be polled inside the monthly query cap |
| **Trucks** | Every tracked truck across all officers, filter by officer/status/number |
| **Usage** | Per-officer consumption, recent LDB calls with latency and failures, CSV export for billing |
| **Alerts** | Every alert raised and whether Telegram actually delivered it |
| **Audit log** | Field-level before/after for every admin change |
| **Settings** | LDB endpoint, global pause switch, polling floor, no-activity threshold, data retention, connection health, **run the worker now**, **clear old records now** |

### Officer dashboard — `/portal`

| Page | What an officer can do |
| --- | --- |
| **Home** | Credits held, spent today and this month; plan at a glance; today's alerts; today's usage below |
| **Search** | Look up any registration number. Results are stored at a permanent URL, so reopening one costs nothing |
| **Search result** | The route first, full width, then the detail underneath — plaza, state, timings, last crossing, add to tracking, add to a case |
| **My trucks** | The trucks under automatic checking, each showing its alerts and when it was last checked |
| **Truck detail** | Full route timeline, **the truck's alerts** — add as many as you like from the admin's catalogue, each with its own interval — alerts raised, recent checks, remove |
| **Records** | Every crossing in one place, either merged per truck number or as a flat filterable table, with analytics and CSV export |
| **Cases** | Case folders — paste a whole list of registration numbers, then read one combined timeline across the group |
| **My plan** | Credit balance and history, what each action costs, what the plan includes, when it expires |
| **Settings** | Connect Telegram (with a test message), connect a Google Sheet (with a test), see their own 30-day usage |

Sidebar on desktop, thumb-reachable tab bar on mobile — officers work from phones.

---

## One credit balance

An officer has a single number to think about. There used to be two quotas —
searches per day and tracking queries per month — and you had to hold both in
your head to know whether anything would work.

Every chargeable action draws on the same balance, and the admin sets the rate
in `credit_rates`:

| Action | Default rate |
| --- | --- |
| Manual search | 1 credit = 1 search |
| Automatic check | 1 credit = 2 checks |

Rates are stored as *how many of the action one credit buys*, because that is
how they are spoken. Adding a chargeable action later is a row, not a
migration. `spend_credits()` does the check and the decrement in one statement
under a row lock, so two tabs cannot both spend the last credit, and every
movement is written to `credit_transactions` — a wrong balance can always be
reconstructed.

A **plan** no longer says how much an account may use, only what it may reach:
`truck_limit`, a case-folder cap, retention, and three feature switches
(Telegram, Sheets, truck alerts). Plans are assigned automatically on sign-up
and carry an opening allocation (`included_credits`); admins top up on
top of it.

How a number is stored:

| Value | Meaning |
| --- | --- |
| `-1` in a **plan** | Unlimited |
| `0` or more in a **plan** | Hard cap |
| `NULL` in an **override** | Inherit from the plan |
| `-1` in an **override** | Unlimited, for this officer only |

In the UI you type a number or the word `unlimited`; a blank override means inherit.
The officer detail page shows plan value / override / effective side by side.

**Credit arithmetic:** a truck with a 30-minute alert is 48 checks a day. At
1 credit = 2 checks that is 24 credits a day, so a 500-credit opening balance
covers roughly three weeks of one truck. Trucks are meant to be watched for
days, not months — an alert is switched off, or the truck removed, when the
case moves on.

---

## Setup

### 1. Supabase project

Create a project at [supabase.com](https://supabase.com) (Postgres 15+; the views use
`security_invoker`). In **SQL Editor**, run these in order:

1. `supabase/migrations/0001_init.sql` — tables, indexes, triggers
2. `supabase/migrations/0002_views_rls_seed.sql` — helpers, RLS,
   three starter plans, default settings
3. `supabase/migrations/0003_worker_rpcs.sql` — worker RPCs and extra indexes
4. `supabase/migrations/0004_retention_and_records.sql` — data retention and the
   records-view indexes
5. `supabase/migrations/0005_location_change_flag.sql` — the movement flag and
   its backfill
6. `supabase/migrations/0006_store_movements_only.sql` — drops the repeats and
   the flag; the worker now filters before writing
7. `supabase/migrations/0007_two_truck_alerts.sql` — retires the eight rule kinds
8. `supabase/migrations/0008_credits_and_alert_rules.sql` — one credit balance,
   and the admin's alert-rule catalogue

`node scripts/push-migrations.mjs` applies them in order over a direct
connection. Every file is idempotent and is re-applied on each run, so they all
have to stay valid against the *current* schema, not just the schema of their
own day — which is why the later ones edit the earlier ones.

Before applying anything to a live database:

```bash
npm run migrate:check
```

That runs the whole chain inside one transaction and rolls it back, so a syntax
error or a broken dependency order surfaces without touching your data.

### 2. Environment

```bash
cp .env.example .env.local
```

**[docs/CREDENTIALS.md](docs/CREDENTIALS.md) walks through every value click by
click** — where in each dashboard to find it, and the two places people usually slip
up. Summary:

| Variable | Where from | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key — **server only, never commit** | yes |
| `LDB_API_URL` | defaults to the public endpoint | no |
| `TELEGRAM_BOT_TOKEN` | @BotFather, one bot for everyone | for alerts |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `..._PRIVATE_KEY` | one Google Cloud service account | for Sheets |
| `CRON_SECRET` | any long random string | for the worker |

### 3. Your own admin account

Put `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_NAME` in `.env.local`, then:

```bash
node scripts/bootstrap-admin.mjs
```

Creates the account, confirms the email, sets `role = 'super_admin'`. Safe to re-run
to reset your own password. **Delete those three lines once you can sign in** — they
are a local bootstrap convenience and are never read by the deployed app.

### 4. Run it

```bash
npm run dev
```

Sign in at <http://localhost:3000/login>. Admins land on `/admin`, officers on
`/portal` — the same login serves both.

### 5. Deploy

Push to GitHub, import into Vercel, paste the same environment variables into
**Settings → Environment Variables** (all except `SUPABASE_DB_URL` and the three
`ADMIN_*` lines — those are local-only).

**Scheduling the worker.** Vercel's Hobby plan allows only one cron run per day, so
`vercel.json` is set to a daily run as a backstop. For real 5-minute tracking, this
repo ships `.github/workflows/track.yml`, which calls the same endpoint from GitHub
Actions for free. Add two repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `APP_URL` | `https://your-project.vercel.app` (no trailing slash) |
| `CRON_SECRET` | the same value you put in Vercel |

Then trigger it once from the **Actions** tab to confirm it works. See
[docs/TRACKING-WORKER.md](docs/TRACKING-WORKER.md) for the trade-offs and other
schedulers.

### 6. First officer

1. **Admin → Plans** — check the seeded plans or make your own.
2. **Admin → Officers → New officer** — fill in details, pick a plan. Copy the
   generated password from the success message; it is shown once.
3. Give the officer their email, password and your bot's Telegram handle.
4. They sign in, send `/start` to the bot, paste the chat id in **Settings**, and add
   their first truck.
5. **Admin → Settings → Run the worker now** to confirm the chain end to end.

---

## Credentials: what you hold, what the officer gives you

You hold every credential. The officer supplies two harmless strings.

**Telegram — one platform bot.** Create it with
[@BotFather](https://t.me/BotFather), put the token in `TELEGRAM_BOT_TOKEN`. The
officer sends your bot `/start` (Telegram will not let a bot message someone who has
not started it), then you read their numeric chat id with
`node scripts/get-telegram-chat-id.mjs` — or they fetch it themselves from
`@userinfobot`. That number is all you need. **A mobile number is never involved**,
and officers never create bots.

**Google Sheets — one service account.** Create a service account in Google Cloud,
enable the Sheets API, put the client email and private key in the env vars. The
officer creates a blank sheet, shares it as **Editor** with your service-account
address (shown on both settings pages), and sends the link. No OAuth screen, no
officer credentials, no per-officer Apps Script.

**Why not the Apps Script approach from the original guide?** It works for one sheet
but needs a separate script, trigger and Google account per officer, and you cannot
see or bill usage centrally. One worker writing into per-officer sheets scales to
fifty officers; fifty Apps Script projects does not.

---

## Data retention

The officer's Google Sheet is the permanent record. The database only needs
enough history to answer "where has this truck been lately", so old rows are
trimmed automatically.

- **`data_retention_days`** is a limit like any other: a plan default, a
  per-officer override, `-1` to keep everything. Default 30 days.
- The purge runs **once a day**, at the end of a tracking sweep, and deletes
  `truck_events`, `search_logs`, `alert_logs` and old `usage_counters` past the
  window. Admin → Settings has a manual **Clear old records now** button.
- **An officer with no working Google Sheet is skipped.** For them the database
  is the only copy, and trimming it would lose the case history rather than a
  cache. The admin can override that with an explicit checkbox.
- The officer sees their own retention window, and a warning if they have no
  sheet, on both **Records** and **My plan**.

### What actually gets stored

**One row per movement.** The worker polls LDB on each truck's interval, but a
poll is not an event: the portal reports the same crossing under several
sequence numbers, and a parked truck registers over and over. Those readings say
nothing the previous row does not already say, so they are **never written** —
not to the database, not to the sheet.

The decision happens before the insert. The portal's list is walked
oldest-first, each plaza compared with the one before it, seeded from the
truck's **last saved location**. That seed is what makes it stable: the same
reading is skipped on every poll, so it is never inserted and never alerted on,
even when the portal's window slides and a response starts mid-run.

| What happens | What is stored |
| --- | --- |
| Truck moves to a new plaza | one row: time + new location |
| Same plaza reported 3× in one response | one row |
| The same response polled again 5 minutes later | nothing |
| Truck parked at a plaza for an hour | nothing |
| Return trip A → B → A | three rows — the location changed each time |

Comparison is on a normalised name, so `"Nadiad Toll Plaza"` and
`" nadiad toll  plaza "` are the same place.

**Call logging follows the same idea.** A manual search is always logged — the
officer spent a credit and needs to see it. A background check is logged only
when it found a movement or failed; a quiet check is counted against the monthly
quota (by `consume_quota()`, into `usage_counters`) but does not add a row.
Fifty trucks on a ten-minute interval would otherwise write over 200,000 rows a
month saying "nothing happened".

---

## Security model

- **RLS is on for every table.** Officers only ever read rows where
  `user_id = auth.uid()`. Log tables (`truck_events`, `search_logs`, `alert_logs`,
  `usage_counters`) are read-only to them; only the worker writes those.
- **Officers cannot write `profiles`.** No self-promotion to admin, no editing their
  own plan.
- **The service-role key never reaches the browser.** It is used only inside Server
  Actions and route handlers, each of which first calls `assertSuperAdmin()` or
  `assertPortalUser()`. Every officer-facing query is additionally scoped by the
  session's own user id.
- **`is_super_admin()`** is `SECURITY DEFINER` so policies can call it without
  recursing through the `profiles` policy.
- **Every admin mutation is audited** with actor, timestamp and a field-level diff.
- **The cron route requires `CRON_SECRET`** and refuses to run if it is unset.
- **Suspending an officer** pauses their background tracking, so a suspended account
  cannot keep burning LDB quota.

---

## Layout

```
src/
  app/
    login/  no-access/
    admin/                  overview · officers · plans · trucks · usage ·
                            alerts · audit · settings · usage/export (CSV)
    portal/                 home · search · trucks · alerts · cases · settings
    api/cron/track/         the tracking worker
  components/               ui · form · Modal · ActionForm · Timeline · TruckCard ·
                            SearchBox · UsageChart · AdminNav · PortalNav
  lib/
    limits.ts               single source of truth for every limit
    tracking.ts             the sweep: credits -> check -> store -> alert -> sheet
    alerts.ts               the three alert rules, evaluated per truck alert
    ldb.ts                  LDB client + response parser
    telegram.ts  sheets.ts  delivery
    geo.ts                  toll-plaza -> state keyword table
    auth.ts  officer.ts     the two gates
    manual-search.ts        shared officer-initiated lookup
    audit.ts  format.ts  forms.ts  intervals.ts  settings.ts  env.ts  types.ts
supabase/migrations/        0001 schema · 0002 views+RLS+seed · 0003 worker RPCs
scripts/bootstrap-admin.mjs        create or reset your super-admin login
scripts/get-telegram-chat-id.mjs  read an officer's chat id after they press Start
docs/CREDENTIALS.md         where every .env value comes from, step by step
docs/TRACKING-WORKER.md     how the worker runs, and how to debug it
```

Adding a new limit means editing `src/lib/limits.ts` and adding the column — the plan
editor, the override editor and the usage tables all pick it up automatically.

## Checks

```bash
npm run typecheck
npm run build
```

### What has been verified

- All three migrations run clean on PostgreSQL 17 and 18.
- `consume_quota()` behaviour: exhaustion, unlimited (`-1`), expired plans, suspended
  accounts, override inheritance, cascade deletes.
- 62 logic assertions over the LDB parser, IST timestamp handling, status
  derivation, due-interval maths with the global floor, and limit parsing.
  These predate the two-alert rework: the assertions covering the eight retired
  rule kinds went with them, and the two alerts that replaced them have not been
  put through the same suite.
- 28 query shapes run against a real PostgREST instance, including the embedded
  `profiles!inner` join the worker relies on and the `ON CONFLICT DO NOTHING …
  RETURNING` upsert that tells the worker which crossings are new.
- A full worker sweep against a mock LDB portal: 3 trucks → 3 crossings stored,
  3 alerts raised, one 403 recorded and retried, quota consumed exactly once per
  poll. A forced second sweep produced zero duplicate events and zero duplicate
  alerts.
- Guards: cron route rejects a wrong secret, suspended officers are excluded, the
  global kill switch stops everything, an expired plan pauses every truck.
- All 21 routes render, and the CSV export produces correct billing rows.

Telegram and Google Sheets delivery were exercised only through their failure paths
(no live bot token or service account in the test environment) — the errors are
recorded and surfaced as designed, but a real send needs your credentials.
