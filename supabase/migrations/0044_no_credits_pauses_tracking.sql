-- ===========================================================================
-- An empty balance stops the trucks, and says so on the row.
--
-- ---------------------------------------------------------------------------
-- 1 · THE RULE, IN THE OWNER'S WORDS
--
--     "credit khatam = no search and auto track can be possible"
--     "if credit become 00, all live tracking -> auto pause: with reason
--      (no credit are available)"
--
-- Two halves, and only the second one is missing.
--
-- The refusal already works: spend_credits() is the single gate both the
-- portal's manual search and the worker's automatic check pass through, and
-- since 0041 rated auto_check at 1 it refuses both with 'out_of_credits' the
-- moment the balance cannot cover the cost. Nothing here changes that.
--
-- What was missing was the CONSEQUENCE. The worker read the refusal, sent one
-- Telegram message a day, and left every truck switched on. So the balance
-- emptied and nothing on the phone changed: the lorries were still listed,
-- still showing a live switch, still claiming to be watched, and the crossing
-- nobody was told about was the one that mattered. A truck that is switched on
-- and is not being checked is a lie on the page, which is the same argument
-- 0041 made for 'plan_expired' and the same fix: make the row honest.
--
-- ---------------------------------------------------------------------------
-- 2 · WHY THIS IS A REASON OF ITS OWN AND NOT ONE OF THE SIX
--
-- 'account_suspended' was the nearest existing fit and it is the wrong one in
-- both directions. A suspended account is a decision somebody made about the
-- customer and is fixed by support; an empty balance is a number the customer
-- fixes themselves in about forty seconds, from a panel that is deliberately
-- open even to lapsed accounts. Filing the second under the first would send
-- every officer who ran out of credit to the support line.
--
-- 'plan_expired' is the other near miss, and confusing the two would be worse
-- because the platform's own answer differs: a lapsed plan needs a renewal and
-- stops automatic checking only, while an empty wallet stops manual search as
-- well. The owner separates them explicitly - "plan can stop auto searching
-- only ... credit khatam = no search AND auto track" - so the row has to be
-- able to say which of the two happened.
--
-- ---------------------------------------------------------------------------
-- 3 · WHY THE WORKER PAUSES AND THIS FILE DOES NOT
--
-- No sweep, no trigger and no function here switches a truck off. The pause is
-- written by src/lib/tracking.ts, in the branch that reads the refusal, for one
-- reason: affordability is spend_credits()'s answer and nothing else's. The
-- cost of a check is credit_rates.units_per_credit, which an admin edits on the
-- rate screen without a deploy, and it may be fractional or zero (zero still
-- means "included in the plan": allowed, charged nothing, no ledger row). A
-- second place computing "can this account afford a check" would be a second
-- answer free to disagree with the one that actually charges - and the
-- disagreement would show up as trucks paused while their balance was fine.
--
-- So this migration only widens the vocabulary the row is allowed to use.
--
-- Widened rather than replaced, like 0027 and 0041 before it: every value
-- already stored stays legal, so no truck that is paused today loses the
-- explanation for why.
--
-- Run after 0043.
-- ===========================================================================

alter table public.tracked_trucks
  drop constraint if exists tracked_trucks_paused_reason_known;
alter table public.tracked_trucks
  add constraint tracked_trucks_paused_reason_known
  check (
    paused_reason is null
    or paused_reason = any (array[
      'manual', 'repeated_failures', 'account_suspended',
      'schedule', 'inactive', 'plan_expired', 'no_credits'
    ])
  );

-- The comment has been a reason behind since 0038: it never learned
-- 'plan_expired', so the schema's own description of this column has been
-- wrong for two releases. Restated in full rather than appended to, because
-- the next person to widen the constraint will read this line and not the
-- three migrations that built it.
comment on column public.tracked_trucks.paused_reason is
  'Why is_active went false. manual: the officer pressed pause. repeated_failures: the toll portal could not answer for this number enough times in a row. account_suspended: the whole account is off. schedule: its auto-pause time arrived. inactive: no crossing for long enough. plan_expired: the plan ended and the grace period ran out. no_credits: the balance could not cover a check, so every live truck on the account was paused - written by the worker when spend_credits() refuses with out_of_credits. Null while it is running.';

-- ---------------------------------------------------------------------------
-- 4 · Nothing else changes, and the near misses are worth naming
-- ---------------------------------------------------------------------------
-- NO INDEX. The worker pauses by account - update ... where user_id = $1 and
-- is_active - and tracked_trucks_user_idx already covers that. A partial index
-- on paused_reason would serve no query that exists: every screen reads the
-- reason off a row it already has.
--
-- NO CHANGE TO spend_credits(). It stays a pure wallet gate. Pausing trucks
-- inside it would mean a customer's manual search could switch their fleet off
-- - the same function serves both callers - and the wallet has no business
-- knowing what a tracked truck is. Which also means this file recreates no
-- security-definer function, so there is no privilege sweep to redo here.
--
-- NO BACKFILL. There is no truck anywhere whose current pause was caused by an
-- empty balance, because until this release an empty balance did not pause
-- anything - it left the truck live. Guessing a reason onto rows that were
-- paused for something else would be inventing history.
