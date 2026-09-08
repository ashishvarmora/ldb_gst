# Rahdari — the officer's manual

For the person using the platform. Print it, or forward it. Everything here is
also in the help centre at **/guide** on the site, which reads its figures live
from the database.

> **Where this file and the site disagree, the site is right.** Plans, prices,
> credit packs, the trial's length, the no-movement window, the referral
> percentages and the failure limit are all rows an administrator edits without
> a deploy, so this file names them rather than quoting them. What *is* fixed in
> the product is stated outright: **one manual search is one credit, one
> automatic check is one credit, one alert of each kind per lorry.**

No screenshots: a manual showing last week's buttons is worse than one showing
none, because the reader trusts the picture over the words. Each screen is
described and each button named instead.

---

## Contents

1. [What Rahdari does](#1-what-rahdari-does)
2. [Your first day](#2-your-first-day)
3. [A plan and credits are two different things](#3-a-plan-and-credits-are-two-different-things)
4. [What spends a credit](#4-what-spends-a-credit)
5. [Do credits expire](#5-do-credits-expire)
6. [What each account state can do](#6-what-each-account-state-can-do)
7. [Topping up credits](#7-topping-up-credits)
8. [Searching a lorry by hand](#8-searching-a-lorry-by-hand)
9. [Putting a lorry under watch](#9-putting-a-lorry-under-watch)
10. [How often to check, and what it costs](#10-how-often-to-check-and-what-it-costs)
11. [Getting the alerts on your phone](#11-getting-the-alerts-on-your-phone)
12. [Pausing, and the automatic stops](#12-pausing-and-the-automatic-stops)
13. [Groups](#13-groups)
14. [Invite and earn](#14-invite-and-earn)
15. [Paying, receipts and coupons](#15-paying-receipts-and-coupons)
16. [What the records can and cannot show](#16-what-the-records-can-and-cannot-show)
17. [If something looks wrong](#17-if-something-looks-wrong)
18. [Questions people ask](#18-questions-people-ask)
19. [Getting help](#19-getting-help)

---

## 1. What Rahdari does

You give Rahdari a lorry's registration number. It asks the national toll
network what that number has been recorded at, and shows you the plazas it has
passed, newest first, with the time of each crossing.

You can do that once, by hand, whenever you want to know. Or you can put a
lorry **under watch**, and Rahdari does the asking for you on a beat you choose,
sending a Telegram message when it finds something.

A crossing reaches your screen in four moves: the lorry passes a tolled plaza,
the gantry records it, the record reaches the national logistics data
infrastructure, and Rahdari asks for it.

**This is not GPS.** There is no device in the lorry, and a lorry is only
visible where there is a reading point. One on state roads, on a short local
run, or one that simply has not passed a plaza recently produces no records at
all. *Nothing found means nothing was recorded* — not that the lorry is not
moving. Records can also arrive late, so read every timestamp as "recorded at",
never as "is at".

---

## 2. Your first day

Seven steps, in this order — step 4 is the one people skip, and it is the
expensive one. The notes below cover the six that need one.

| # | Step | Where | Costs |
| - | ---- | ----- | ----- |
| 1 | Open an account | **/signup** | Nothing |
| 2 | Confirm your email with the six-digit code | **/portal/verify-email** | Nothing |
| 3 | Start the free trial, or buy a plan | **/portal/plan** | Trial is free |
| 4 | **Connect Telegram and send a test** | **/portal/settings** | Nothing |
| 5 | Add a lorry, and give it one alert | **/portal/trucks** | 1 credit a check |
| 6 | Check the lorry says it is live | **/portal/trucks** | — |
| 7 | Watch the balance for a day | **/portal/plan** | — |

**2 · Confirm your email.** We email a six-digit code and you type it in. Each
code can be used once and expires; if it has not arrived, look in the spam or
junk folder and mark it *not spam* so later mail from us reaches you, then send
a fresh one. This is not decoration — the free trial will not start until the
address is confirmed, because the trial is once per account and per mailbox and
an unconfirmed address can be manufactured. Buying a plan or credits never asks
for a code.

**3 · Take the free trial, or buy a plan.** A plan is what allows automatic
checking at all. The trial is offered once, watches one lorry, and cannot be
topped up.

**4 · Connect Telegram — before any lorry goes live.** Save your chat id in
Settings **with the switch on**, and press **Send test**. Alerts raised while it
is not connected are recorded in the app and never sent to anybody, **and the
credit is spent either way.** Section 11 has the steps.

**5 · Add a lorry and give it one alert.** Adding it under **My trucks** starts
it live straight away, so do step 4 first. A lorry with no alert switched on is
never checked — it costs nothing and tells you nothing.

**6 · Confirm it is live.** The row on My trucks shows the number, whether it is
live or why it stopped, the switch that starts and stops the spending, and when
it was last checked.

**7 · Watch the balance for a day.** The checks a day are the spend a day; the
only fixes are a slower interval or a paused lorry — see section 10.

---

## 3. A plan and credits are two different things

This is the only genuinely confusing thing about the product, and having it the
wrong way round is how people buy the wrong thing.

|              | A plan                                   | Credits                    |
| ------------ | ---------------------------------------- | -------------------------- |
| Decides      | How many lorries at once, and until when | What each look costs       |
| Charged      | Once, for the whole term — not per month | Whenever you top up        |
| Runs out     | On its end date                          | Never, except a trial's    |
| Without it   | No automatic checking, no top-ups        | Nothing can be checked     |

You need both. **A plan with an empty balance checks nothing. Credits with no
plan still search by hand.**

Which do you buy when you run short?

- Every lorry paused saying *No credits left*, or a search refused → you need
  **credits**. Top up.
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
the lorry moved, whether the plaza changed, whether an alert was raised,
whether Telegram delivered it, or whether anything was found at all.

| What happened on the check      | Costs |
| ------------------------------- | ----- |
| A new crossing was recorded     | 1 credit |
| Nothing new since last time     | 1 credit |
| The portal did not answer       | 1 credit |
| An alert could not be delivered | 1 credit |

That is why **how often** you check is the whole cost of the product, and why
pausing a lorry is the biggest saving available to you.

**Alerts and their delivery are free.** A Telegram message costs nothing; only
the look costs.

**Charged per lorry per check, not per alert.** Several alerts falling due on
the same lorry at the same moment share one charge. A faster beat costs more;
more rules on the same beat do not.

Where the credits went is on two screens: **/portal/activity** breaks the
spending down by day and by lorry, and **/portal/credits** is the statement of
everything added and used.

---

## 5. Do credits expire

**Credits you have paid for never expire.** They are a lifetime wallet: they
survive your plan ending, they survive a renewal, and they are still there
months later.

**Trial credits do.** The unused trial balance is cleared when the trial ends —
whatever is left goes with it. They were free and the trial is over, so the
leftover cannot be spent later and it is not restored by buying a plan.

The trial ends on **its days or its credits, whichever runs out first**, because
a trial cannot be topped up. A plan starts a fresh term from the day you buy it,
brings credits of its own, and does not carry the trial's remaining days over.

---

## 6. What each account state can do

| Your account                      | Search by hand | Automatic tracking | Top up credits |
| --------------------------------- | -------------- | ------------------ | -------------- |
| Paid plan, running                | Yes | Yes | Yes |
| Free trial, running               | Yes | Yes | **No** — needs a paid plan |
| Plan expired, or never bought one | **Yes** — credits are a lifetime wallet | No | No — renew first |
| Free trial finished               | No — its credits went with it | No | No — choose a plan |
| No credits left                   | No | No — every lorry is paused | Yes, if a paid plan is running |

The row nobody guesses right is the third: **a lapsed plan is not a dead
account.** The credits are still there and they still search.

**Renewing** is a button on **/portal/plan**, but only once the plan has
actually ended. Changing plan, adding lorries mid-term or renewing early is not
self-service — ask us and we will set it up.

**When a plan ends,** automatic checking stops that day. Your lorries stay on
the list untouched for the renewal window the plan page names, so renewing
inside it carries on exactly where it stopped. After that window every lorry is
switched off and marked *Plan ended* — nothing is deleted, and you take the ones
you still need live again yourself.

---

## 7. Topping up credits

A top-up adds credits and **changes nothing else** — not your plan, not its end
date, not how many lorries you may watch. The ladder of packs, the open tier and
what each rung is worth are on **/pricing** and on **/portal/plan**; bigger
rungs are better value.

### A top-up needs a paid plan that is running right now

This catches people out. If your plan has **expired**, if you are on the **free
trial**, or if you have **never bought a plan**, a top-up is refused. Buy or
renew a plan first — and a plan brings credits of its own, so that is often the
only purchase you needed. Buying a plan and a top-up in one payment is fine.

---

## 8. Searching a lorry by hand

**Search** in the menu, at **/portal/search**. Type the registration number and
send it. One search is one credit, and you get the plazas that number has been
recorded at, newest first.

- Spaces, hyphens and capitals are ignored — `GJ01AB1234` and `gj 01 ab 1234`
  are the same lorry.
- A search works **even when your plan has ended**, as long as you have
  credits. That is the point of credits never expiring.
- An empty result is a real answer: nothing has been recorded for that number
  recently. It still costs the credit, because the asking is what costs.

Search when you want to know now and will not need to know again. Put a lorry
under watch when the question is "tell me when this moves".

---

## 9. Putting a lorry under watch

Add the lorry under **My trucks**, and give it at least one alert in the same
step. It goes live immediately, so connect Telegram first.

A lorry with no alert switched on is never checked at all — it sits on the list
costing nothing and telling you nothing.

### The kinds of alert

| Alert | What you hear | Example message |
| ----- | ------------- | --------------- |
| **Every time we look** | A message on every check, saying which plaza the lorry is at, even unmoved | `GJ02AT8546 is at Nadiad Toll Plaza` |
| **Only when it moves** | We check just as often, but you only hear when it reaches a *different* plaza | `GJ02AT8546 moved to Nadiad Toll Plaza` |
| **When it reaches a plaza** | Name one plaza. You hear the first time the lorry is recorded there | `GJ02AT8546 reached Nadiad Toll Plaza` |

"Only when it moves" is the sensible default and the one the form lands on.
**All three check just as often** — choosing "only when it moves" makes your
phone quieter, not your bill smaller. Only a slower beat does that.

**One enabled alert of each kind per lorry**, and one per named plaza for the
plaza alert. A second copy of a kind is refused: two of a kind means two beats
on one question and two charges every time they coincide. The interval belongs
to the alert you already have, so change it there.

### Naming a plaza

The plaza box offers the plazas **ahead of your lorry** — worked out from its
own last crossing and the direction of its last leg — and it forgives spelling,
so a letter out either way still finds the name.

Two things worth knowing. We only learn where a plaza is once some lorry has
been recorded there, so an empty list means we cannot place anything in front of
this one yet. And an alert fires only on the **exact name the toll record uses**:
you may confirm a name we do not hold, but if the network never produces that
name the alert stays silent for ever while the checks keep costing credits.

### Two more limits you set per lorry

- **A stop time.** Checking stops then, even if you forget about it — so a
  forgotten lorry cannot quietly spend a fortnight of credits.
- **A failure limit.** How many unanswered checks in a row this number is worth
  being patient with. Leave it blank to follow the platform's own setting.

---

## 10. How often to check, and what it costs

This is the single decision that sets your bill. Every look is a credit, so the
number of looks a day *is* the spend a day, per lorry.

| Look every | Times a day | Credits a day | Credits in 30 days |
| ---------- | ----------- | ------------- | ------------------ |
| 15 minutes | 96 | **96** | 2,880 |
| 30 minutes | 48 | 48 | 1,440 |
| 1 hour     | 24 | 24 | 720 |
| 3 hours    | 8  | 8  | 240 |
| 6 hours    | 4  | 4  | 120 |
| 12 hours   | 2  | 2  | 60 |

Per lorry. Two lorries on the same beat cost twice this. The interval field on
the form prints the same arithmetic as you type it.

Two things to hold together. **Check the credits your plan includes against this
table before you pick a beat** — the plan sets how many lorries and for how
long, the credits set how closely, and topping up is expected rather than
exceptional. And **no alert can fire faster than the platform's own sweep**, so
a very short interval buys less than it looks like.

---

## 11. Getting the alerts on your phone

Alerts reach you over **Telegram**. They also always appear on the bell inside
the app, whether or not they were delivered.

- **WhatsApp** is shown as *coming soon* and sends nothing at all today.
- There is **no SMS** channel.
- The app itself sends **no phone notifications**, on an iPhone home screen or
  anywhere else. Telegram is the delivery; the bell is the record.

### Read this twice. It is the most expensive mistake available.

**If no Telegram chat id is saved — or one is saved but the switch is off — the
alert is recorded in the app and never sent to anybody, and the credit is spent
all the same.**

From the outside it looks like the product is working: rows appear on the bell,
the balance goes down, and your phone stays silent. Nothing tells you at the
moment it happens. The recording always happens; the *sending* is what depends
on that one field.

### Connecting Telegram, step by step

**There are two bots and you must send `/start` to both.** They do different
jobs. Doing only the first is the most common reason alerts never arrive.

1. Open **[t.me/userinfobot](https://t.me/userinfobot?start=1)** and press
   **Start**. It replies with an **Id** — a plain number. *That is your chat id.
   This bot only reads it back to you; it never sends you anything else.*
2. Open **[t.me/Gst_truck_watch_bot](https://t.me/Gst_truck_watch_bot?start=1)**
   and press **Start** as well. *This is our bot — every alert is sent from it.
   Telegram forbids a bot from messaging anyone who has not sent it a `/start`,
   so without this step a correct chat id still delivers nothing.*
3. Paste the number into Settings and save.

Then prove it works:

1. Turn **Send me alerts on Telegram** on. A saved id with the switch off sends
   nothing.
2. Press **Send test**. If the test message arrives, alerts will arrive.
3. If it does not, step 2 above is almost always the one that was skipped. Open
   **t.me/Gst_truck_watch_bot**, press **Start**, and test again.

**Why two bots?** The first only *tells you your own id* and sends you nothing
afterwards; the alerts come from our own bot, which is why it needs its own
`/start`. **Send test** is the only reliable way to know both halves are done.

---

## 12. Pausing, and the automatic stops

Pausing is not tidying up. It is **the main lever you have on your bill.** A
paused lorry is not checked, so it spends nothing, it keeps every crossing it
ever recorded, and it frees a slot on your plan for another one.

> Paused trucks keep their history but do not consume tracking credits. Resume
> anytime when tracking is needed again.

### What stops a lorry being checked

| The row says | What happened | What to do |
| ------------ | ------------- | ---------- |
| **Paused by you** | You pressed pause | Go live whenever it is back on the road |
| **Tracking period ended** | The stop time you set arrived | Go live, and set a new stop time |
| **No movement detected** | No crossing arrived for the hours allowed | Go live when it is moving again |
| **Portal not responding** | The number could not be answered often enough in a row | Check the number for a typo, then go live |
| **No credits left** | The balance could not cover another check | Top up, then take the ones you need live |
| **Plan ended** | The plan lapsed and the renewal window passed | Renew, then take them live |
| **Account suspended** | The whole account is switched off | Only support can lift it |

The last three stop **every** lorry at once. Nothing about the registration
number failed, so do not go looking for one.

**The no-movement clock** runs from the later of the last recorded crossing and
**the moment you took the lorry live** — not from a crossing that was already
old when you added it. So a lorry standing still for a week still gets a full
window of being watched from the moment you switch it on, and a crossing
mid-flight resets the clock. The window in force for a lorry is on its own page.

**Repeated failures** are nearly always a typo in the registration number. You
are messaged after **five** unanswered checks in a row, and checking pauses when
that lorry's failure limit is reached. A failed check costs a credit like any
other, which is why retrying a number the portal will not answer only buys
errors.

**Two things that do not resume by themselves.** Topping up clears the refusal
but takes no lorry live; renewing brings tracking back but switches no lorry on.
Both are deliberate: the lorries that emptied a balance are usually the ones you
least want back on, and nothing is lost while they sit there. A lorry that
reaches a stop is not even charged for a farewell check — the stop is worked out
before any credit is spent.

---

## 13. Groups

A group is a folder of lorries you want to read together — a consignment, a
transporter, a case you are working. Put several lorries in one, at
**/portal/cases**, and their crossings appear on a single combined timeline, so
you can see which of them was where and when.

Grouping costs nothing on its own. A group does not check anything; the lorries
inside it do, on their own alerts, exactly as they would alone.

---

## 14. Invite and earn

Share your invite link from **/portal/referrals**. When somebody who joined on
it pays for their **first plan**, and again when they **first top up**, you both
get credits — a percentage of what they paid to you, and a smaller percentage to
them. The live percentages and a worked example are on that page.

- **Nothing arrives when they merely register.** A sign-up on its own earns
  nobody anything.
- **Once each, per person, ever.** The first plan pays once and the first top-up
  pays once; later purchases pay nothing.
- **Paid as credits, automatically,** the moment their payment goes through.
  There is nothing to claim.
- **One payment that buys a plan and a top-up together** closes both events and
  pays once on the whole amount, the same as buying the two separately.
- **You cannot refer yourself.** A referral is attached at sign-up, and an
  account cannot be its own referrer.
- A reward already earned is never taken back if a percentage changes later.

---

## 15. Paying, receipts and coupons

The checkout takes online payment through our payment provider. We never receive
or store your card or bank details, and **nothing here renews itself** — a plan
is one payment for its term, a top-up is one payment for credits, so every
charge is one you made yourself.

**Whether a payment happened is decided by the gateway, not by your browser.**
On a weak connection the money moves a few seconds before the credits do. The
page keeps checking by itself and you can leave it; if the credits still have
not landed, find the payment on **/portal/payments** and send us its reference.

**Receipts** are on **/portal/payments**: every payment has a full receipt with
its reference and what it bought, and the list can be exported.

**Coupons.** The code box says exactly why a code was refused — not recognised,
not started yet, expired, used up, already used by you, plans only, credit
top-ups only, or an order below its minimum. Check it against how the offer was
worded before writing to us.

**Paying another way.** Cash, bank transfer and cheque are recorded on your
account by hand, so ask us first. Credits are added once the money has actually
reached us.

**Refunds.** A plan is charged once for its term, and credits are a prepaid
entitlement with no cash value, so there is no self-service refund. If you
believe you have been charged incorrectly, write to us with the payment
reference. The full position is at **/terms**.

---

## 16. What the records can and cannot show

**Not evidence on its own.** Records can be delayed, incomplete or absent
entirely, and a gap has innocent explanations. Use what you find as a lead to
corroborate by other means, never as proof on its own.

- A crossing means the lorry **was recorded** at that plaza at that time. It
  says nothing about where it is now.
- No records does not mean no journey — untolled roads produce nothing.
- Only *movements* are kept. A reading that reports the plaza the lorry is
  already at is never stored, so a return trip A to B and back to A is three
  real rows rather than one repeated one.
- How long crossings are kept is set by the administrator.

You may only enquire about a lorry where you have a lawful basis to do so, and
you must not use Rahdari to follow a person. That is the condition enforced most
strictly — see **/terms**.

The full declaration of where the data comes from, who operates the underlying
infrastructure, and what Rahdari does and does not do to it is at
**/data-sources**.

---

## 17. If something looks wrong

| Symptom | Likely cause | What to do |
| ------- | ------------ | ---------- |
| My phone is silent but the balance keeps falling | Telegram not connected, or the switch is off | Settings: confirm the chat id is saved and the switch on, then **Send test**. If the test fails, send our bot a `/start` |
| I searched and nothing came back | The lorry has not passed a tolled plaza recently, or a typo | Check the number, then try a lorry you know runs on highways |
| Credits fell but the lorry did not move | Working as intended — the check is what is charged | Slow the interval, or pause the lorry |
| My lorry paused itself | One of the stops in section 12 | Read the badge on the row; it names which |
| All my lorries stopped at once | Empty balance, or the plan ended | Fix the account first — going live before that will not hold |
| I renewed and they are still off | Renewing does not switch lorries on | Take them live from My trucks |
| I topped up and tracking is still off | Topping up does not resume anything | Take them live from My trucks |
| Everything refused but credits are shown | A finished free trial — its credits ended with it | Choose a plan; it can bring credits with it |
| A top-up is refused | It needs an active, non-trial plan | Buy or renew a plan; it brings credits |
| The last-checked time is hours old | A lorry is checked only when one of its alerts is due | Check the interval, and that it is not paused |
| The lorry moved but no message came | Telegram, an alert switched off, a record not in yet, or a reading that named the same plaza | Work down that list in that order |
| It refuses a second alert of a kind | One alert of each kind per lorry | Change the interval on the one you have |
| The plaza is not in the list | We have not learned where it is, or it is spelt differently | Type it — spelling is forgiven. Confirm an unlisted name only if you are sure of it |
| "Portal not responding" | Usually a typo; sometimes a lorry the network stopped reporting | Check the number before going live again |
| The verification code never arrived | Filed as spam, or expired | Check spam, mark *not spam*, send a fresh code |
| The reset link does not work | They last an hour and work once | Ask for a new one at **/forgot-password** |
| I cannot find Sign out | It is in the account menu | Open the menu on a phone; top right under your name on a laptop |
| I paid and the credits are missing | The gateway confirms the payment, not the browser | Wait on the page a moment; then send us the reference from **/portal/payments** |

---

## 18. Questions people ask

### Getting started

**Can I try it before paying anything?** Yes — there is a free trial, one per
account and one per email address, started from **/portal/plan** once your email
is verified. It watches one lorry and comes with a small pot of credits; the
days and credits are on the trial card itself.

**How does it know where my lorry is? Is this GPS?** It is not GPS and there is
no device in the lorry. We ask the national toll network what your registration
number has been recorded at, so a lorry on untolled roads produces nothing.

**What is a credit?** One look at the toll records: one manual search costs one
credit, one automatic check costs one credit. Your balance is a single wallet
that pays for both.

### Money

**Why did my credits go down when the truck did not move?** Because a credit is
spent when a check runs, never on what it finds. No movement, nothing new, an
unchanged plaza, no alert raised — each is a check that happened and a credit
that is gone.

**Does a check that failed still cost me a credit?** Yes. A portal that did not
answer, an empty result and a new crossing all cost the same one credit, because
the asking is what is charged.

**Do the alerts and the Telegram messages cost credits?** No. Alerts and their
delivery are free; only a search and a check spend anything.

**Do my credits expire?** Credits you have paid for never expire. Free trial
credits are the one exception — the unused balance is cleared when the trial
ends.

**My plan has ended — have I lost my credits too?** No. They never expire and
they still pay for manual searches. What ends with the plan is automatic
tracking and the ability to top up.

**Why will it not let me buy credits?** A top-up needs a plan that is running
right now, and not a trial. Buy or renew a plan; it brings credits with it, and
a top-up can ride along on the same payment.

**I have three alerts on one lorry — is that three credits a check?** No. One
credit per lorry per check, not per alert. A faster interval costs more; more
rules on the same interval do not.

**How do I make my credits last longer?** Slow the interval down and pause what
you are not watching. Those are the only two levers, because the number of
checks a day is the spend a day.

**If I do not use my plan, do I get the money back?** A plan is charged once for
its term and credits have no cash value, so there is no self-service refund.
Write to us with the payment reference if you think a charge was wrong.

### Plans

**Do I need a plan just to search one number by hand?** No. Manual search runs
on credits alone, so it works on an expired plan and on an account that never
bought one. What needs a live plan is automatic tracking, and topping up.

**How many lorries can I watch at once?** Whatever your plan allows — and the
limit counts the lorries being watched, not the ones on your list, so pausing
one frees a slot.

**My plan has expired — what still works?** Manual search, and nothing else.
Renew inside the window the plan page shows and your lorries carry on where they
stopped; after it, they are switched off and you take them live again yourself.

**How do I renew, or move to a bigger plan?** Renewing is a button on
**/portal/plan**, but only once the plan has ended. Changing plan, adding lorries
mid-term or renewing early goes through us.

### Watching a lorry

**My lorry stopped being checked and I never paused it.** Something stopped it
and the row says which — an end time, no movement, a number the portal cannot
answer, an empty balance, or the plan ending.

**Why does it say no movement when the lorry moved this morning?** The clock
runs from the later of the last recorded crossing and the moment you took it
live. A crossing on an untolled road is not one we can see, so a lorry off the
highways looks parked.

**I added the lorry but nothing has happened since.** A lorry with no alert
switched on is never checked. Open it and switch one on.

**Does pausing lose the history?** No. A paused lorry keeps every crossing it
recorded, costs nothing while it sits there, and frees a slot on your plan.

### Alerts and delivery

**Where do the alerts actually reach me?** On Telegram, and on the bell inside
the app — every alert is recorded in the app whether or not it was delivered.

**Do I have to use Telegram?** To have an alert reach your phone, yes. If no
chat id is saved, or one is saved with the switch off, the alert is recorded and
never sent — and the credit is spent all the same.

**Can I get the alerts on WhatsApp or SMS?** Not yet. WhatsApp is marked coming
soon and sends nothing today, and there is no SMS channel.

**Will I get phone notifications if I add the app to my home screen?** No. The
app sends no notifications on any phone. Alerts arrive on Telegram and are
always listed on the bell when you open the app.

**The lorry moved but I got no message.** Check Telegram first. Then: the alert
may be switched off, the crossing may not have reached the toll network yet, or
the reading may have named the plaza the lorry was already at, which is not a
movement.

**It will not let me add the same alert twice.** One alert of each kind per
lorry. The interval belongs to the alert you already have, so change it there.

**The toll plaza I want is not in the list.** The list only holds plazas some
lorry has been recorded at, and it offers the ones ahead of yours first. You may
confirm an unlisted name, but an alert fires only on the exact name the toll
record uses.

**Is only-when-it-moves cheaper than every-time-we-look?** No. All the kinds
check exactly as often. Only a slower interval, or pausing, spends less.

### Payments

**I paid and my credits have not arrived.** The gateway confirms the payment,
not your browser. The page keeps checking by itself; if it still has not landed,
send us the reference from **/portal/payments**.

**My coupon code was refused.** The form says which reason it was — unknown,
not started, expired, used up, already used by you, plans only, credits only, or
below the minimum order.

**Where is my receipt?** On **/portal/payments**, with the reference and what it
bought. The list can be exported.

**Can I pay by cash or bank transfer?** Ask us first — an offline payment is
recorded by hand, and credits are added once the money has reached us.

**Will you charge my card again automatically?** No. Nothing renews itself;
every charge is one you made yourself.

### Invite and earn

**How much do I get for inviting somebody?** A percentage of what they pay,
twice: on their first plan and on their first top-up, with a smaller share to
them as well. The live figures are on **/portal/referrals**.

**When do the referral credits reach me?** As credits, automatically, the moment
their payment goes through. Each event pays once per person, ever.

**Does it pay when somebody just signs up on my link?** No. The reward is paid
when they pay for their first plan, and again on their first top-up.

**Can I use my own invite link?** No. A referral is attached at sign-up and an
account cannot refer itself.

### Account

**The verification code has not arrived.** Look in spam or junk and mark it not
spam. Each code is used once and expires, so send a fresh one if nothing comes.

**The password reset link does not work.** Reset links last an hour and work
once. Ask for a new one at **/forgot-password** and set the password straight
away.

**I cannot find Sign out.** It is in the account menu — open the menu on a
phone, or look under your name at the top right on a laptop.

**Everything is refused but the screen still shows credits.** That is a finished
free trial: its credits ended with it, so the figure cannot be spent. A plan
starts you again.

---

## 19. Getting help

**/support** on the site answers the questions that come up most, and **/guide**
is the full help centre and the version that stays current. If your question is
not there, write to us with your account email and roughly when the problem
happened. Contact details are in the site footer and on **/contact**.
