-- ===========================================================================
-- Coupon codes.
--
-- A coupon reduces what someone PAYS. It never reduces what they GET - the
-- credits for a pack, or for an amount on the open tier, are worked out from
-- the price before the discount. That is what a discount means to a buyer: the
-- same goods for less money. Computing credits from the discounted amount
-- would quietly sell them less than the code advertised.
--
-- Shapes supported, because these are the ones people actually write:
--
--   percent  20% off, optionally capped - "20% off, up to 200 rupees"
--   flat     200 rupees off
--
-- with a minimum spend, a total claim limit, and a per-person limit.
--
-- THE HARD PART is not the arithmetic, it is counting claims honestly. An
-- order is created before the money arrives and may never be paid, so a claim
-- is RESERVED when the order opens and only APPLIED when the payment settles.
-- Without the reservation, two people could spend the last claim on a
-- single-use code at the same moment. Without the release, an abandoned
-- checkout would burn that code for ever.
--
-- Run after 0014_referrals.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The coupon
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  id               uuid primary key default gen_random_uuid(),
  -- Stored upper case, and every lookup upper-cases too, so "save20" and
  -- "SAVE20" are one code and nobody is told their code is wrong over a
  -- shift key.
  code             text not null unique,
  description      text,
  -- percent | flat
  kind             text not null default 'percent',
  value            numeric(10, 2) not null check (value > 0),
  -- The "up to" cap. Only meaningful on a percentage; null means uncapped.
  max_discount_inr numeric(10, 2) check (max_discount_inr is null or max_discount_inr > 0),
  min_spend_inr    numeric(10, 2) not null default 0 check (min_spend_inr >= 0),
  -- How many claims in total, across everyone. Null is unlimited.
  max_claims       integer check (max_claims is null or max_claims > 0),
  -- How many times one person may use it.
  max_per_user     integer not null default 1 check (max_per_user > 0),
  -- all | credits | plan
  applies_to       text not null default 'all',
  starts_at        timestamptz,
  expires_at       timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint coupons_kind_check check (kind in ('percent', 'flat')),
  constraint coupons_applies_to_check check (applies_to in ('all', 'credits', 'plan')),
  -- A percentage over 100 would pay the buyer to shop.
  constraint coupons_percent_range check (kind <> 'percent' or value <= 100)
);

create index if not exists coupons_active_idx on public.coupons (is_active, code);

comment on table public.coupons is
  'Discount codes. A coupon reduces what is paid, never the credits received - those come from the price before the discount.';

-- ---------------------------------------------------------------------------
-- 2. Who claimed what
--
--   reserved  an order is open, nothing paid yet
--   applied   the payment settled; the claim is spent
--   released  the order failed or was abandoned; the claim is given back
--
-- Claims are counted as reserved + applied, so a reservation genuinely holds
-- the last use of a single-use code while checkout is in flight.
-- ---------------------------------------------------------------------------
create table if not exists public.coupon_redemptions (
  id           uuid primary key default gen_random_uuid(),
  coupon_id    uuid not null references public.coupons (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  payment_id   uuid references public.payments (id) on delete cascade,
  status       text not null default 'reserved',
  amount_inr   numeric(10, 2) not null,
  discount_inr numeric(10, 2) not null,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz,
  constraint coupon_redemptions_status_check
    check (status in ('reserved', 'applied', 'released'))
);

create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id, status);
create index if not exists coupon_redemptions_user_idx
  on public.coupon_redemptions (user_id, coupon_id, status);

-- One reservation per payment. Without this a retried order could hold two.
create unique index if not exists coupon_redemptions_payment_key
  on public.coupon_redemptions (payment_id) where payment_id is not null;

-- ---------------------------------------------------------------------------
-- 3. What the payment recorded
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists coupon_id    uuid references public.coupons (id) on delete set null,
  add column if not exists discount_inr numeric(10, 2) not null default 0;

comment on column public.payments.amount_inr is
  'What was actually charged, after any discount. amount_inr + discount_inr is the list price.';

-- ---------------------------------------------------------------------------
-- 4. release_stale_coupon_holds - give back abandoned reservations
--
-- Razorpay usually sends payment.failed, but a closed tab may send nothing at
-- all, and a reservation nobody releases keeps a single-use code locked for
-- ever. Called at the top of validate_coupon so it needs no scheduled job: the
-- next person to type a code cleans up after the last one who did not pay.
-- ---------------------------------------------------------------------------
create or replace function public.release_stale_coupon_holds(p_minutes integer default 30)
returns integer
language sql
security definer
set search_path = public
as $fn$
  with gone as (
    update public.coupon_redemptions r
    set status = 'released', settled_at = now()
    where r.status = 'reserved'
      and r.created_at < now() - make_interval(mins => greatest(coalesce(p_minutes, 30), 1))
      and (
        r.payment_id is null
        or exists (
          select 1 from public.payments p
          where p.id = r.payment_id and p.status <> 'paid'
        )
      )
    returning 1
  ) select count(*)::int from gone;
$fn$;

revoke all on function public.release_stale_coupon_holds(integer) from public;
-- Granted to service_role only. An earlier version of this line also named
-- `authenticated`, on the assumption that the browser would call this directly.
-- It never has - every .rpc() in this codebase goes through the server-side
-- service client - so the grant only widened the attack surface, and
-- 0025_security_hardening.sql revoked it again on every run. Removed here so
-- the file says what is actually intended.
grant execute on function public.release_stale_coupon_holds(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. validate_coupon - the single authority on a code
--
-- Used by the buyer's preview and again by checkout before charging, so the
-- number quoted and the number charged cannot disagree. Returns a verdict
-- rather than raising: "this code has expired" is an ordinary answer, not an
-- error, and the caller has to show it either way.
--
-- p_amount is the LIST price, before any discount.
-- ---------------------------------------------------------------------------
create or replace function public.validate_coupon(
  p_code   text,
  p_user   uuid,
  p_amount numeric,
  p_kind   text default 'credits'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c          public.coupons;
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_claims   integer;
  v_mine     integer;
  v_discount numeric(10, 2);
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty',
      'message', 'Enter a code.');
  end if;

  -- Hand back anything abandoned before counting, or a single-use code stays
  -- locked by whoever last opened a checkout and walked away.
  perform public.release_stale_coupon_holds(30);

  select * into c from public.coupons where code = v_code;

  if c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown',
      'message', 'That code is not recognised.');
  end if;

  if not c.is_active then
    return jsonb_build_object('ok', false, 'reason', 'inactive',
      'message', 'That code is no longer available.');
  end if;

  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'not_started',
      'message', 'That code cannot be used yet.');
  end if;

  if c.expires_at is not null and now() > c.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'expired',
      'message', 'That code has expired.');
  end if;

  if c.applies_to <> 'all' and c.applies_to <> coalesce(p_kind, 'credits') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind',
      'message', case c.applies_to
        when 'credits' then 'That code only applies to credit top-ups.'
        else 'That code only applies to a plan.' end);
  end if;

  if coalesce(p_amount, 0) < c.min_spend_inr then
    return jsonb_build_object('ok', false, 'reason', 'min_spend',
      'min_spend_inr', c.min_spend_inr,
      'message', format('That code needs a spend of at least %s rupees.',
                        trim(to_char(c.min_spend_inr, 'FM999999990.00'))));
  end if;

  if c.max_claims is not null then
    select count(*) into v_claims
    from public.coupon_redemptions
    where coupon_id = c.id and status in ('reserved', 'applied');

    if v_claims >= c.max_claims then
      return jsonb_build_object('ok', false, 'reason', 'exhausted',
        'message', 'That code has been fully claimed.');
    end if;
  end if;

  select count(*) into v_mine
  from public.coupon_redemptions
  where coupon_id = c.id and user_id = p_user and status in ('reserved', 'applied');

  if v_mine >= c.max_per_user then
    return jsonb_build_object('ok', false, 'reason', 'already_used',
      'message', case when c.max_per_user = 1
        then 'You have already used that code.'
        else format('You have already used that code %s times.', v_mine) end);
  end if;

  if c.kind = 'flat' then
    v_discount := c.value;
  else
    v_discount := round(coalesce(p_amount, 0) * c.value / 100, 2);
    if c.max_discount_inr is not null then
      v_discount := least(v_discount, c.max_discount_inr);
    end if;
  end if;

  -- Never discount below one rupee payable: Razorpay will not take a zero
  -- order, and a free order should be an admin credit grant, not a coupon.
  v_discount := least(v_discount, greatest(coalesce(p_amount, 0) - 1, 0));

  if v_discount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_discount',
      'message', 'That code takes nothing off this amount.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'coupon_id', c.id,
    'code', c.code,
    'kind', c.kind,
    'discount_inr', v_discount,
    'payable_inr', round(coalesce(p_amount, 0) - v_discount, 2),
    'message', format('%s rupees off.', trim(to_char(v_discount, 'FM999999990.00'))));
end $fn$;

revoke all on function public.validate_coupon(text, uuid, numeric, text) from public;
-- Granted to service_role only. An earlier version of this line also named
-- `authenticated`, on the assumption that the browser would call this directly.
-- It never has - every .rpc() in this codebase goes through the server-side
-- service client - so the grant only widened the attack surface, and
-- 0025_security_hardening.sql revoked it again on every run. Removed here so
-- the file says what is actually intended.
grant execute on function public.validate_coupon(text, uuid, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. reserve_coupon - hold the claim while checkout is in flight
--
-- Re-validates rather than trusting the caller. The caller has already asked,
-- but between the asking and the reserving someone else may have taken the
-- last claim, and this is the moment that has to be right.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_coupon(
  p_code    text,
  p_user    uuid,
  p_payment uuid,
  p_amount  numeric,
  p_kind    text default 'credits'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v jsonb;
begin
  v := public.validate_coupon(p_code, p_user, p_amount, p_kind);
  if not (v ->> 'ok')::boolean then return v; end if;

  insert into public.coupon_redemptions
    (coupon_id, user_id, payment_id, status, amount_inr, discount_inr)
  values (
    (v ->> 'coupon_id')::uuid, p_user, p_payment, 'reserved',
    p_amount, (v ->> 'discount_inr')::numeric);

  return v;
end $fn$;

revoke all on function public.reserve_coupon(text, uuid, uuid, numeric, text) from public;
grant execute on function public.reserve_coupon(text, uuid, uuid, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. settle_coupon - spend the claim, or give it back
-- ---------------------------------------------------------------------------
create or replace function public.settle_coupon(
  p_payment uuid,
  p_paid    boolean
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.coupon_redemptions
  set status = case when p_paid then 'applied' else 'released' end,
      settled_at = now()
  where payment_id = p_payment and status = 'reserved';
$fn$;

revoke all on function public.settle_coupon(uuid, boolean) from public;
grant execute on function public.settle_coupon(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 8. settle_payment learns about coupons
--
-- The claim is spent inside the same call that hands over the goods, so a
-- payment cannot succeed while its coupon is still only reserved.
-- ---------------------------------------------------------------------------
create or replace function public.settle_payment(
  p_order_id   text,
  p_payment_id text
)
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
begin
  update public.payments
  set status = 'paid',
      razorpay_payment_id = p_payment_id,
      paid_at = now()
  where razorpay_order_id = p_order_id
    and status = 'created'
  returning id, user_id, credits, amount_inr, kind, plan_id, months
  into v_id, v_user, v_credits, v_amount, v_kind, v_plan, v_months;

  if v_user is null then
    return jsonb_build_object('ok', true, 'granted', false, 'reason', 'not_pending');
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
      perform public.grant_credits(
        v_user, v_plan_credits, 'plan_grant', null,
        format('Included with the plan, order %s', p_order_id));
    end if;
  else
    perform public.grant_credits(
      v_user, v_credits, 'purchase', null,
      format('Paid %s rupees, order %s', v_amount, p_order_id));
  end if;

  -- Whichever it was, this is money in - so it can be someone's first payment.
  v_referral := public.reward_referral(v_user, v_amount);

  return jsonb_build_object(
    'ok', true, 'granted', true, 'kind', coalesce(v_kind, 'credits'),
    'credits', case when v_kind = 'plan' then coalesce(v_plan_credits, 0) else v_credits end,
    'user_id', v_user,
    'referral', v_referral);
end $fn$;

revoke all on function public.settle_payment(text, text) from public;
grant execute on function public.settle_payment(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. How a coupon is doing, for the admin
-- ---------------------------------------------------------------------------
drop view if exists public.coupon_usage;
create view public.coupon_usage with (security_invoker = on) as
select
  c.id,
  c.code,
  c.description,
  c.kind,
  c.value,
  c.max_discount_inr,
  c.min_spend_inr,
  c.max_claims,
  c.max_per_user,
  c.applies_to,
  c.starts_at,
  c.expires_at,
  c.is_active,
  c.created_at,
  count(r.id) filter (where r.status = 'applied')  as used,
  count(r.id) filter (where r.status = 'reserved') as holding,
  coalesce(sum(r.discount_inr) filter (where r.status = 'applied'), 0) as discount_given,
  coalesce(sum(r.amount_inr)   filter (where r.status = 'applied'), 0) as list_total,
  case
    when c.max_claims is null then null
    else greatest(
      c.max_claims - count(r.id) filter (where r.status in ('reserved', 'applied')), 0)
  end as claims_left
from public.coupons c
left join public.coupon_redemptions r on r.coupon_id = c.id
group by c.id;

-- ---------------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------------
alter table public.coupons            enable row level security;
alter table public.coupon_redemptions enable row level security;

-- Deliberately NOT readable by customers. The codes are the promotion, and a
-- list of every live code is not something to hand out - they are checked one
-- at a time through validate_coupon, which is security definer.
drop policy if exists coupons_admin on public.coupons;
create policy coupons_admin on public.coupons for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists coupon_redemptions_read on public.coupon_redemptions;
create policy coupon_redemptions_read on public.coupon_redemptions for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

do $blk$
begin
  execute 'drop trigger if exists touch_coupons on public.coupons';
  execute 'create trigger touch_coupons before update on public.coupons '
          'for each row execute function public.touch_updated_at()';
end $blk$;
