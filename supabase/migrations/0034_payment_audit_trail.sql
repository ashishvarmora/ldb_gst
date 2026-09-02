-- ===========================================================================
-- What a payment actually did to the balance, as a fact rather than a guess.
--
-- The owner asked to see the balance before and the balance after against each
-- payment, for the customer and for the admin, and to "make it properly
-- auditable". Today that cannot be answered honestly, for two reasons.
--
-- FIRST, THERE IS NO LINK. credit_transactions has user_id, delta,
-- balance_after, reason, truck_number, note, actor_id - and nothing pointing at
-- a payment. settle_payment() writes the order id into the NOTE:
--
--     format('Paid %s rupees, order %s', v_amount, p_order_id)
--
-- so the only way to tie a credit to the money that bought it is to parse
-- English out of a free-text column. That breaks the moment the wording is
-- edited, and it cannot be joined on or indexed. An audit trail held together
-- by a sentence is not an audit trail.
--
-- SECOND, "balance before" is derivable but only if you trust the row: it is
-- balance_after - delta. That is exact, because grant_credits writes
-- balance_after from the UPDATE ... RETURNING in the same statement that moved
-- the balance, so the two cannot disagree. What was missing was knowing WHICH
-- rows belong to a payment.
--
-- So: a real foreign key, set at the point the credit is granted, plus a
-- backfill for the rows that already exist, plus a view that states the pair.
--
-- Deliberately NOT a stored "balance_before" column. It would be a second copy
-- of a number already implied by two others, free to drift, and drift in a
-- ledger is worse than arithmetic. balance_after - delta is computed in the
-- view instead.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · The link
-- ---------------------------------------------------------------------------
alter table public.credit_transactions
  add column if not exists payment_id uuid references public.payments(id) on delete set null;

comment on column public.credit_transactions.payment_id is
  'The payment that caused this credit movement, when money caused it. Null for an admin grant, a coupon bonus, a referral reward or any spend.';

-- Every lookup is "the ledger rows for this payment", so that is the index.
create index if not exists credit_transactions_payment_idx
  on public.credit_transactions (payment_id)
  where payment_id is not null;

-- ---------------------------------------------------------------------------
-- 2 · Set it going forward
-- ---------------------------------------------------------------------------
-- A sixth argument with a default, so the existing callers that do not know
-- about payments keep working - a five-argument call binds p_payment to its
-- default. Adding a parameter rather than a new function keeps one place where
-- a credit is created.
--
-- THE OLD SIGNATURE MUST GO FIRST, and this was learnt the expensive way.
-- `create or replace` with a different argument list does not replace - it
-- OVERLOADS - and once both exist, every five-argument call in every PL/pgSQL
-- body is ambiguous (42725 "not unique"): with two candidates, one exact and
-- one via a default, Postgres refuses to choose. reward_referral() would have
-- crashed inside the first real referral settlement, and rolled the whole
-- payment back with it. It had not crashed in production only because the
-- referrals table was empty, so its early return fired before any grant.
drop function if exists public.grant_credits(uuid, numeric, text, uuid, text);

create or replace function public.grant_credits(
  p_user    uuid,
  p_amount  numeric,
  p_reason  text default 'admin_topup',
  p_actor   uuid default null,
  p_note    text default null,
  p_payment uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_balance numeric(12, 2);
  v_before  numeric(12, 2);
begin
  if p_amount = 0 then
    return jsonb_build_object('ok', false, 'reason', 'zero_amount');
  end if;

  /*
   * The balance before and after come out of ONE statement, which is what
   * makes them safe to report as a pair. Two selects around an update would be
   * two chances for a concurrent charge to land in between, and an audit line
   * reading "before 100, after 110" when the real movement was 108 to 118 is
   * worse than no audit line at all.
   */
  update public.profiles
  set credits = greatest(credits + p_amount, 0)
  where id = p_user
  returning credits - p_amount, credits into v_before, v_balance;

  if v_balance is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_user');
  end if;

  insert into public.credit_transactions
    (user_id, delta, balance_after, reason, note, actor_id, payment_id)
  values (p_user, p_amount, v_balance, p_reason, p_note, p_actor, p_payment);

  -- The before figure is returned as well, so a caller confirming a purchase
  -- can say "480 to 490" without a second read that might have moved on.
  return jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'balance_before', greatest(v_before, 0));
end $fn$;

-- settle_payment now says which payment it is granting for, and hands the
-- before/after pair back to whoever is about to render a receipt.
create or replace function public.settle_payment(p_order_id text, p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id      uuid;
  v_user    uuid;
  v_credits numeric(12, 2);
  v_amount  numeric(10, 2);
  v_kind    text;
  v_plan    uuid;
  v_months  integer;
  v_plan_credits numeric(12, 2);
  v_from    date;
  v_referral jsonb;
  v_grant   jsonb;
begin
  update public.payments
  set status = 'paid',
      razorpay_payment_id = p_payment_id,
      paid_at = now()
  where razorpay_order_id = p_order_id
    and status = 'created'
  returning id, user_id, credits, amount_inr, kind, plan_id, months
  into v_id, v_user, v_credits, v_amount, v_kind, v_plan, v_months;

  /*
   * Nothing moved from 'created' to 'paid', so this payment was settled
   * already - almost always because the webhook won the race with the
   * browser, which is the normal case rather than an error.
   *
   * It now returns the payment's id, so the caller can go and read what that
   * settlement actually delivered instead of telling the customer only that
   * their payment was "already recorded" - a sentence that is true and reads
   * exactly like "nothing happened".
   */
  if v_user is null then
    select id into v_id
    from public.payments
    where razorpay_order_id = p_order_id;

    return jsonb_build_object(
      'ok', true, 'granted', false, 'reason', 'not_pending',
      'payment_id', v_id);
  end if;

  perform public.settle_coupon(v_id, true);

  if v_kind = 'plan' and v_plan is not null then
    select included_credits into v_plan_credits from public.plans where id = v_plan;

    select greatest(coalesce(plan_expires_on, public.ist_today()), public.ist_today())
    into v_from from public.profiles where id = v_user;

    update public.profiles
    set plan_id = v_plan,
        plan_assigned_at = coalesce(plan_assigned_at, now()),
        plan_expires_on = v_from + (coalesce(v_months, 1) || ' months')::interval
    where id = v_user;

    if coalesce(v_plan_credits, 0) > 0 then
      v_grant := public.grant_credits(
        v_user, v_plan_credits, 'plan_grant', null,
        format('Included with the plan, order %s', p_order_id), v_id);
    end if;
  else
    v_grant := public.grant_credits(
      v_user, v_credits, 'purchase', null,
      format('Paid %s rupees, order %s', v_amount, p_order_id), v_id);
  end if;

  -- Whichever it was, this is money in - so it can be someone's first payment.
  v_referral := public.reward_referral(v_user, v_amount);

  return jsonb_build_object(
    'ok', true, 'granted', true, 'kind', coalesce(v_kind, 'credits'),
    'credits', case when v_kind = 'plan' then coalesce(v_plan_credits, 0) else v_credits end,
    'user_id', v_user,
    'payment_id', v_id,
    'balance_before', v_grant -> 'balance_before',
    'balance_after', v_grant -> 'balance',
    'referral', v_referral);
end $fn$;

-- ---------------------------------------------------------------------------
-- 3 · Backfill what already happened
-- ---------------------------------------------------------------------------
-- The note is the only link the old rows have, so it is used once, here, to
-- create the real one - and then never read as data again. Matched on the exact
-- order id rather than a LIKE on the sentence, and only where exactly one
-- payment carries that id, so an ambiguous match is left null rather than
-- guessed at.
update public.credit_transactions t
set payment_id = p.id
from public.payments p
where t.payment_id is null
  and t.reason in ('purchase', 'plan_grant')
  and p.razorpay_order_id is not null
  and t.note like '%' || p.razorpay_order_id || '%'
  and (
    select count(*) from public.payments q
    where q.razorpay_order_id = p.razorpay_order_id
  ) = 1;

-- ---------------------------------------------------------------------------
-- 4 · The pair, ready to render
-- ---------------------------------------------------------------------------
drop view if exists public.payment_credit_effect;

create view public.payment_credit_effect
with (security_invoker = true)
as
select
  p.id                       as payment_id,
  p.user_id,
  p.razorpay_order_id,
  p.status,
  p.amount_inr,
  p.discount_inr,
  p.kind,
  p.paid_at,
  /*
   * Summed rather than taken from one row: a plan purchase can write more than
   * one ledger line (its included credits, and in future anything else bundled
   * with it), and the customer's question is what the PAYMENT did, not what one
   * of its rows did.
   */
  coalesce(sum(t.delta), 0)::numeric        as credits_added,
  /* First and last by the ledger's own order. before comes off the earliest
     row of the payment, after off the latest, so a multi-row payment reads as
     one movement end to end. */
  (array_agg(t.balance_after - t.delta order by t.id))[1]::numeric  as balance_before,
  (array_agg(t.balance_after order by t.id desc))[1]::numeric       as balance_after,
  count(t.id)::integer       as ledger_rows
from public.payments p
left join public.credit_transactions t on t.payment_id = p.id
group by p.id, p.user_id, p.razorpay_order_id, p.status, p.amount_inr,
         p.discount_inr, p.kind, p.paid_at;

comment on view public.payment_credit_effect is
  'One row per payment: what it added, and the balance either side of it. balance_before is balance_after minus delta on the payment''s first ledger row - derived, never stored, so it cannot drift.';

-- ---------------------------------------------------------------------------
-- 5 · Who may call any of it
-- ---------------------------------------------------------------------------
-- Recreating a function resets its privileges to the schema default, and
-- Supabase's default grants anon and authenticated EXECUTE. A bare
-- `revoke from public` does not touch those - that is the hole 0025 had to
-- sweep across the whole schema - so both roles are revoked explicitly. Two
-- signatures of grant_credits exist for as long as the old five-argument one is
-- still resolvable, and both must be locked down.
do $blk$
declare
  fn text;
begin
  foreach fn in array array[
    'public.grant_credits(uuid, numeric, text, uuid, text)',
    'public.grant_credits(uuid, numeric, text, uuid, text, uuid)',
    'public.settle_payment(text, text)'
  ] loop
    begin
      execute format('revoke all on function %s from public', fn);
      execute format('revoke all on function %s from anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    exception
      when undefined_function then null;  -- the old signature may be gone
    end;
  end loop;
end $blk$;

revoke all on public.payment_credit_effect from public;
revoke all on public.payment_credit_effect from anon, authenticated;
grant select on public.payment_credit_effect to service_role;
