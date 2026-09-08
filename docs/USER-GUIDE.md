# Rahdari — user guide

For the officer using the platform. Everything here is also on the website at
**/guide**, which reads its figures live from the database; this document is the
readable, printable, sendable version.

> **Every number in this document is the value in force when it was written
> (September 2026).** Plans, credit packs, rates, alert rules, the referral
> percentages and the auto-pause windows are all rows an administrator edits
> without a deploy. `/guide` on the site always shows the live ones. Where the
> two disagree, the site is right and this file is stale.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Your first ten minutes](#2-your-first-ten-minutes)
3. [A plan and credits are two different things](#3-a-plan-and-credits-are-two-different-things)
4. [What spends a credit](#4-what-spends-a-credit)
5. [The plans](#5-the-plans)
6. [Topping up credits](#6-topping-up-credits)
7. [Searching a lorry by hand](#7-searching-a-lorry-by-hand)
8. [Putting a lorry under watch](#8-putting-a-lorry-under-watch)
9. [Getting the alerts on your phone](#9-getting-the-alerts-on-your-phone)
10. [Pausing — how you stop spending](#10-pausing--how-you-stop-spending)
11. [Groups](#11-groups)
12. [Invite and earn](#12-invite-and-earn)
13. [What the records can and cannot show](#13-what-the-records-can-and-cannot-show)
14. [If something looks wrong](#14-if-something-looks-wrong)
15. [Getting help](#15-getting-help)
16. [Screenshots still to be added](#16-screenshots-still-to-be-added)

---

## 1. What it does

You give Rahdari a lorry's registration number. It asks the national toll
network what that number has been recorded at, and shows you the plazas it has
passed, newest first, with the time of each crossing.

You can do that once, by hand, whenever you want to know. Or you can put a
lorry **under watch**, and Rahdari does the asking for you on a beat you choose,
sending a Telegram message when it finds something.

How a crossing reaches your screen:

1. A lorry passes a tolled highway plaza.
2. The gantry records that passing.
3. The record reaches the national logistics data infrastructure.
4. Rahdari asks for it, and it appears on your screen.

**This is not GPS.** A lorry is only visible where there is a reading point. One
on state roads, on a short local run, or one that simply has not passed a plaza
recently produces no records at all. *Nothing found means nothing was
recorded* — not that the lorry is not moving. Records can also arrive late, so
treat every timestamp as "recorded at", never as "is at".

---

## 2. Your first ten minutes

In this order. Step 4 is the one people skip, and it is the expensive one.

1. **Open an account.** Register with an email address and a password. Nothing
   is charged for this.
2. **Confirm your email with the 6-digit code.** We email a six-digit code and
   you type it in; it lasts about ten minutes. This is not decoration — the free
   trial will not start until the address is confirmed, because the trial is
   once per account and an unconfirmed address can be manufactured.
3. **Take the free trial, or buy a plan.** A plan is what allows automatic
   checking at all.
4. **Connect Telegram — before you switch any tracking on.** Save your chat id
   in Settings with the switch on. Alerts raised while it is not connected are
   recorded in the app and never sent, **and the credit is spent either way.**
   See [section 9](#9-getting-the-alerts-on-your-phone).
5. **Add a lorry and give it one alert.** A lorry with no alert switched on is
   never checked, so it costs nothing and tells you nothing.

---

## 3. A plan and credits are two different things

This is the only genuinely confusing thing about the product, and having it the
wrong way round is how people buy the wrong thing.

|             | A plan                                    | Credits                    |
| ----------- | ----------------------------------------- | -------------------------- |
| Decides     | How many lorries at once, and until when  | What each look costs       |
| Charged     | Once, for the whole term — not per month  | Whenever you top up        |
| Runs out    | On its end date                           | Never — except a trial's   |

You need both. **A plan with an empty balance checks nothing. Credits with no
plan still search by hand.**

Which do you buy when you run short?

- Checks being refused, or every lorry paused saying *No credits left* → you
  need **credits**. Top up.
- The app will not let you add another lorry → you need a **bigger plan**.
- Your plan has ended → **renewing** is the only thing that brings automatic
  checking back. Credits alone will not.

---

## 4. What spends a credit

Two things, and they cost the same:

- **1 manual search = 1 credit**
- **1 automatic check = 1 credit**

### A credit is spent when the check runs, not when it finds something

The credit goes the moment a check is made. It does **not** depend on whether
the lorry moved, whether the plaza changed, whether an alert was raised, whether
Telegram delivered it, or whether anything was found at all.

All four of these cost the same one credit:

- a new crossing was recorded
- nothing new since last time
- the portal did not answer
- the alert could not be delivered

That is why **how often** you check is the whole cost of the product, and why
[pausing a lorry](#10-pausing--how-you-stop-spending) is the biggest saving
available to you.

One more thing worth knowing: a credit is charged **per lorry per check, not per
alert**. Several alerts due on the same lorry at the same moment share one
charge. A *faster beat* costs more; more rules on the same beat do not.

### Do credits expire?

Credits you have paid for **never expire**. They are a lifetime wallet: they
survive your plan ending, they survive a renewal, and they are still there
months later.

The exception is the free trial. **Trial credits are destroyed when the trial
ends** — whatever is left goes with it. They were free and the trial is over.
Buying a plan carries on from there, and a plan brings its own credits.

---

## 5. The plans

Each price is for **the whole plan**, charged once. It is not a monthly price.

| Plan             | Price   | Term     | Credits | Lorries at once |
| ---------------- | ------- | -------- | ------- | --------------- |
| Free trial       | ₹0      | 7 days   | 15      | 1               |
| Mini             | ₹149    | 1 month  | 200     | 3               |
| Base             | ₹499    | 3 months | 800     | 10              |
| Professional     | ₹999    | 3 months | 2,000   | 25              |
| Team             | ₹2,999  | 3 months | 7,000   | 100             |

*Current values — see the note at the top of this file.*

**The free trial** is once per account, and only after the six-digit email code
has been confirmed. It watches one lorry, its credits die with it, and it
**cannot be topped up** — a top-up needs a *paid* plan. So a trial that has run
out of credits is finished until you choose one.

Worth being honest about: **no plan's included credits cover its own term for
one lorry on the fastest beat.** At a 15-minute beat one lorry spends about 96
credits a day, so Professional's 2,000 credits is roughly 21 days of the 90 it
runs for. The plan sets *how many* lorries and *for how long*; the credits set
*how closely*, and topping up is expected. Pick a slower beat and the same
credits go much further — see the table in
[section 8](#8-putting-a-lorry-under-watch).

### What each state lets you do

| Your account                       | Search by hand | Automatic tracking | Top up credits |
| ---------------------------------- | -------------- | ------------------ | -------------- |
| Paid plan, running                 | Yes            | Yes                | Yes            |
| Free trial, running                | Yes            | Yes                | **No** — needs a paid plan |
| Plan expired, or never bought one  | **Yes** — credits are a lifetime wallet | No | No — renew first |
| Free trial finished                | No — its credits went with it | No    | No — choose a plan |
| No credits left                    | No             | No — every lorry is paused | Yes, if a paid plan is running |

The row nobody guesses right is the third: **a lapsed plan is not a dead
account.** The credits are still there and they still search.

---

## 6. Topping up credits

A top-up adds credits and **changes nothing else** — not your plan, not its end
date, not how many lorries you may watch. Bigger rungs are better value.

| You pay        | You get                              |
| -------------- | ------------------------------------ |
| ₹149           | 300 credits                          |
| ₹499           | 1,000 credits                        |
| ₹999           | 2,500 credits                        |
| ₹2,499         | 7,000 credits                        |
| ₹3,000 or more | 300% — ₹1 buys 3 credits             |

*Current values — see the note at the top of this file.*

### A top-up needs a paid plan that is running right now

This catches people out. If your plan has **expired**, if you are on the **free
trial**, or if you have **never bought a plan**, a top-up is refused. Buy or
renew a plan first — and a plan brings credits of its own, so that is often the
only purchase you needed. Buying a plan and a top-up together in one payment is
fine.

---

## 7. Searching a lorry by hand

**Search** in the menu. Type the registration number and send it. One search is
one credit, and you get the plazas that number has been recorded at, newest
first.

- Spaces and case do not matter — `GJ01AB1234` and `gj 01 ab 1234` are the same
  lorry.
- A search works **even when your plan has ended**, as long as you have credits.
  That is the point of credits never expiring.
- An empty result is a real answer: nothing has been recorded for that number
  recently. It still costs the credit, because the asking is what costs.

Search when you want to know now and will not need to know again. Put a lorry
under watch when the question is "tell me when this moves".

---

## 8. Putting a lorry under watch

Add the lorry under **My trucks**, then give it at least one alert. A lorry with
no alert switched on is never checked at all — it sits on the list costing
nothing and telling you nothing.

A row on My trucks tells you four things: the **registration number** (which
opens the lorry's own page), **why it is live or why it stopped**, **the
switch** — which is what starts and stops the spending — and **what it has done
lately**, with how often it is checked.

### The kinds of alert

| Alert                       | What you hear                                                                 | Example message                            |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| **Every time we look**      | A message on every check, saying which plaza the lorry is at, even unmoved     | `GJ02AT8546 is at Nadiad Toll Plaza`       |
| **Only when it moves**      | We check just as often, but you only hear when it reaches a *different* plaza  | `GJ02AT8546 moved to Nadiad Toll Plaza`    |
| **When it reaches a plaza** | Name one plaza. You hear the first time the lorry is recorded there            | `GJ02AT8546 reached Nadiad Toll Plaza`     |

"Only when it moves" is the sensible default and the one the form lands on.
Note that **all three check just as often** — choosing "only when it moves" makes
your phone quieter, not your bill smaller. Only a slower beat does that.

You may have one enabled alert of each kind per lorry (and one per named plaza
for the plaza alert).

### How often to look — and what it costs

This is the single decision that sets your bill. Every look is a credit, so the
number of looks a day *is* the spend a day, per lorry.

| Look every  | Times a day | Credits a day | Credits in 30 days |
| ----------- | ----------- | ------------- | ------------------ |
| 15 minutes  | 96          | **96**        | 2,880              |
| 30 minutes  | 48          | 48            | 1,440              |
| 1 hour      | 24          | 24            | 720                |
| 3 hours     | 8           | 8             | 240                |
| 6 hours     | 4           | 4             | 120                |
| 12 hours    | 2           | 2             | 60                 |

Per lorry. Two lorries on the same beat cost twice this. A 15-minute beat is the
fastest most people reach for, and **96 credits a day** is worth seeing before
switching it on.

---

## 9. Getting the alerts on your phone

Alerts reach you over **Telegram**. They also always appear on the bell inside
the app. **WhatsApp is built but has nothing behind it yet** — it is shown as
"coming soon" and sends nothing.

### Read this twice. It is the most expensive mistake available.

**If no Telegram chat id is saved — or one is saved but the switch is off — the
alert is recorded in the app and never sent to anybody, and the credit is spent
all the same.**

From the outside it looks like the product is working: rows appear on the bell,
the balance goes down, and your phone stays silent. Nothing tells you at the
moment it happens.

The recording always happens. The *sending* is what depends on that one field.

**Connect Telegram before you switch any tracking on.**

### Connecting Telegram, step by step

First, find your chat id:

1. Open **t.me/userinfobot**.
2. Press **Start**. It replies with an **Id** — a plain number.
3. Paste that number into Settings and save.

Then save it and prove it works:

1. Turn **Send me alerts on Telegram** on. A saved id with the switch off sends
   nothing.
2. Press **Send test**. If the test message arrives, alerts will arrive.
3. If it does not, the usual cause is that our alerts bot has never been
   started. Telegram forbids a bot from messaging anyone who has not started it,
   so open the conversation with our bot, send it a `/start`, and test again.

**Why two bots?** The first bot only *tells you your own id* — it is a public
utility and sends you nothing afterwards. The alerts themselves come from our
own bot, which is why it needs its own `/start`. The **Send test** button is the
only reliable way to know both halves are done.

---

## 10. Pausing — how you stop spending

Pausing is not tidying up. It is **the main lever you have on your bill.** A
paused lorry is not checked, so it spends nothing, and it frees a slot on your
plan for another one.

> Paused trucks keep their history but do not consume tracking credits. Resume
> anytime when tracking is needed again.

A lorry parked in a yard answers every check with yesterday's crossing. Pause
it, and take it live again when it is back on the road — nothing is re-added and
nothing is lost.

### What stops a lorry being checked

- **Paused by you.** Track a lorry for the day, pause it tonight, go live again
  whenever you need it. No history is lost.
- **Tracking period ended.** Set an end time when you add a lorry — checking
  stops there even if you forget about it, so a forgotten lorry cannot quietly
  spend a fortnight of credits.
- **No movement detected.** Once no crossing has arrived for the hours allowed,
  checking pauses instead of paying for the same answer.
- **Portal not responding.** If the portal cannot answer for a number enough
  times in a row, checking pauses rather than paying a credit per error. Usually
  a typo.
- **No credits left.** An empty balance cannot pay for a check, so every lorry
  that was live is paused at once.
- **The plan ended.** When a plan lapses and the days to renew in have passed,
  automatic checking is switched off on every lorry. Your credits are untouched
  and still search by hand.

A suspended account stops every lorry at once as well; only support can switch
that back on.

**The no-movement window** is currently **8 hours** on this deployment, and it
is counted from the later of the last crossing and **the moment you took the
lorry live** — not from a crossing that was already old when you added it. So a
lorry standing still for a week still gets a full window of being watched from
the moment you switch it on. A crossing mid-flight resets the clock.

**Repeated failures**: you are messaged after five unanswered checks in a row,
and it pauses at about **10**. That is nearly always a typo in the registration
number — and a failed check costs a credit like any other, which is why
retrying a number the portal will not answer only buys errors.

Every paused lorry says why it stopped, and keeps every crossing it ever
recorded. A lorry that reaches a stop is not even charged for a farewell check —
the stop is worked out before any credit is spent.

---

## 11. Groups

A group is a folder of lorries you want to read together — a consignment, a
transporter, a case you are working. Put several lorries in one and their
crossings appear on a single combined timeline, so you can see which of them was
where and when.

Grouping costs nothing on its own. A group does not check anything; the lorries
inside it do, on their own alerts, exactly as they would alone.

---

## 12. Invite and earn

Share your invite link. When somebody who joined on it pays for their **first
plan**, and again when they **first top up**, you both get credits. Nothing
arrives when they merely register — a sign-up on its own earns nobody anything.

| Their first… | You get                  | They get                 |
| ------------ | ------------------------ | ------------------------ |
| Plan         | **20%** of what they paid | **10%** of what they paid |
| Top-up       | **20%** of what they paid | **10%** of what they paid |

*Current values — these four percentages are settings an administrator edits,
and `/guide` on the site shows the live ones.*

Once each, per person, paid as credits. Worked through at today's percentages:
they buy a ₹999 plan and later top up ₹3,000 — you receive 200 then 600 credits,
**800 in all**, and they receive **400**.

If they buy a plan and top up in **one payment**, it pays once on the whole
amount and closes both events — 800 credits to you and 400 to them for a single
₹3,999 payment, the same as buying the two separately.

---

## 13. What the records can and cannot show

**Not evidence on its own.** Records can be delayed, incomplete or absent
entirely, and a gap has innocent explanations. Use what you find as a lead to
corroborate by other means, never as proof on its own.

- A crossing means the lorry **was recorded** at that plaza at that time. It says
  nothing about where it is now.
- No records does not mean no journey — untolled roads produce nothing.
- The same plaza can be reported several times for one physical crossing.
  Repeats inside a short window are folded into one; past that window it is
  treated as a genuine return.
- How long crossings are kept is set by the administrator.

The full declaration — where the data comes from, who operates the underlying
infrastructure, and what Rahdari does and does not do to it — is at
**/data-sources** on the site.

---

## 14. If something looks wrong

**I searched a lorry and nothing came back.**
Almost always a lorry that has not passed a tolled plaza recently — see
section 1. Check the number for a typo, then try a lorry you know runs on
highways to satisfy yourself the search itself is working.

**My phone is silent but the balance is going down.**
This is the Telegram problem in section 9, and it is the first thing to check.
Open Settings, confirm a chat id is saved *and* the switch is on, and press
**Send test**. If the test does not arrive, our alerts bot has not been
started — send it a `/start`.

**My lorry paused itself.**
It will say which of the reasons in section 10 applied. One paused because it
stopped moving, or because an end time you set arrived, is working as intended
and costs you nothing while it sits there. One paused for repeated failures
usually has a wrong registration number. One paused for an empty balance or a
lapsed plan needs the account fixed first — switching it back on before that
will not hold.

**A top-up is being refused.**
A top-up needs a paid plan that is active right now — see section 6. On an
expired plan, on the trial, or with no plan ever bought, buy or renew a plan
instead. It brings credits with it.

**My checks stopped and nothing told me.**
Check the balance first: with nothing in it, nothing is checked, and every live
lorry is paused and marked *No credits left* so it stops costing you anything.
Then check whether the plan is still running. Then check Telegram.

**I cannot sign in and the reset email never arrives.**
Check the spam folder, then write to us from the address you registered with.

---

## 15. Getting help

**/support** on the site answers the questions that come up most. If yours is
not there, write to us with your account email and roughly when the problem
happened. Contact details are in the site footer and on **/contact**.

---

## 16. Screenshots still to be added

The website guide uses drawn figures rather than screenshots, deliberately: the
screens worth marking up are behind a sign-in and are being rebuilt, and a
manual showing last week's buttons is worse than one showing none — the reader
trusts the picture over the words, hunts for a control that has moved, and
concludes the product is broken.

When the portal settles, these are the shots worth taking **from a real phone**,
each with the marked-up element circled:

| # | Screen                        | What to circle                                                        |
| - | ----------------------------- | --------------------------------------------------------------------- |
| 1 | Settings → Telegram           | The chat id field, the *Send me alerts* switch, and **Send test**     |
| 2 | My trucks (list)              | One row: registration, status badge, the live switch, the alert count |
| 3 | A lorry's own page → add alert | The alert-kind dropdown and the interval field with its "times a day" line |
| 4 | My plan → Top up              | The pack ladder, and the balance above it                             |
| 5 | Search result                 | One crossing row: plaza, time, direction                              |
| 6 | Home                          | The credit balance and today's spend                                  |

Drop them in `public/guide/` as `01-telegram.png` … `06-home.png`, then replace
the matching `<Figure>` in `src/app/guide/Figures.tsx` with an `<Image>`. The
`Figure` wrapper already carries the caption and the sizing, so each swap is one
element. **Keep the captions**: a screenshot without a date or a "your screen may
differ" note is the thing that goes stale silently.
