# Truck Watch

A truck-tracking service. Look up a lorry by its registration number, see the toll
plazas it has passed, and get told on Telegram when it moves. Two apps and a
background worker in one Vercel deployment:

- **Customer dashboard** (`/portal`) — sign up, buy a plan, add a truck, attach
  alerts to it, and read the history. Alerts arrive on Telegram.
- **Admin console** (`/admin`) — set what a rupee buys and what a credit buys,
  maintain the alert catalogue, and see every account, truck and payment.
- **Tracking worker** (`/api/cron/track`) — checks a truck when one of its alerts
  is due, stores what moved, and sends the alert.

Anyone can register. An account starts with no plan and no credits; a plan is
bought, and credits are topped up when they run out. There is one super admin.

The brand name is a setting, not a constant — change it in Admin → Settings.

Next.js 15 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind CSS v4.

---

## What each app does

### Admin console — `/admin`

| Page | What you can do |
| --- | --- |
| **Overview** | Platform totals, 30-day usage chart, "needs attention" list (no plan yet, expired, out of credits, truck limit hit), credits outstanding |
| **Accounts** | Every registered account: contact details, plan, credit balance, top-ups, suspend, reset password. You can still create one by hand. |
| **Account detail** | Tabbed: overview, credits and full history, their trucks, their activity, settings. Assign a plan, add credits, set an individual truck limit. |
| **Plans** | Create, edit, archive. A plan sets a truck limit, the credits it includes and its price - all of it customer-facing |
| **Trucks** | Every tracked truck across all accounts, filtered by account, status or number |
| **Usage** | Credits spent per account, recent upstream calls with latency and failures, CSV export |
| **Alert rules** | The catalogue of alerts people may attach to a truck, plus the delivery log of everything sent |
| **Audit log** | What customers have been doing, with admin changes behind a filter |
| **Settings** | Site name, support details and policy links, open or close sign-up, payment keys, backup sheet and retention, the upstream endpoint, the global pause switch, **run the worker now**, **run the backup now** |

### Customer dashboard — `/portal`

| Page | What it does |
| --- | --- |
| **Home** | Credits held, spent today and this month; plan at a glance; today's alerts; today's usage below |
| **Search** | Look up any registration number. Results are stored at a permanent URL, so reopening one costs nothing |
| **Search result** | The route first, full width, then the detail underneath — plaza, state, timings, last crossing, add to tracking, add to a case |
| **My trucks** | The trucks under automatic checking, each showing its alerts and when it was last checked |
| **Truck detail** | Full route timeline, **the truck's alerts** — add as many as you like from the admin's catalogue, each with its own interval — alerts raised, recent checks, remove |
| **Records** | Every crossing in one place, either merged per truck number or as a flat filterable table, with analytics and CSV export |
| **Cases** | Case folders — paste a whole list of registration numbers, then read one combined timeline across the group |
| **My plan** | Credit balance and history, what each action costs, what the plan includes, when it expires |
| **Settings** | Connect Telegram, which is how alerts reach a phone |

Sidebar on desktop, thumb-reachable tab bar on mobile - most people use this from a phone.

---

## One credit balance

There is a single number to think about. There used to be two quotas —
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

A **plan** decides only two things: how many trucks may be watched at once, and
how many credits the account opens with. Everything else it used to carry is
either paid for out of the balance or set once for the platform. Plans are
assigned automatically on sign-up.

### Money in

Credits are bought in **packs** the admin writes as rows, so the pricing ladder
lives in the admin panel rather than in code:

| Pack | Price | Credits |
| --- | --- | --- |
| Starter | ₹100 | 100 |
| Standard | ₹500 | 1,200 |
| Plus | ₹1,000 | 2,500 |
| Custom amount | ₹3,000 **or more** | 250% — ₹3,000 buys 7,500 |

The ladder ends in a rule rather than a wall. The last rung is **open**: the
price becomes a minimum, the buyer names the amount, and
`credit_percent` says what share of the money becomes credits — 100 is one
credit per rupee, 250 is two and a half. Someone wanting 7,500 credits no
longer has to overshoot to the next fixed rung.

`credits_for_amount()` in the database is the authority on that sum. The
checkout recomputes through it before charging, because the amount arrives
from a form and forms are user-controlled.

Credits may be topped up **only while a plan is active** - buying a plan is what
a new account does first, and topping up is what it does when they run out. It
never has to buy the plan again. Payment is Razorpay, behind an admin toggle -
switch it off and credits arrive only from the admin, by hand.

Nothing the browser says is trusted. An order is recorded before checkout
opens, and what was bought is handed over only by `settle_payment()`, which flips the row
from `created` to `paid` in the same statement — so a replayed webhook, or a
handshake that arrives twice, grants nothing the second time. The webhook is
the authority rather than the browser, because someone can close the tab
before checkout returns.

So the whole flow is three admin-set steps: **money → credits** (packs),
**credits → usage** (rates), and **what a plan allows** (trucks).

### Referrals

Everyone gets a referral code, and a link that carries it into sign-up.

**A referral is worth nothing until the person invited makes their first
payment.** Sign-ups cost nothing to manufacture; payments do not. So a
referral sits at `pending` — visible to both sides, earning nothing — until
money actually arrives, and only then pays out:

- a share of that first payment, as credits (`referral_percent`),
- and a lump once N of them have paid (`referral_milestone_count` /
  `referral_milestone_bonus`).

Both are granted by `reward_referral()`, called from inside
`settle_payment()` — one path from "money arrived" to "everyone owed was
paid". It is idempotent twice over: the reward only matches a referral still
`pending`, and the milestone only pays when the ledger has no milestone row
for that referrer. A webhook delivered twice pays once.

A person can be referred once, by one person, ever — `referred_id` is unique,
or two referrers could both claim the same first payment. Nobody refers
themselves. Rewards land in `credit_transactions` like everything else, so a
balance is still explainable line by line.

How a number is stored:

| Value | Meaning |
| --- | --- |
| `-1` in a **plan** | Unlimited |
| `0` or more in a **plan** | Hard cap |
| `NULL` in an **override** | Inherit from the plan |
| `-1` in an **override** | Unlimited, for this account only |

In the UI you type a number or the word `unlimited`; a blank override means inherit.
The account detail page shows plan value / override / effective side by side.

**Credit arithmetic:** a truck with a 30-minute alert is 48 checks a day. At
1 credit = 2 checks that is 24 credits a day, so a 500-credit opening balance
covers roughly three weeks of one truck. Trucks are meant to be watched for
days, not months — an alert is switched off, or the truck removed, when the
case moves on.

---

## Setup

### 1. Supabase project

Create a project at [supabase.com](https://supabase.com) (Postgres 15+; the views use
`security_invoker`).

```bash
npm run migrate        # applies supabase/migrations/*.sql in filename order
```

Every file carries a header explaining what it changed and why, so
`ls supabase/migrations` is the index — a list here would only be a second
copy to keep in step, and it has already fallen behind twice.

Every file is idempotent and re-applied on every run, so each one has to stay
valid against the *current* schema rather than the schema of its own day —
which is why later migrations edit earlier ones.

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

Sign in at <http://localhost:3000/login>, or register at `/signup`. Admins land on `/admin`, everyone else on
`/portal` — the same login serves both.

### 5. Deploy

Push to GitHub, import into Vercel, paste the same environment variables into
**Settings → Environment Variables** (all except `SUPABASE_DB_URL` and the three
`ADMIN_*` lines — those are local-only).

**Scheduling the worker.** Nothing in this repo schedules it. The worker is one
authenticated URL, and it is called from [cron-job.org](https://cron-job.org):

| Field | Value |
| --- | --- |
| URL | `https://<your-domain>/api/cron/track` |
| Schedule | every 5 minutes |
| Header | `Authorization: Bearer <CRON_SECRET>` |

An alert can never fire faster than this tick, so the interval here is the real
floor on every alert in the app.

Vercel's own cron and a GitHub Actions workflow both used to live here and have
been removed. Vercel's Hobby plan allows one run a day, which is not tracking;
and a 5-minute schedule on a **private** GitHub repo burns roughly 8,600 billed
Actions minutes a month against a 2,000-minute allowance, so it stops silently
part-way through the month. An external scheduler has neither problem.

Whatever calls it, check that the response is JSON with `"ok": true`. A wrong
secret returns 403, but Vercel's deployment protection returns a **200 with an
HTML login page** — a scheduler that only checks the status code will report
success while nothing runs at all.

### 6. First account

1. **Admin → Plans** — check the seeded plans or make your own.
2. Register at `/signup` like any customer would, or create the account from
   **Admin → Accounts → New account** and copy the generated password, which
   is shown once.
3. Buy or assign a plan - a new account starts with none, so nothing can be
   tracked until it has one.
4. Send `/start` to the bot, paste the chat id in **Settings**, then add a truck
   and give it an alert. A truck with no alert is never checked.
5. **Admin → Settings → Run the worker now** to confirm the chain end to end.

---

## Credentials: what you hold, what a customer gives you

You hold every credential. A customer supplies one harmless string: their Telegram chat id.

**Telegram — one platform bot.** Create it with
[@BotFather](https://t.me/BotFather), put the token in `TELEGRAM_BOT_TOKEN`. The
customer sends your bot `/start` (Telegram will not let a bot message someone who has
not started it), then you read their numeric chat id with
`node scripts/get-telegram-chat-id.mjs` — or they fetch it themselves from
`@userinfobot`. That number is all you need. **A mobile number is never involved**,
and customers never create bots.

**Google Sheets — one service account.** Create a service account in Google Cloud,
enable the Sheets API, and put the client email and private key in the env vars.
You then create one backup sheet, share it as **Editor** with the service-account
address (shown in Admin → Settings), and paste the link there. Old crossings are
copied into it before they are deleted, and no customer ever handles a credential.

**Why one sheet and not one each?** Customers used to connect their own, written
to on every check. That put the copy which has to survive the purge in the hands of
someone not running the purge, and a third-party write on the hot path of every
check. One sheet the operator owns, written in bulk just before a delete, is the
same record without either problem.

---

## Data retention

One Google Sheet, owned by the operator, is the long-term record. The database
only needs enough history to answer "where has this truck been lately", so old
rows are copied out and then deleted.

- **`data_retention_days`** is one platform setting, not a per-account one.
  `-1` keeps everything. Default 30 days.
- **`backup_interval_days`** decides how often the copy-and-delete runs. It
  happens at the end of a tracking sweep, and Admin → Settings has a manual
  **Run backup now** button.
- **A failed copy deletes nothing.** Losing the only record of where a truck
  went because a sheet was misconfigured is far worse than carrying the rows
  for another interval.
- **No sheet configured means no backup is wanted**, and the rows are simply
  deleted on schedule. That is a supported choice and the settings page says so
  in red, because it is permanent.

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
| Out and back past **one** plaza, hours apart | two rows — see below |

Comparison is on a normalised name, so `"Nadiad Toll Plaza"` and
`" nadiad toll  plaza "` are the same place.

#### The same plaza twice

That last row is the case that is easy to get wrong. Take:

```
Dahegam → Malvan (11:00) → Ahmedabad → Malvan (15:00) → Dahegam
```

Only Malvan is a toll plaza, so the platform sees *Malvan, then Malvan* and
nothing in between. Comparing plaza names alone, the second one looks like the
first being re-reported, and the entire return leg disappears — no row, and no
alert.

**Time is the only thing that separates them.** Two readings of one crossing
arrive minutes apart; a return trip is hours later. So `revisit_minutes`
(default 90, in Admin → Settings) is how long the same plaza keeps counting as
the same crossing. Inside it, a repeat is ignored. Past it, the truck has come
back and that is news.

Alerts ask the same question of the crossing rather than the name:
`truck_alerts.last_event_at` records *which crossing* an alert last reported,
so a second pass of one plaza fires ("is back at Malvan") while the same
crossing re-reported stays silent.

**Call logging follows the same idea.** A manual search is always logged —
someone spent a credit and needs to see it. A background check is logged only
when it found a movement or failed; a quiet check still costs its credit, which
`credit_transactions` records, but does not add a log row. Fifty trucks on a
ten-minute interval would otherwise write over 200,000 rows a month saying
"nothing happened".

---

## Security model

- **RLS is on for every table.** Accounts only ever read rows where
  `user_id = auth.uid()`. Log tables (`truck_events`, `search_logs`, `alert_logs`,
  `usage_counters`) are read-only to them; only the worker writes those.
- **Accounts cannot write `profiles`.** No self-promotion to admin, no editing their
  own plan.
- **The service-role key never reaches the browser.** It is used only inside Server
  Actions and route handlers, each of which first calls `assertSuperAdmin()` or
  `assertPortalUser()`. Every customer-facing query is additionally scoped by the
  session's own user id.
- **`is_super_admin()`** is `SECURITY DEFINER` so policies can call it without
  recursing through the `profiles` policy.
- **Every admin mutation is audited** with actor, timestamp and a field-level diff.
- **The cron route requires `CRON_SECRET`** and refuses to run if it is unset.
- **Suspending an account** pauses its background tracking, so a suspended account
  cannot keep burning LDB quota.

---

## Layout

```
src/
  app/
    login/  no-access/
    admin/                  overview · accounts · plans · trucks · usage ·
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
    auth.ts  officer.ts     the two gates (officer.ts is the portal gate)
    manual-search.ts        shared person-initiated lookup
    audit.ts  format.ts  forms.ts  intervals.ts  settings.ts  env.ts  types.ts
supabase/migrations/        0001 schema · 0002 views+RLS+seed · 0003 worker RPCs
scripts/bootstrap-admin.mjs        create or reset your super-admin login
scripts/get-telegram-chat-id.mjs  read a chat id after someone presses Start   
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
- Guards: cron route rejects a wrong secret, suspended accounts are excluded, the
  global kill switch stops everything, an expired plan pauses every truck.
- All 21 routes render, and the CSV export produces correct billing rows.

Telegram and Google Sheets delivery were exercised only through their failure paths
(no live bot token or service account in the test environment) — the errors are
recorded and surfaced as designed, but a real send needs your credentials.
