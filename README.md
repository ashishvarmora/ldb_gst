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

The sidebar is in three groups, by what you came to do. **Analyse** is
read-only and safe to click on; **Operate** is the day's work; **Configure** is
the settings that decide how the other two behave.

Every report shares one date-range control - Today, 7/30/90 days, this month,
last month, 12 months, all time, or a custom range - and one day/week/month
grouping toggle. Both live in the URL, so a report can be bookmarked, linked to,
or opened twice side by side on two ranges. All dates are IST.

| Page | What you can do |
| --- | --- |
| **Overview** | The way in. Six headline figures, each a link to the report it comes from, the 30-day usage chart, and the "needs attention" list - the one thing here that exists nowhere else (no plan yet, expired, out of credits, truck limit hit, payment stuck at "started"). |
| **Analyse › Finance** | Three sections. *Revenue*: money received, by day and by method (Razorpay, cash, bank transfer, UPI, cheque), what it bought, average payment, discounts given, who paid most. *Credit economy*: credits issued against credits spent, split by source, what the giveaway cost in rupees, biggest spenders and biggest receivers of free credits. *Receipts*: every payment, filterable by status, method and kind. **Record a payment** logs cash or a bank transfer, and it settles exactly like a gateway payment. |
| **Analyse › Users** | Sign-ups by day, split by whether somebody invited them, and how many of each cohort have since paid. Every account in one of seven lifecycle stages - active, plan expired, never bought, credits but no plan, dormant, never signed in, suspended - searchable, filterable by stage and sortable seven ways. |
| **Analyse › Usage** | Charged calls to the toll network, manual against automatic, what a call costs, and how the upstream API is behaving: failure rate, median and 95th-percentile response time. CSV export. |
| **Operate › Customers** | Every registered account: contact details, plan, credit balance, top-ups, suspend, reset password. You can still create one by hand. |
| **Operate › Customer detail** | Tabbed: overview, credits and full history, payments, their trucks, settings. Assign a plan, add credits, set an individual truck limit. |
| **Operate › Trucks** | Every tracked truck across all accounts, filtered by account, status or number |
| **Operate › Explore** | Look up one truck or one account across everything |
| **Operate › Logs** | Every search, alert and console change - filter by account, truck or day |
| **Configure › Plans & credits** | Create, edit, archive a plan; set what a credit buys and what a rupee buys |
| **Configure › Rewards** | Referral terms and discount codes, and what each has cost |
| **Configure › Alert rules** | The catalogue of alerts people may attach to a truck, plus the delivery log |
| **Configure › Storage** | Retention rules per table, with each table's current size |
| **Configure › Settings** | Site name, support details and policy links, open or close sign-up, payment keys, backup sheet, the upstream endpoint, the global pause switch, **run the worker now**, **run the backup now** |

Every figure on a report is computed by the database, through the `admin_*`
functions in `0024_admin_analytics.sql`, and no figure is computed in two
places. A number that appears on two screens is a number that can be wrong on
one of them.

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

## When a truck stops checking itself

Automatic checking costs a credit every time it runs, so the expensive mistake
is not a wrong setting - it is a watch nobody remembered to switch off. Someone
follows a lorry for an afternoon, does not come back, and pays hourly for weeks
to be told the same thing.

Four things stop a truck, and the reason is stored on the row so its owner is
told **which**. A truck that goes quiet without saying why is the failure all
of this is guarding against.

| Reason | Fires when | Who sets the number |
| --- | --- | --- |
| `schedule` | the officer said "for 6 hours" and 6 hours have passed | officer, when adding or editing the truck |
| `inactive` | no toll crossing has come through for Y hours - the lorry is parked | officer per truck, else `inactive_pause_hours` (default 72h) |
| `repeated_failures` | X checks in a row could not be answered | officer per truck, else `tracking_failure_cutoff` (default 10) |
| `manual` | somebody pressed Pause | — |
| `account_suspended` | the account was switched off | — |

Two rules hold across all of them:

- **The officer's number wins, and a blank follows the platform.** A per-truck
  null is never resolved at write time. Storing today's default onto the row
  would freeze it there, so changing the platform setting later would do
  nothing for any truck already added.
- **The check runs before the credit is spent.** A truck past its stop time must
  not pay for one last look on the way out - that charge is the whole thing the
  officer set the timer to avoid. Both timed stops are decided from the row
  alone, so neither costs an upstream call.

Resuming clears an expired deadline. Without that, pressing Resume on a truck
that stopped on schedule appears to do nothing: the old deadline is still on the
row and the next sweep stops it again.

`no_activity_hours` is a different setting and does not stop anything - it only
decides when the word on screen changes from "idle" to "no activity".

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
either paid for out of the balance or set once for the platform. A new account
has no plan and no credits until one is bought or assigned - sign-up gives
away nothing.

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

### Coupon codes

A coupon reduces what someone **pays**. It never reduces what they **get** —
credits come from the price *before* the discount, so a ₹500 pack worth 1,200
credits with 20% off means paying ₹400 and still receiving 1,200. Computing
credits from the discounted amount would quietly sell less than the code
advertised.

Codes support a percentage or a flat amount, an *up to* cap on a percentage, a
minimum spend, a total claim limit, a per-person limit, an optional date
window, and a restriction to plans or top-ups only.

The hard part is not the arithmetic, it is **counting claims honestly**. An
order is created before the money arrives and may never be paid, so a claim is
`reserved` when the order opens and only `applied` when the payment settles:

- Without the reservation, two people could spend the last claim on a
  single-use code at the same moment.
- Without the release, an abandoned checkout would burn that code for ever.

Claims count `reserved + applied`. A failed payment releases its hold, and a
hold nobody ever failed is released lazily by `validate_coupon` after 30
minutes — so the next person to type a code cleans up after the last one who
walked away, and no scheduled job is needed.

`validate_coupon()` is the single authority: the buyer's preview and the
checkout both call it, so the figure quoted and the figure charged cannot
disagree. `reserve_coupon()` re-validates rather than trusting the preview,
because the last claim may have gone in between. Codes are **not** readable by
customers under RLS — they are checked one at a time, never listed.
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

The database is on a free tier, and several tables grow without limit — one row
per lookup, one per crossing, one per alert. Almost none of it is read after a
case closes. So rows are **copied to a Google Sheet and then deleted**, on a
schedule the admin sets.

One window for everything was too blunt: a failed lookup is worth a week, a
toll crossing a month, and a credit movement for ever. So retention is **one
rule per table** in `retention_rules`, keyed by the table name so the purge job
needs no mapping and cannot drift out of step with the schema.

| Table | Default | Why |
| --- | --- | --- |
| `search_logs` | 7 days | The biggest source of rows and the least useful once a week old |
| `truck_events` | 30 days | What the records page reads |
| `alert_logs` | 30 days | What was sent, and whether Telegram took it |
| `audit_logs` | 30 days | Useful for a dispute, rarely after |
| `credit_transactions` | **forever** | The money ledger |
| `payments` | **forever** | A financial record |
| `coupon_redemptions` | **forever** | Deleting frees claims on limited codes |

The last three are flagged `is_protected`. They are the money record rather
than a log: balances are reconstructed from `credit_transactions`, so trimming
it does not free useful space, it destroys the explanation for someone's
balance. Giving a protected rule a finite window needs a deliberate
confirmation that says so.

**Each account may name its own sheet**, and the admin's sheet is the fallback
for anyone who has not. Both, rather than either: a customer keeps a copy of
their own history they can actually open, and nobody's rows are deleted
uncopied because they never set one up. (0009 consolidated these into a single
admin sheet; 0016 restored them for exactly that reason.)

Two safety properties worth knowing:

- **A failed copy deletes nothing.** Losing the only record of where a truck
  went because a spreadsheet was misconfigured is far worse than carrying the
  rows for another day.
- **The delete never runs past the rows just read.** The cutoff is the
  timestamp of the last exported row, not the wall clock, so a row written
  between the read and the delete is never removed uncopied.

A rule may also be set to delete **without** copying. That is supported and
permanent, so the admin screen says so in a warning tone.

Customers see their own history at **`/portal/activity`** — every search and
every credit movement, which is what answers "where did my credits go". The
page states its own retention window, read from the rules rather than
hard-coded.

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

- **RLS is on for every table**, verified rather than assumed. Accounts only ever
  read rows where `user_id = auth.uid()`. Log tables (`truck_events`,
  `search_logs`, `alert_logs`, `credit_transactions`) are read-only to them; only
  the worker writes those. `rate_limits` and `retention_rules` have RLS on with
  no policy at all, which denies everyone but the service role - that is
  deliberate, and `0025` says so out loud on every run so it reads as a decision
  rather than an oversight.
- **Accounts cannot write `profiles`.** No self-promotion to admin, no editing their
  own plan.
- **The service-role key never reaches the browser.** It is used only inside Server
  Actions and route handlers, each of which first calls `assertSuperAdmin()` or
  `assertPortalUser()`. Every customer-facing query is additionally scoped by the
  session's own user id.
- **`is_super_admin()`** is `SECURITY DEFINER` so policies can call it without
  recursing through the `profiles` policy.
- **Every admin mutation is audited** with actor, timestamp and a field-level diff.
- **The cron route requires `CRON_SECRET`**, compared in constant time, and
  refuses to run if it is unset.
- **Suspending an account** pauses its background tracking, so a suspended account
  cannot keep burning LDB quota.
- **No database function is callable from the browser.** Every `SECURITY DEFINER`
  function is granted to `service_role` only, and the schema's default privilege
  for new functions has been narrowed so the next one written does not inherit a
  grant. This was not true before `0025_security_hardening.sql`: earlier
  migrations wrote `revoke all ... from public`, and `PUBLIC` is not the roles
  `anon` and `authenticated`, so Supabase's default privilege had already handed
  both an explicit grant. Anyone with the anon key that ships in the browser
  bundle could call `grant_credits` and mint themselves credits. Verified closed
  by probing every one of them with that key.
- **Rate limits** on sign-in (per IP and per email), sign-up, password reset,
  checkout, coupon redemption, search and export. Counted in Postgres through
  `rate_limit_hit()`, so the limit holds across serverless instances; it fails
  open with a log line rather than locking real users out if the database is
  unreachable. Sign-in moved from the browser to a Server Action for this - an
  attempt the application never sees is an attempt it cannot count.
- **Security headers** on every response: HSTS, `nosniff`, `X-Frame-Options:
  DENY`, a Referrer-Policy, a Permissions-Policy, and a CSP. The CSP ships in two
  halves - the directives that cannot break a page (`object-src`, `base-uri`,
  `form-action`, `frame-ancestors`) are enforced; the full policy including
  `script-src` is Report-Only until it has been exercised against a real
  checkout, because a wrong `script-src` fails as a dead payment page.
- **A referral pays out only above `referral_min_payment`**, tested against what
  was actually charged after any discount. Without a floor, a deep coupon made a
  qualifying payment cost a few rupees, and referrals could be farmed.

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
