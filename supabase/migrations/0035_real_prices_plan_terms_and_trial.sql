-- ===========================================================================
-- Real prices, a plan that ends, and a free trial nobody can take twice.
--
-- WHY THIS FILE IS 0035 AND NOT 0031
--
-- It replaces settle_payment(), and 0034_payment_audit_trail.sql replaces it
-- too. Every migration runs in filename order on every push, so a settle_payment
-- written at 0031 would be overwritten by 0034 on the very run that applied it -
-- the plan term below would be live in the file and absent from the database.
-- So this sits above the highest file that touches that function. Anything
-- numbered 0031-0033 is still free for whoever wants it.
--
-- ---------------------------------------------------------------------------
-- 1 · THE PRICES WERE NOT PRICES
--
-- Measured before writing anything. All three plans: price_per_month = 0,
-- included_credits = 10. So the plan grid offered three free plans, and
-- pricePlan() in checkout-actions.ts refuses a zero price outright - "That plan
-- cannot be bought online" - which means NOBODY COULD BUY ANYTHING. The credit
-- ladder had a two-rupee row called "trial" sitting at the top of the buy page.
--
-- What a credit actually buys, from credit_rates, is the only fixed point the
-- pricing can be built on:
--
--     manual_search  units_per_credit = 1.0   ->  1 search      = 1 credit
--     auto_check     units_per_credit = 0.5   ->  1 auto check  = 2 credits
--
-- (units_per_credit is "how many of this action one credit buys", and
-- spend_credits() charges ceil(count / rate). Confirmed against the ledger:
-- 359 auto_check rows totalling -703.00, i.e. 1.96 credits each; 35
-- manual_search rows totalling -35.00, i.e. 1.00 each.)
--
-- The owner's anchor is Rs 10,000 -> 25,000 credits. That is 2.5 credits per
-- rupee, so a credit at its best price is 40 paise, a manual search is 40 paise
-- and an automatic check is 80 paise. Every number below is derived from those
-- three figures, and the ladder is built so that a bigger rung is never worse
-- value per credit than a smaller one:
--
--     Starter      Rs    500  ->     750 credits   Rs 0.667 each   (entry)
--     Standard     Rs  2,000  ->   3,600 credits   Rs 0.556 each   +20%
--     Plus         Rs  5,000  ->  11,000 credits   Rs 0.455 each   +47%
--     Any amount   Rs 10,000+ ->  2.5x per rupee   Rs 0.400 each   +67%
--
-- The open tier is a flat percentage, so its rate is the same at every amount -
-- which means it has to be the BEST rate on the ladder and its minimum has to
-- sit above every fixed rung. Rs 10,000 is where the owner's anchor lands, so
-- that is the minimum, and Rs 10,000 x 1 credit/rupee x 250% = 25,000 credits
-- exactly.
--
-- The two-rupee test row is deleted. payments.pack_id is ON DELETE SET NULL, so
-- the four payments that used it keep their own amount and credits.
--
-- ---------------------------------------------------------------------------
-- 2 · A PLAN THAT ENDS
--
-- Today expiry is typed in by hand, per customer, on the account page. The two
-- live customers on Basic both have plan_expires_on = null, which is to say one
-- payment - and neither of them made one - would have bought the truck limit
-- for ever.
--
-- The owner asked whether time-based plans are needed. They are, and not only
-- to stop that: plan_expires_on is already what officer_overview computes
-- plan_active from, so an end date is the only thing in the schema that can
-- turn a lapsed account off. Without one, "renewal" is a conversation nobody is
-- prompted to have.
--
-- So a plan carries its own term. duration_months set means buying it ends at
-- purchase date + that many months; null means no expiry, which is what the two
-- existing customers already have and keep.
--
-- THE TERM IS RESTRICTED TO 1, 3, 6 OR 12 ON PURPOSE. pricePlan() charges
-- price_per_month x payments.months and coerces anything outside its own
-- ALLOWED_MONTHS list to 1. The portal posts this column as that term, so a
-- value the checkout does not recognise would charge one month for a plan that
-- lasts two years. The check constraint below is the mirror of that list;
-- widening it means widening ALLOWED_MONTHS in the same commit.
--
-- ---------------------------------------------------------------------------
-- 3 · A TRIAL, ONCE PER PERSON, ENFORCED HERE AND NOT IN THE BROWSER
--
-- The trial is a PLAN ROW rather than a new mechanism, because everything it
-- needs already hangs off one: truck_limit caps it at a single truck,
-- included_credits is the free balance, plan_expires_on ends it, and plan_active
-- - plan_id is not null and (expires is null or expires >= ist_today()) - turns
-- the whole product off by itself when the seventh day passes. No cron, no
-- sweeper, nothing to forget to run.
--
-- Once per account is the easy half: a claim row keyed on the user id. The hard
-- half is once per PERSON, because a second account is free and takes a minute.
-- So the claim is keyed on three things and any one of them refuses:
--
--   user_id     the account. Partial-unique, and ON DELETE SET NULL rather than
--               CASCADE, so deleting the account does NOT hand the trial back.
--   email_key   the mailbox, not the address. a.b+x@gmail.com and ab@gmail.com
--               are one inbox and are the cheapest way to take ten trials.
--   phone_key   the last ten digits. An Indian mobile costs money and needs a
--               SIM, which makes it the most expensive identity to duplicate -
--               it is the one that actually stops this.
--
-- Enforced by unique indexes, so the refusal comes from the database whatever
-- calls it: the portal button, a Server Action posted by hand, or psql.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · What a plan carries
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists duration_months integer,
  add column if not exists is_trial        boolean not null default false,
  add column if not exists trial_days      integer;

comment on column public.plans.duration_months is
  'How long this plan lasts once bought. Null is no expiry. Restricted to 1, 3, 6 or 12 because pricePlan() charges price_per_month x this and coerces anything else to one month.';
comment on column public.plans.is_trial is
  'The free trial row. At most one, free by definition, and it is the only plan the portal will hand over without a payment.';
comment on column public.plans.trial_days is
  'Trial only: how many days it runs for. Set alongside included_credits, which is the free balance - both are what the admin edits to change the trial offer.';

-- The mirror of ALLOWED_MONTHS in src/app/portal/plan/checkout-actions.ts. See
-- the header: a term outside this list would be sold for one month's money.
alter table public.plans drop constraint if exists plans_duration_months_check;
alter table public.plans
  add constraint plans_duration_months_check
  check (duration_months is null or duration_months in (1, 3, 6, 12));

-- A trial cannot cost anything: pricePlan() refuses a zero price, and that
-- refusal is what stops the trial row appearing as a buyable plan.
alter table public.plans drop constraint if exists plans_trial_is_free;
alter table public.plans
  add constraint plans_trial_is_free
  check (not is_trial or price_per_month = 0);

-- Days belong to the trial and months to the paid plans. Keeping each on its
-- own side of this line is what stops "7" ever being read as seven months.
alter table public.plans drop constraint if exists plans_trial_days_range;
alter table public.plans
  add constraint plans_trial_days_range
  check (
    (is_trial and trial_days between 1 and 90 and duration_months is null)
    or (not is_trial and trial_days is null)
  );

-- One trial, or the portal would have to choose between two and the answer
-- would depend on row order. Unique on the flag itself, filtered to the rows
-- where it is true: inside that set every value is `true`, so uniqueness across
-- it means at most one row.
create unique index if not exists plans_one_trial_idx
  on public.plans (is_trial) where is_trial;


-- ---------------------------------------------------------------------------
-- 2 · The real ladder
-- ---------------------------------------------------------------------------
-- Every update below is guarded on the value it is replacing, because this file
-- runs again on every push. Without the guard a price the admin has since
-- edited in the console would be reset to this one on the next deploy - the
-- migration would quietly become the authority on a number that is theirs.

delete from public.credit_packs where name = 'trial' and price_inr = 2;

update public.credit_packs
set price_inr = 500, credits = 750, sort_order = 10
where name = 'Starter' and price_inr = 100 and credits = 100;

update public.credit_packs
set price_inr = 2000, credits = 3600, sort_order = 20
where name = 'Standard' and price_inr = 500 and credits = 1200;

update public.credit_packs
set price_inr = 5000, credits = 11000, sort_order = 30
where name = 'Plus' and price_inr = 1000 and credits = 2500;

-- Renamed to what it is. "Custom amount" reads like a bespoke deal to arrange;
-- this rung is the buyer typing a figure.
update public.credit_packs
set name = 'Any amount', price_inr = 10000, credit_percent = 250, sort_order = 40
where name = 'Custom amount' and price_inr = 3000 and is_open_ended;


-- ---------------------------------------------------------------------------
-- 3 · The real plans
-- ---------------------------------------------------------------------------
-- The sums, so the next person to change one of these can see what it was
-- balanced against. Value of the included credits is taken at the BEST credit
-- price - 40 paise - because that is the alternative the customer has:
--
--                trucks  credits   credit value   charged/yr   fee net of
--                                  at Rs 0.40                  credits
--   Basic            10    1,500        Rs   600     Rs 2,388     Rs 1,788
--   Professional     50    6,000        Rs 2,400     Rs 7,188     Rs 4,788
--   Unlimited        --   20,000        Rs 8,000     Rs 17,988    Rs 9,988
--
-- Per truck slot that is Rs 179, Rs 96 and uncapped a year, so a bigger plan is
-- better value per slot - the same direction the credit ladder runs in. Credits
-- climb faster than price at every step (4x the credits for 3x the money, then
-- 3.3x for 2.5x), so no tier is a worse buy than the one below it.
--
-- In work: 1,500 credits is 1,500 manual searches, or 750 automatic checks -
-- about eight days of one truck on a thirty-minute beat. That is the honest
-- shape of this product. The plan is an access fee for fleet size; the metered
-- money is credits, and a customer watching five trucks properly will spend
-- more on credits in a month than the plan costs in a year.

update public.plans
set price_per_month = 199,
    included_credits = 1500,
    duration_months = 12,
    truck_limit = 10,
    description = 'One owner, a small fleet. Ten trucks watched at once.',
    sort_order = 10
where name = 'Basic' and price_per_month = 0;

update public.plans
set price_per_month = 599,
    included_credits = 6000,
    duration_months = 12,
    truck_limit = 50,
    description = 'A working transport office. Fifty trucks watched at once.',
    sort_order = 20
where name = 'Professional' and price_per_month = 0;

update public.plans
set price_per_month = 1499,
    included_credits = 20000,
    duration_months = 12,
    truck_limit = -1,
    description = 'For a team. No cap on how many trucks are watched at once.',
    sort_order = 30
where name = 'Unlimited' and price_per_month = 0;

-- Fifteen credits is fifteen manual searches, or seven automatic checks. Enough
-- to prove a lorry can be found; not enough to run a truck on a fifteen-minute
-- beat for more than a couple of hours. Both numbers are the admin's to change
-- on the Plans tab, which is why they are columns and not constants.
insert into public.plans
  (name, description, truck_limit, included_credits, price_per_month,
   is_active, sort_order, is_trial, trial_days)
values
  ('Free trial', 'One truck, seven days. No payment, no card.',
   1, 15, 0, true, 5, true, 7)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------------
-- 4 · One identity, three ways of spelling it
-- ---------------------------------------------------------------------------
-- Both of these are keys, not addresses: nothing renders them, nothing posts
-- them anywhere. They exist so that two spellings of one person collide in a
-- unique index. IMMUTABLE because the indexes below are built on them.

create or replace function public.trial_email_key(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  /*
   * Gmail ignores dots in the local part and everything after a plus, and
   * googlemail.com is the same service. So a.b+trial2@googlemail.com and
   * ab@gmail.com are one mailbox, and treating them as two is handing out
   * unlimited trials to anyone who has read this far. Every other domain is
   * lower-cased and trimmed and otherwise left alone - plus-addressing is not
   * universal, and folding it everywhere would refuse a trial to two genuinely
   * different mailboxes at a provider that treats them as different.
   */
  select case
    when btrim(coalesce(p_email, '')) = '' then null
    when parts.domain in ('gmail.com', 'googlemail.com')
      then replace(split_part(parts.local, '+', 1), '.', '') || '@gmail.com'
    else parts.local || '@' || parts.domain
  end
  from (
    select split_part(lower(btrim(coalesce(p_email, ''))), '@', 1) as local,
           split_part(lower(btrim(coalesce(p_email, ''))), '@', 2) as domain
  ) parts;
$fn$;

comment on function public.trial_email_key(text) is
  'A mailbox rather than an address, for the once-per-person trial index. Folds Gmail dots and plus-addressing; leaves every other domain alone.';

create or replace function public.trial_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  /*
   * The last ten digits, because profiles.phone is written by two forms that do
   * not agree. Sign-up insists on an Indian mobile and stores +91XXXXXXXXXX;
   * the portal's own profile form takes anything roughly phone-shaped, so the
   * column legitimately holds "0982 5000 00" as well. All of those have to
   * collide.
   *
   * Under ten digits is not a mobile, so it keys on nothing rather than locking
   * a whole family of short strings out of the trial. Null is the same answer,
   * and null is common: accounts an admin created by hand have no phone at all.
   */
  select case when length(d.digits) < 10 then null else right(d.digits, 10) end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) d;
$fn$;

comment on function public.trial_phone_key(text) is
  'The last ten digits of a phone number, for the once-per-person trial index. Null under ten digits - that is not a mobile worth keying on.';


-- ---------------------------------------------------------------------------
-- 5 · The claim
-- ---------------------------------------------------------------------------
create table if not exists public.trial_claims (
  id              uuid primary key default gen_random_uuid(),
  /*
   * ON DELETE SET NULL, deliberately, where everything else in this schema
   * cascades. A cascade would mean deleting the account gives the trial back -
   * and the email and phone locks with it - which is the one hole worth being
   * awkward about. The row outlives the account it was claimed by.
   */
  user_id         uuid references public.profiles (id) on delete set null,
  email_key       text not null,
  phone_key       text,
  plan_id         uuid references public.plans (id) on delete set null,
  credits_granted numeric(12, 2) not null default 0,
  started_on      date not null default public.ist_today(),
  expires_on      date not null,
  created_at      timestamptz not null default now()
);

comment on table public.trial_claims is
  'One row per free trial ever handed out. The unique indexes below are the once-per-person rule; nothing in the app is trusted to enforce it.';

create unique index if not exists trial_claims_user_idx
  on public.trial_claims (user_id) where user_id is not null;
create unique index if not exists trial_claims_email_idx
  on public.trial_claims (email_key);
create unique index if not exists trial_claims_phone_idx
  on public.trial_claims (phone_key) where phone_key is not null;

-- No policies, so nobody but service_role reads or writes this. A customer has
-- no question about it that their own plan row does not answer.
alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from public;
revoke all on public.trial_claims from anon, authenticated;
grant select, insert, update, delete on public.trial_claims to service_role;


-- ---------------------------------------------------------------------------
-- 6 · Starting one
-- ---------------------------------------------------------------------------
create or replace function public.start_free_trial(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email    text;
  v_phone    text;
  v_role     public.user_role;
  v_status   public.account_status;
  v_plan     uuid;
  v_assigned timestamptz;
  v_trial    public.plans;
  v_days     integer;
  v_credits  numeric(12, 2);
  v_expires  date;
  v_grant    jsonb;
begin
  /*
   * FOR UPDATE, and everything below happens inside that lock. Two taps on a
   * slow phone are two calls, and without the lock both would read plan_id as
   * null and pass every check before either wrote a claim. The unique indexes
   * would still refuse the second insert - that is the actual guarantee - but
   * this way the second call gets a plain "you already have a plan" instead of
   * a constraint violation.
   */
  select email, phone, role, status, plan_id, plan_assigned_at
  into v_email, v_phone, v_role, v_status, v_plan, v_assigned
  from public.profiles where id = p_user for update;

  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_user');
  end if;
  if v_role <> 'officer' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_customer');
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'account_suspended');
  end if;
  if v_plan is not null then
    return jsonb_build_object('ok', false, 'reason', 'has_plan');
  end if;
  /*
   * Ever had a plan, not just now. plan_assigned_at is set once with a
   * coalesce and never cleared, so this catches an account whose paid plan an
   * admin has since removed - which would otherwise read as a fresh account.
   */
  if v_assigned is not null then
    return jsonb_build_object('ok', false, 'reason', 'had_plan');
  end if;
  if exists (
    select 1 from public.payments where user_id = p_user and status = 'paid'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'has_paid');
  end if;

  select * into v_trial from public.plans where is_trial and is_active;
  if v_trial.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_trial');
  end if;

  v_days    := coalesce(v_trial.trial_days, 7);
  v_credits := coalesce(v_trial.included_credits, 0);
  v_expires := public.ist_today() + v_days;

  /*
   * The claim first, and the account second. If the indexes refuse it nothing
   * else has happened yet, so there is no half-started trial to clean up - and
   * a caught unique_violation is the honest answer to "have I had one of these
   * before", however the caller arrived.
   */
  begin
    insert into public.trial_claims
      (user_id, email_key, phone_key, plan_id, credits_granted, started_on, expires_on)
    values
      (p_user,
       public.trial_email_key(v_email),
       public.trial_phone_key(v_phone),
       v_trial.id, v_credits, public.ist_today(), v_expires);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end;

  update public.profiles
  set plan_id = v_trial.id,
      plan_assigned_at = now(),
      plan_expires_on = v_expires
  where id = p_user;

  /*
   * All six arguments, including the two nulls, and they are cast.
   *
   * 0034 added a sixth parameter to grant_credits with a default rather than
   * replacing the five-argument version, so both signatures are resolvable and
   * a five-argument call is AMBIGUOUS - Postgres refuses it outright with
   * "function grant_credits(uuid, numeric, unknown, unknown, text) is not
   * unique". Caught by running this file against the live schema in a
   * transaction that was rolled back; the trial would have failed on its first
   * real use otherwise. No payment caused these credits, so p_payment is null.
   */
  if v_credits > 0 then
    v_grant := public.grant_credits(
      p_user,
      v_credits,
      'trial_grant'::text,
      null::uuid,
      format('Free trial, %s day%s', v_days, case when v_days = 1 then '' else 's' end),
      null::uuid);
  end if;

  return jsonb_build_object(
    'ok', true,
    'plan_id', v_trial.id,
    'plan_name', v_trial.name,
    'trial_days', v_days,
    'truck_limit', v_trial.truck_limit,
    'credits', v_credits,
    'expires_on', v_expires,
    'balance', v_grant -> 'balance');
end $fn$;

comment on function public.start_free_trial(uuid) is
  'Hands one account the free trial plan, its credits and an end date. Refuses a second one for the same account, mailbox or mobile - see trial_claims.';

-- The sweep 0025 applies to every security-definer function. Recreating one
-- resets its privileges to the schema default and Supabase's default hands anon
-- and authenticated an EXECUTE grant, so a bare revoke from public would leave
-- a signed-in customer able to call this for somebody else's user id.
revoke all on function public.start_free_trial(uuid) from public;
revoke all on function public.start_free_trial(uuid) from anon, authenticated;
grant execute on function public.start_free_trial(uuid) to service_role;

revoke all on function public.trial_email_key(text) from public;
revoke all on function public.trial_email_key(text) from anon, authenticated;
grant execute on function public.trial_email_key(text) to service_role;

revoke all on function public.trial_phone_key(text) from public;
revoke all on function public.trial_phone_key(text) from anon, authenticated;
grant execute on function public.trial_phone_key(text) to service_role;


-- ---------------------------------------------------------------------------
-- 7 · Free credits are free credits
-- ---------------------------------------------------------------------------
-- Without this a trial grant lands in 'other', which is the bucket the function
-- reserves for a reason nobody has classified - so the credit economy report
-- would show the trial giveaway as unexplained rather than as what it cost.
--
-- NO REVOKE SWEEP ON THIS ONE, and that is deliberate rather than forgotten.
-- It is not SECURITY DEFINER - it is a pure classifier over its arguments - and
-- credit_ledger_daily calls it. That view is a security_invoker view a customer
-- reads to see their own credit history, so revoking EXECUTE from authenticated
-- would break the portal's activity page rather than close anything. Checked
-- against the live grants before writing this: anon and authenticated hold
-- EXECUTE today, which is what the schema default restores below.
create or replace function public.credit_source(
  p_reason text,
  p_delta  numeric,
  p_actor  uuid
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
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
                      'referral_milestone', 'trial_grant')
      then 'free'
    -- An unknown positive reason is called out rather than quietly counted as
    -- free, which would understate what has been given away.
    else 'other'
  end;
$fn$;


-- ---------------------------------------------------------------------------
-- 8 · Settlement reads the plan's term, not the buyer's
-- ---------------------------------------------------------------------------
-- Rebuilt from 0034's version - only the expiry block changes. Same signature,
-- same returned keys, so the webhook at /api/webhooks/razorpay and the receipt
-- screen see exactly what they saw before.
--
-- The old arithmetic was:
--
--     greatest(coalesce(plan_expires_on, ist_today()), ist_today())
--       + (coalesce(months, 1) || ' months')::interval
--
-- with `months` coming off the payment row - which came off a picker in the
-- browser. So the term was the buyer's choice and the plan had nothing to say
-- about how long it lasted. Now the PLAN decides, and the picker is gone from
-- the portal.
--
-- Where the term is counted from, and why it is not simply "today":
--
--   * no plan, or one that has lapsed -> today. Nothing to carry.
--   * a paid plan still running       -> its end date. Days already paid for
--                                        are not thrown away, which matters
--                                        because an admin recording an offline
--                                        renewal goes through this same
--                                        function (record_offline_payment calls
--                                        it) and must not shorten anyone.
--   * a trial still running           -> today. Trial days are not paid days,
--                                        so converting on day one does not buy
--                                        six free ones on the end.
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
  v_term    integer;
  v_trial   boolean;
  v_trial_days integer;
  v_from    date;
  v_expires date;
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
   * It returns the payment's id, so the caller can go and read what that
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
    select included_credits, duration_months, is_trial, trial_days
    into v_plan_credits, v_term, v_trial, v_trial_days
    from public.plans where id = v_plan;

    -- v_months is deliberately not read here. It is still the record of the
    -- term that was CHARGED - price_per_month x months - and the portal posts
    -- the plan's own duration into it, so the two agree. But the plan row is
    -- the authority on when access ends, and reading both would be two answers.
    select
      case
        when pr.plan_id is null then public.ist_today()
        when coalesce(cur.is_trial, false) then public.ist_today()
        else greatest(coalesce(pr.plan_expires_on, public.ist_today()), public.ist_today())
      end
    into v_from
    from public.profiles pr
    left join public.plans cur on cur.id = pr.plan_id
    where pr.id = v_user;

    /*
     * A trial row should never reach here - it is free, and pricePlan() refuses
     * a zero price - but record_offline_payment() takes any plan id an admin
     * types, and null months would then read as "no expiry". So a paid trial
     * gets the trial's own days rather than for ever.
     */
    v_expires := case
      when coalesce(v_trial, false) then v_from + coalesce(v_trial_days, 7)
      when v_term is null then null
      else (v_from + (v_term || ' months')::interval)::date
    end;

    update public.profiles
    set plan_id = v_plan,
        plan_assigned_at = coalesce(plan_assigned_at, now()),
        plan_expires_on = v_expires
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
    -- New, and additive: nothing reads it yet, but a receipt can now say when
    -- the plan ends without a second read. Only meaningful when kind is 'plan';
    -- on a credit top-up it is null because no expiry was touched, not because
    -- the plan has none.
    'plan_expires_on', v_expires,
    'balance_before', v_grant -> 'balance_before',
    'balance_after', v_grant -> 'balance',
    'referral', v_referral);
end $fn$;

comment on function public.settle_payment(text, text) is
  'Hands over what a payment bought, exactly once. A plan''s end date comes from plans.duration_months - null means no expiry - counted on from the current paid expiry, or from today when the account has no plan or is on the trial.';

revoke all on function public.settle_payment(text, text) from public;
revoke all on function public.settle_payment(text, text) from anon, authenticated;
grant execute on function public.settle_payment(text, text) to service_role;
