-- ===========================================================================
-- SECURITY: a credit code could buy any plan for one rupee.
--
-- validate_coupon() worked out the discount like this:
--
--     if c.kind = 'flat' then
--       v_discount := c.value;
--     else
--       v_discount := round(p_amount * c.value / 100, 2);   -- a percentage
--     end if;
--
-- Two branches for three kinds. 'percent' and 'flat' were meant; 'credit_bonus'
-- arrived in 0022 and fell into the else, so its value was read as a
-- PERCENTAGE. And the guard that was supposed to stop a value above 100 reads
--
--     check (kind <> 'percent' or value <= 100)
--
-- which exempts credit_bonus by design, because 500 free credits is a perfectly
-- ordinary thing for a bonus code to be worth.
--
-- Put together: TOPUP500, kind credit_bonus, value 500, became a 500% discount,
-- clamped by the floor below to "amount minus one rupee". Confirmed against the
-- live database before writing this - validate_coupon('TOPUP500', user, 12000,
-- 'plan') returned ok true, discount 11999, payable 1. Any signed-in customer
-- who knew a bonus code - and bonus codes are handed out publicly, that is what
-- they are for - could buy the 12,000-rupee plan for one rupee and receive
-- every credit that came with it.
--
-- Not only the preview: reserve_coupon() re-validates through this same
-- function and takes its discount from it, so the order the server actually
-- opened was for one rupee too. The browser was never the weak point.
--
-- Checked for damage before fixing: three payments exist in total, two settled,
-- two rupees between them, and the single discounted row is a legitimate 50%
-- ADD50 test on a two-rupee order. The hole was never used.
--
-- THE FIX, in two parts.
--
-- 1. A credit code is refused at a checkout, in words that say where it does
--    belong. It is not a discount and never was: settle_payment() grants its
--    credits and takes nothing off the price, so even with sane arithmetic the
--    honest answer here is "wrong place", not "zero off".
--
-- 2. The branch is made exhaustive. Every kind now names the path it takes and
--    an unrecognised kind is refused outright, so the next kind added to this
--    table cannot silently inherit the percentage branch the way credit_bonus
--    did. That is the actual bug - a two-way branch over an open set - and
--    part 1 alone would leave it waiting for the next arrival.
-- ===========================================================================

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

  /*
   * A credit code is not a discount, and this is the check that matters.
   *
   * It sits here - before is_active, before the claim limits, before any
   * arithmetic - because everything below it is about whether a DISCOUNT
   * applies, and the answer for a credit code is that the question is wrong.
   * Refusing early also means a switched-off bonus code gives the same helpful
   * answer as a live one rather than "no longer available", which would send
   * somebody hunting for a replacement code they do not need.
   */
  if c.kind = 'credit_bonus' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind',
      'code', c.code,
      'kind', c.kind,
      'message', 'That is a credit code, not a discount. Enter it under "Have a credit code?" to collect the credits.');
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

  /*
   * Exhaustive, with no else that means "percentage".
   *
   * The original was `if flat then value else percentage`, and an open set of
   * kinds behind a two-way branch is what turned 500 credits into 500%. Each
   * kind now states its own arithmetic and anything unrecognised is refused, so
   * a kind added to coupons_kind_check without a branch here fails safe -
   * nobody gets a discount - instead of failing open.
   */
  if c.kind = 'percent' then
    v_discount := round(coalesce(p_amount, 0) * c.value / 100, 2);
    if c.max_discount_inr is not null then
      v_discount := least(v_discount, c.max_discount_inr);
    end if;

  elsif c.kind = 'flat' then
    v_discount := c.value;

  else
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind',
      'kind', c.kind,
      'message', 'That code cannot be used here.');
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

comment on function public.validate_coupon(text, uuid, numeric, text) is
  'Whether a DISCOUNT code applies to an amount, and for how much. Refuses credit_bonus codes: those grant credits and belong to redeem_credit_coupon, not to a checkout.';

-- The same revoke sweep 0025 applies to every security-definer function.
-- Recreating one resets its privileges to the schema default, and Supabase's
-- default hands anon and authenticated an execute grant - so leaving this out
-- would reopen the hole 0025 closed, on the very function this file exists to
-- secure.
revoke all on function public.validate_coupon(text, uuid, numeric, text) from public;
revoke all on function public.validate_coupon(text, uuid, numeric, text) from anon, authenticated;
grant execute on function public.validate_coupon(text, uuid, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- Belt and braces on the data as well as the code
-- ---------------------------------------------------------------------------
-- The old constraint only capped 'percent'. Now that the function refuses to
-- treat anything else as a percentage this is no longer load-bearing, but a
-- flat discount larger than any plan is still nonsense worth refusing at write
-- time, and a negative value of any kind certainly is.
alter table public.coupons
  drop constraint if exists coupons_percent_range;

alter table public.coupons
  add constraint coupons_percent_range
  check (kind <> 'percent' or (value >= 0 and value <= 100));

alter table public.coupons
  drop constraint if exists coupons_value_positive;

alter table public.coupons
  add constraint coupons_value_positive
  check (value >= 0);
