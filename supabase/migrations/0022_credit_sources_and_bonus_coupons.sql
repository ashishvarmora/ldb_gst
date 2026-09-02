-- ===========================================================================
-- Where every credit came from, and coupons that hand credits over.
--
-- Two things land together, both about the same question: an account holds X
-- credits - who paid for them?
--
-- 1. THE SOURCE OF A CREDIT. credit_transactions.reason already records what
--    happened, but nothing grouped those reasons into the three buckets the
--    owner actually reports on: money taken through the gateway, credits the
--    admin handed over directly, and credits given away free. Ten reasons and
--    counting is not a thing to re-classify by hand on every screen, so the
--    mapping becomes one function and every screen reads it.
--
--    Deliberately a function over the existing columns rather than a new
--    column. A stored source would need backfilling, would need every writer
--    updated, and could then disagree with the reason sitting beside it. This
--    cannot drift, because there is nothing to keep in step.
--
--    plan_grant is the awkward one: the same reason covers a plan somebody paid
--    for and a plan an admin assigned by hand. actor_id tells them apart - an
--    admin acting leaves their id on the row, an automatic grant does not.
--
-- 2. BONUS COUPONS. A coupon could only reduce a price. The owner wants the
--    other kind too: a code that is worth credits, entered on its own rather
--    than at a checkout, with no purchase involved. That is a different shape -
--    'value' stops meaning rupees-or-percent and starts meaning credits - so it
--    is a third kind rather than a flag on the existing two, and the checks
--    that only make sense for a discount are relaxed for it.
--
-- Run after 0021_truck_search_summary.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Which bucket a credit movement belongs to
-- ---------------------------------------------------------------------------
create or replace function public.credit_source(
  p_reason   text,
  p_delta    numeric,
  p_actor    uuid
)
returns text
language sql
immutable
parallel safe
as $fn$
  select case
    -- Spending is not a source. Kept as its own bucket so a caller can sum
    -- signed deltas without having to exclude it by name.
    when p_delta < 0 then 'spend'
    when p_reason = 'purchase' then 'paid'
    -- A plan an admin assigned versus one that followed a payment.
    when p_reason = 'plan_grant' and p_actor is not null then 'admin'
    when p_reason = 'plan_grant' then 'paid'
    when p_reason in ('admin_topup', 'admin_adjust') then 'admin'
    when p_reason in ('signup_bonus', 'coupon_bonus', 'referral', 'referral_milestone')
      then 'free'
    -- An unknown positive reason is called out rather than quietly counted as
    -- free, which would understate what has been given away.
    else 'other'
  end;
$fn$;

comment on function public.credit_source(text, numeric, uuid) is
  'The bucket a credit movement belongs to: paid | admin | free | spend | other. One mapping, read by every screen that reports on where credits came from.';

-- ---------------------------------------------------------------------------
-- 2. The one rollup gains the source
--
-- Same grain as 0019 - account, IST day, reason, truck - with the bucket
-- alongside. Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW
-- can only append columns, and `source` belongs beside `reason` rather than
-- tacked on after balance_after where nobody would look for it.
-- ---------------------------------------------------------------------------
drop view if exists public.credit_ledger_daily;

create view public.credit_ledger_daily with (security_invoker = on) as
select
  c.user_id,
  (c.created_at at time zone 'Asia/Kolkata')::date as ist_date,
  c.reason,
  public.credit_source(c.reason, c.delta, c.actor_id) as source,
  c.truck_number,
  count(*)::bigint                                   as entries,
  sum(c.delta)                                       as credits,
  min(c.created_at)                                  as first_at,
  max(c.created_at)                                  as last_at,
  (array_agg(c.balance_after order by c.id desc))[1] as balance_after
from public.credit_transactions c
group by
  c.user_id,
  (c.created_at at time zone 'Asia/Kolkata')::date,
  c.reason,
  public.credit_source(c.reason, c.delta, c.actor_id),
  c.truck_number;

comment on view public.credit_ledger_daily is
  'The single credit rollup: one row per account, per IST day, per reason, per truck, with the source bucket. Per-day figures are a sum of these rows; individual charges are credit_transactions. security_invoker, so RLS keeps each account to its own rows.';

-- ---------------------------------------------------------------------------
-- 3. Platform-wide totals by source, for the dashboard
--
-- Not security_invoker: this looks across every account, which is exactly what
-- row-level security would prevent, and only the console reads it.
-- ---------------------------------------------------------------------------
drop view if exists public.credit_source_totals;
create view public.credit_source_totals as
select
  public.credit_source(c.reason, c.delta, c.actor_id) as source,
  c.reason,
  count(*)::bigint     as entries,
  sum(c.delta)         as credits,
  count(distinct c.user_id)::bigint as accounts,
  min(c.created_at)    as first_at,
  max(c.created_at)    as last_at
from public.credit_transactions c
group by 1, 2;

comment on view public.credit_source_totals is
  'Every credit ever granted or spent, bucketed by source and reason, across all accounts. Read by the admin dashboard.';

revoke all on public.credit_source_totals from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Coupons that are worth credits rather than a discount
--
-- On a credit_bonus, `value` is a number of credits, not rupees and not a
-- percentage - which is why the percent ceiling and the minimum-spend and cap
-- columns stop applying. They are left nullable rather than removed so the two
-- discount kinds keep working untouched.
-- ---------------------------------------------------------------------------
alter table public.coupons drop constraint if exists coupons_kind_check;
alter table public.coupons
  add constraint coupons_kind_check check (kind in ('percent', 'flat', 'credit_bonus'));

-- The 100 ceiling is a percentage rule. A bonus of 500 credits is not a bug.
alter table public.coupons drop constraint if exists coupons_percent_range;
alter table public.coupons
  add constraint coupons_percent_range check (kind <> 'percent' or value <= 100);

-- A bonus is not attached to a purchase, so "what may it be spent on" and "how
-- much must be spent first" are meaningless for it. Enforced rather than
-- documented, so a half-filled admin form cannot create a coupon that behaves
-- unpredictably at redemption.
alter table public.coupons drop constraint if exists coupons_bonus_shape;
alter table public.coupons
  add constraint coupons_bonus_shape check (
    kind <> 'credit_bonus'
    or (min_spend_inr = 0 and max_discount_inr is null and applies_to = 'all')
  );

comment on column public.coupons.value is
  'percent: the percentage off. flat: rupees off. credit_bonus: how many credits the code is worth.';

-- ---------------------------------------------------------------------------
-- 5. Redeeming a bonus coupon
--
-- One function, because the check and the grant have to be one transaction: two
-- people entering the last claim of a code at the same moment must not both get
-- it, and a redemption row without its credits is worse than a refusal.
--
-- Returns the same {ok, ...} shape the other credit RPCs use, so the action
-- layer reads it the same way.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_bonus_coupon(
  p_user uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_coupon   public.coupons;
  v_claims   integer;
  v_mine     integer;
  v_balance  numeric;
begin
  if p_user is null or coalesce(btrim(p_code), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_code');
  end if;

  -- Locked, so the claim counts below cannot be read stale by a second caller.
  select * into v_coupon
  from public.coupons
  where code = upper(btrim(p_code))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_code');
  end if;
  if v_coupon.kind <> 'credit_bonus' then
    -- A discount code is not wrong, it is just used somewhere else. Saying so
    -- is the difference between "your code is invalid" and "use it at checkout".
    return jsonb_build_object('ok', false, 'reason', 'is_discount');
  end if;
  if not v_coupon.is_active then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;
  if v_coupon.expires_at is not null and now() > v_coupon.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- 'released' is a discount reservation that was abandoned at checkout. It
  -- never became a claim, so it must not count against the limit.
  select count(*) into v_claims
  from public.coupon_redemptions
  where coupon_id = v_coupon.id and status <> 'released';
  if v_coupon.max_claims is not null and v_claims >= v_coupon.max_claims then
    return jsonb_build_object('ok', false, 'reason', 'all_claimed');
  end if;

  select count(*) into v_mine
  from public.coupon_redemptions
  where coupon_id = v_coupon.id and user_id = p_user and status <> 'released';
  if v_mine >= v_coupon.max_per_user then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  -- The credits, through the same path every other grant takes, so the ledger
  -- row and the balance are written by one writer.
  perform public.grant_credits(
    p_user   => p_user,
    p_amount => v_coupon.value,
    p_reason => 'coupon_bonus',
    p_actor  => null,
    p_note   => 'Coupon ' || v_coupon.code
  );

  /*
   * amount_inr and discount_inr are both zero: nothing was bought and nothing
   * was discounted. status is 'applied' rather than the 'reserved' a checkout
   * starts with - a bonus is finished the moment it is claimed, and there is no
   * payment for it to be settled against.
   */
  insert into public.coupon_redemptions
    (coupon_id, user_id, payment_id, status, amount_inr, discount_inr, settled_at)
  values
    (v_coupon.id, p_user, null, 'applied', 0, 0, now());

  select credits into v_balance from public.profiles where id = p_user;

  return jsonb_build_object(
    'ok', true,
    'code', v_coupon.code,
    'credits', v_coupon.value,
    'balance', v_balance
  );
end $fn$;

revoke all on function public.redeem_bonus_coupon(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_bonus_coupon(uuid, text) to service_role;
