-- ===========================================================================
-- One ledger. One rollup. One place credits are explained.
--
-- Credits were reported from three different shapes and two of them disagreed
-- with what a reader wanted to know:
--
--   credit_activity  rolled spends up per day per REASON and threw the truck
--                    away, so "which lorry ate my balance" was unanswerable.
--                    Read by the plan page AND the admin's officer tab, which
--                    is the same list rendered twice from one lossy view.
--   my_activity      unioned search_logs with credit_transactions. search_logs
--                    is written only when a check finds new crossings, so that
--                    feed showed 16 rows against 90 charges - it could never
--                    reconcile to a balance, which is the one thing it was
--                    opened to do.
--
-- This replaces both with a single view at the finest grain worth storing:
-- one row per account, per IST day, per reason, per truck. Everything the
-- product needs is a projection of it -
--
--   per truck per day   the rows as they stand
--   per day             sum the rows for a date
--   every single charge  credit_transactions itself, which already holds
--                        exactly one row per chargeable action
--
-- so there is no second aggregate to drift, and no summary that can disagree
-- with the ledger it came from. Money is still only ever written by
-- spend_credits() and grant_credits(); nothing here computes a cost.
--
-- IST throughout, because a day means a day in the office, and a 05:00 UTC
-- boundary would split one working day across two rows.
--
-- Run after 0018_signup_phone_and_free_tier.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The one rollup
-- ---------------------------------------------------------------------------
drop view if exists public.credit_ledger_daily;
create view public.credit_ledger_daily with (security_invoker = on) as
select
  c.user_id,
  (c.created_at at time zone 'Asia/Kolkata')::date as ist_date,
  c.reason,
  c.truck_number,
  count(*)::bigint                                  as entries,
  -- Signed, exactly as stored: negative spends, positive grants. Summing a
  -- mixed day therefore gives the net movement without a second rule about
  -- which way round each reason goes.
  sum(c.delta)                                      as credits,
  min(c.created_at)                                 as first_at,
  max(c.created_at)                                 as last_at,
  -- The balance after that group's last movement, which is the figure a reader
  -- reconciles against.
  (array_agg(c.balance_after order by c.id desc))[1] as balance_after
from public.credit_transactions c
group by
  c.user_id,
  (c.created_at at time zone 'Asia/Kolkata')::date,
  c.reason,
  c.truck_number;

comment on view public.credit_ledger_daily is
  'The single credit rollup: one row per account, per IST day, per reason, per truck. Per-day figures are a sum of these rows; individual charges are credit_transactions. security_invoker, so RLS keeps each account to its own rows.';

-- The view groups by (user, IST day) and the screens always filter by user and
-- order by day, so give it exactly that.
create index if not exists credit_transactions_user_day_idx
  on public.credit_transactions (user_id, created_at desc);

-- Drilling into one day of one truck is the commonest click on the new screen.
create index if not exists credit_transactions_user_truck_idx
  on public.credit_transactions (user_id, truck_number, created_at desc)
  where truck_number is not null;

-- ---------------------------------------------------------------------------
-- 2. The two views this replaces
--
-- Dropped rather than left in place. A view nobody reads is a view that quietly
-- rots until somebody trusts it - and the whole point of this migration is that
-- there is one answer to "how many credits went where", not three.
-- ---------------------------------------------------------------------------
drop view if exists public.credit_activity;
drop view if exists public.my_activity;
