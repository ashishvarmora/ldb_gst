-- ===========================================================================
-- The invitee's half of a referral.
--
-- The owner's understanding was "new user gets extra X% credit and the
-- referrer Y%, based on the first payment" - and only half of that was true.
-- reward_referral() paid the REFERRER referral_percent of the invitee's first
-- settled payment, and paid the invitee nothing at all. The person the whole
-- scheme exists to win over was the one side of it with no incentive.
--
-- So: a second percentage, referral_invitee_percent, granted to the invitee
-- off the same first payment, in the same transaction, under its own ledger
-- reason so the giveaway reports can say which side of the scheme a credit
-- went to. Both percentages are settings, editable on the Referral terms
-- screen; either may be nought.
--
-- Seeded at 10 to match the referrer's side. That is a default to be edited,
-- not a recommendation baked in code - but it is a defensible one: the invitee
-- percentage is what converts the invited visitor into a payer, the referrer
-- percentage is what makes people share, and there is no reason at this size to
-- rank one motive above the other. At the credit ladder's best rate a credit
-- costs the platform 40 paise of forgone revenue, so 10% + 10% of a first
-- payment given back as credits is a bounded, one-time acquisition cost.
--
-- WHY THE WELCOME BONUS DOES NOT MOVE THE MILESTONE OR THE FLOOR. The
-- milestone counts REWARDED REFERRALS for the referrer, and the floor
-- (referral_min_payment) decides whether this payment qualifies at all - both
-- are about the referral, not about who gets paid for it, so the invitee's
-- grant sits after the same guards the referrer's does and adds none of its
-- own. One qualifying rule, two payouts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · What the invitee received, on the referral row
-- ---------------------------------------------------------------------------
alter table public.referrals
  add column if not exists welcome_credits numeric(12, 2);

comment on column public.referrals.welcome_credits is
  'Credits granted to the INVITED account off their first payment. Null on referrals rewarded before this existed; 0 when the setting was 0 at the time.';

-- ---------------------------------------------------------------------------
-- 2 · The setting
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('referral_invitee_percent', '10'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3 · The classification, so the giveaway reports stay honest
-- ---------------------------------------------------------------------------
-- credit_source() calls out an unknown positive reason as 'other' rather than
-- quietly counting it as free - which is right, and means the new reason must
-- be added HERE or every welcome bonus would land in "other" and the credit
-- economy screen would understate what referrals cost.
create or replace function public.credit_source(
  p_reason text,
  p_delta numeric,
  p_actor uuid
)
returns text
language sql
immutable
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
    when p_reason in ('signup_bonus', 'coupon_bonus', 'referral',
                      'referral_milestone', 'trial_grant', 'referral_welcome')
      then 'free'
    -- An unknown positive reason is called out rather than quietly counted as
    -- free, which would understate what has been given away.
    else 'other'
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · Both payouts, one qualifying rule
-- ---------------------------------------------------------------------------
create or replace function public.reward_referral(p_user uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_referrer  uuid;
  v_percent   numeric;
  v_welcome_percent numeric;
  v_reward    numeric(12, 2);
  v_welcome   numeric(12, 2);
  v_need      integer;
  v_bonus     numeric;
  v_minimum   numeric;
  v_qualified integer;
  v_paid      boolean;
  v_lock      uuid;
begin
  if coalesce((select (value #>> '{}')::boolean from public.app_settings
               where key = 'referral_enabled'), true) is not true then
    return jsonb_build_object('ok', true, 'rewarded', false, 'reason', 'disabled');
  end if;

  -- Only the FIRST payment counts, which is what the pending status means.
  select referrer_id into v_referrer
  from public.referrals
  where referred_id = p_user and status = 'pending'
  for update;

  if v_referrer is null then
    return jsonb_build_object('ok', true, 'rewarded', false, 'reason', 'no_pending_referral');
  end if;

  /*
   * The floor, checked before anything is granted and before the referral is
   * closed. Returning early leaves the row at 'pending' on purpose: this
   * payment did not qualify, but the next one still can, so an honest customer
   * who happened to start small does not cost their inviter the reward.
   *
   * The floor gates BOTH payouts. A welcome bonus paid on a below-floor payment
   * would make the invitee's side of the scheme a way round the referrer's
   * floor, and two qualifying rules for one referral is how the two sides end
   * up disagreeing about whether it happened.
   */
  select coalesce((value #>> '{}')::numeric, 0) into v_minimum
  from public.app_settings where key = 'referral_min_payment';

  if coalesce(v_minimum, 0) > 0 and coalesce(p_amount, 0) < v_minimum then
    return jsonb_build_object(
      'ok', true, 'rewarded', false, 'reason', 'below_minimum',
      'minimum', v_minimum, 'amount', p_amount);
  end if;

  /*
   * Everything below is about the referrer rather than about this one referral,
   * so this is where the transactions have to queue. Taken before the reward is
   * granted, not just before the milestone check, so that the count and the
   * "has it been paid" test below cannot straddle another transaction's commit.
   */
  select id into v_lock from public.profiles where id = v_referrer for update;

  select coalesce((value #>> '{}')::numeric, 0) into v_percent
  from public.app_settings where key = 'referral_percent';
  select coalesce((value #>> '{}')::numeric, 0) into v_welcome_percent
  from public.app_settings where key = 'referral_invitee_percent';

  v_reward  := floor(coalesce(p_amount, 0) * coalesce(v_percent, 0) / 100);
  v_welcome := floor(coalesce(p_amount, 0) * coalesce(v_welcome_percent, 0) / 100);

  update public.referrals
  set status = 'rewarded',
      reward_credits = v_reward,
      welcome_credits = v_welcome,
      first_amount = p_amount,
      rewarded_at = now()
  where referred_id = p_user and status = 'pending';

  if v_reward > 0 then
    perform public.grant_credits(
      v_referrer, v_reward, 'referral', null,
      format('Referral reward, %s%% of a %s rupee payment', v_percent, p_amount));
  end if;

  /*
   * The invitee's side. Their profile row is already locked by this
   * transaction's caller chain (settle_payment updated their payment and
   * granted their purchase credits), so no second explicit lock is taken -
   * grant_credits' own UPDATE serialises against anything else touching the
   * balance.
   */
  if v_welcome > 0 then
    perform public.grant_credits(
      p_user, v_welcome, 'referral_welcome', null,
      format('Welcome bonus, %s%% of your first %s rupee payment - you joined on an invite',
             v_welcome_percent, p_amount));
  end if;

  -- Milestone: paid once, the moment the count is reached.
  select coalesce((value #>> '{}')::int, 0) into v_need
  from public.app_settings where key = 'referral_milestone_count';
  select coalesce((value #>> '{}')::numeric, 0) into v_bonus
  from public.app_settings where key = 'referral_milestone_bonus';

  if v_need > 0 and v_bonus > 0 then
    select count(*) into v_qualified
    from public.referrals where referrer_id = v_referrer and status = 'rewarded';

    select exists (
      select 1 from public.credit_transactions
      where user_id = v_referrer and reason = 'referral_milestone'
    ) into v_paid;

    if v_qualified >= v_need and not v_paid then
      /*
       * The unique index added in 0025 is the backstop, and it is caught rather
       * than allowed to propagate. A duplicate here means the bonus has already
       * been paid, which is not a reason to fail the payment that was being
       * settled - somebody's credits would go missing over a bonus they already
       * had.
       */
      begin
        perform public.grant_credits(
          v_referrer, v_bonus, 'referral_milestone', null,
          format('Milestone bonus for %s paid referrals', v_qualified));
      exception when unique_violation then
        null;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'rewarded', true, 'referrer', v_referrer,
    'credits', v_reward, 'welcome_credits', v_welcome);
end $fn$;

comment on function public.reward_referral(uuid, numeric) is
  'Closes a pending referral off the invitee''s first qualifying payment: referral_percent of it to the referrer, referral_invitee_percent of it to the invitee, one floor gating both.';

-- ---------------------------------------------------------------------------
-- 5 · The claims view says both sides
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
  r.welcome_credits,
  r.first_amount,
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
  'One row per referral, both sides named, with what each side was paid and how many days the invitee took to pay.';

-- ---------------------------------------------------------------------------
-- 6 · Who may call it. Recreating a SECURITY DEFINER function resets its
--     grants to the schema default, and Supabase's default hands anon and
--     authenticated EXECUTE - the hole 0025 swept, reopened by any migration
--     that forgets this block.
-- ---------------------------------------------------------------------------
revoke all on function public.reward_referral(uuid, numeric) from public;
revoke all on function public.reward_referral(uuid, numeric) from anon, authenticated;
grant execute on function public.reward_referral(uuid, numeric) to service_role;

-- credit_source is left callable by anon and authenticated ON PURPOSE, matching
-- the grants it already carries in production. It is an IMMUTABLE pure
-- classifier over its own arguments - it reads no table and can leak nothing
-- but the bucketing rules - and it is called from invoker-rights contexts, so
-- revoking it risks breaking a reader for zero security gain. Do not "fix"
-- this by sweeping it; the sweep is for functions that touch data.

revoke all on public.referral_claim_detail from public;
revoke all on public.referral_claim_detail from anon, authenticated;
grant select on public.referral_claim_detail to service_role;
