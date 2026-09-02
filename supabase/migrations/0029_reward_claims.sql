-- ===========================================================================
-- What the rewards actually paid out, one row per claim.
--
-- The console could list the CODES and it could count them, but it could not
-- answer "who used TOPUP500, and what did they get". Two reasons, and the
-- second one is the interesting one.
--
-- First, the plumbing: the coupon and referral screens moved to /admin/rewards
-- while every link they generate still pointed at /admin/plans, which no longer
-- has those tabs - so the "who used this code" button landed on the price list
-- with nothing selected. That is fixed in the app, not here.
--
-- Second, and this is what these views exist for: the redemption table speaks
-- only in rupees. It records amount_inr and discount_inr, which is the whole
-- story for a percent or amount-off code and NOTHING AT ALL for a credit_bonus
-- code. TOPUP500 grants 500 credits and takes nothing off the price, so its one
-- real claim rendered as "order Rs 0, came off Rs 0" - a code that had paid out
-- 500 credits looked like a code that had done nothing. The reward has to be
-- reported in the unit it was actually paid in.
--
-- Where the bonus figure comes from, and why not the ledger: the grant does
-- leave a credit_transactions row, but the only things tying it back to the
-- claim are a matching user, a matching instant and the text "Coupon TOPUP500"
-- in a note. Joining on any of that is guesswork that breaks the first time two
-- codes are claimed in the same second. The coupon's own definition is exact:
-- for kind = 'credit_bonus' the credits granted ARE coupons.value, by
-- construction in redeem_coupon(). So it is read from there, and only for a
-- claim that actually settled - a reserved or released claim granted nothing.
--
-- Views rather than functions: there is no dynamic grouping here, the row
-- counts are small (one per claim, ever), and a view can be ordered, filtered
-- and paged by PostgREST directly, which is what the screens need.
--
-- Dropped and recreated rather than `create or replace`: a replace refuses any
-- change to the column list, and these will grow columns.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Every coupon claim, with the account that made it and the reward it paid
-- ---------------------------------------------------------------------------
drop view if exists public.coupon_claim_detail;

create view public.coupon_claim_detail
with (security_invoker = true)
as
select
  r.id,
  r.coupon_id,
  c.code,
  c.kind,
  c.value            as coupon_value,
  c.applies_to,
  r.user_id,
  coalesce(p.full_name, p.email) as account,
  p.email,
  p.phone,
  r.payment_id,
  r.status,
  r.amount_inr,
  r.discount_inr,
  /*
   * The reward in the unit it was paid in.
   *
   * A percent or amount-off code pays in rupees and is already in
   * discount_inr; a credit_bonus code pays in credits and appears nowhere on
   * the redemption row at all. Only a settled claim counts: 'reserved' is a
   * checkout still in flight and 'released' is one that was abandoned, and
   * neither handed anything over.
   */
  case
    when c.kind = 'credit_bonus' and r.status = 'applied' then c.value
    else 0
  end::numeric as bonus_credits,
  /* True where the whole point of the code is invisible in discount_inr, so a
     screen can pick the right column to lead with instead of guessing. */
  (c.kind = 'credit_bonus') as pays_in_credits,
  r.created_at,
  r.settled_at
from public.coupon_redemptions r
join public.coupons c on c.id = r.coupon_id
/*
 * LEFT, deliberately. An inner join would make a claim vanish if its profile
 * were ever removed, and a reward that was paid out must not disappear from the
 * record because the account did - that is exactly the row an admin is looking
 * for when they ask where the credits went. The account column goes null and
 * the screen shows the raw id.
 */
left join public.profiles p on p.id = r.user_id;

comment on view public.coupon_claim_detail is
  'One row per coupon claim, with the account and the reward in the unit it was paid in - rupees off for a discount code, credits for a credit_bonus code.';

-- ---------------------------------------------------------------------------
-- Every referral, with both sides named
-- ---------------------------------------------------------------------------
drop view if exists public.referral_claim_detail;

create view public.referral_claim_detail
with (security_invoker = true)
as
select
  r.id,
  r.referrer_id,
  coalesce(rp.full_name, rp.email) as referrer,
  rp.email                         as referrer_email,
  r.referred_id,
  coalesce(dp.full_name, dp.email) as invitee,
  dp.email                         as invitee_email,
  r.status,
  r.reward_credits,
  r.first_amount,
  /*
   * How long the invitee took to pay. The number that says whether referrals
   * bring buyers or browsers: a pile of 'pending' rows months old is a
   * different problem from a pile a day old.
   */
  case
    when r.rewarded_at is not null
      then extract(epoch from (r.rewarded_at - r.created_at)) / 86400.0
    else null
  end::numeric as days_to_reward,
  r.created_at,
  r.rewarded_at
from public.referrals r
left join public.profiles rp on rp.id = r.referrer_id
left join public.profiles dp on dp.id = r.referred_id;

comment on view public.referral_claim_detail is
  'One row per referral, both sides named, with how many days the invitee took to pay.';

-- ---------------------------------------------------------------------------
-- Who may read them
-- ---------------------------------------------------------------------------
-- security_invoker means these run as the caller, so the underlying tables'
-- own RLS still applies and a view cannot be used to read round it. The
-- explicit revoke is here because Supabase grants anon and authenticated a
-- default select on anything new in public, and PUBLIC is not those roles - a
-- `revoke from public` alone would leave both grants standing, which is the
-- hole 0025 had to sweep up across every function in the schema.
do $blk$
declare
  v text;
begin
  foreach v in array array['public.coupon_claim_detail', 'public.referral_claim_detail'] loop
    execute format('revoke all on %s from public', v);
    execute format('revoke all on %s from anon, authenticated', v);
    execute format('grant select on %s to service_role', v);
  end loop;
end $blk$;

-- The claims screens read newest-first, and filter to one code or one account.
create index if not exists coupon_redemptions_created_idx
  on public.coupon_redemptions (created_at desc);
create index if not exists coupon_redemptions_user_idx
  on public.coupon_redemptions (user_id);
create index if not exists referrals_created_idx
  on public.referrals (created_at desc);
