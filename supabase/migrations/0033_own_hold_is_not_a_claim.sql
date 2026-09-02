-- ===========================================================================
-- A customer's own unpaid checkout locked them out of their own coupon.
--
-- Reproduced against the live database before writing this, inside a
-- transaction that was rolled back. Single-use discount code, one account:
--
--   reserve_coupon('ZZTEST1', kirtan, payment, 100)   -> ok, 50.00 rupees off
--   validate_coupon('ZZTEST1', kirtan, 100)           -> already_used,
--                                                        "You have already
--                                                         used that code."
--
-- Nothing was paid between those two lines. The customer opened a checkout,
-- closed the tab, came straight back, and was told they had used a code they
-- had not used. release_stale_coupon_holds only hands a reservation back after
-- 30 minutes, so that answer stood for half an hour, on a code that had cost
-- the business nothing and the customer nothing.
--
-- WHY IT HAPPENED. Both claim limits counted `status in ('reserved',
-- 'applied')`, which is to say both limits treated "somebody is at a checkout"
-- and "somebody has been given this" as the same event. For the global limit
-- that is right and load-bearing. For the per-person limit it is wrong, and it
-- is wrong in the one direction that hurts: it spends a person's single use on
-- their own abandoned tab.
--
-- THE FIX, in one sentence: a hold reserves the code against OTHER people. It
-- never reserves the code against the person holding it.
--
--   max_claims   (global, across everyone)
--                still counts every live hold plus every settled claim, minus
--                the caller's own holds - which reserve_coupon hands back
--                before it counts, so excluding them is not a discount on the
--                truth, it is the truth one statement early. Two DIFFERENT
--                checkouts still cannot both win the last claim: they still
--                queue on the coupon's own row lock (0025), and each of them
--                still sees the other's reservation.
--
--   max_per_user (per person)
--                counts only what that person has actually been given -
--                status 'applied'. A hold of their own is a checkout in
--                flight, not a claim, and it can no longer accuse them of
--                anything.
--
-- WHAT THIS GIVES UP, said plainly. A customer who keeps two discounted
-- checkouts open at once and pays BOTH can now exceed max_per_user by one per
-- extra order they pay for. Before, the second checkout was refused the
-- discount, which is how the honest customer came to be refused as well - the
-- same rule, hitting the same person, for the opposite reason. Three things
-- bound it: reserve_coupon releases the customer's own previous hold, so they
-- can only ever hold one live claim per code; every extra discount costs them a
-- real payment through Razorpay; and settle_coupon below now records that
-- payment's claim whatever state its hold was left in, so the admin SEES it
-- instead of it vanishing from the count.
--
-- That last part fixes a hole that has been here since 0015 and is not
-- theoretical: release_stale_coupon_holds already hands back holds on orders
-- that are still open and payable, and settle_coupon only ever flipped a
-- 'reserved' row. So a customer who paid 31 minutes after opening a checkout
-- got their discount and left no claim at all - an under-count of exactly the
-- thing max_claims is counting.
--
-- WHAT THE ADMIN WAS SEEING. Measured on the same abandoned hold:
--
--   coupon_usage            used 0, holding 1, claims_left 2 of 3
--   coupon_claim_detail     one row, status 'reserved', discount_inr 50.00
--
-- The first is honest. The second is where "the console says the code was
-- used" comes from: the claims report sums discount_inr over every row it can
-- see, so a checkout nobody paid for reported Rs 50 taken off prices, on the
-- same screen as a "Claims: 1" headline. Fifty rupees of discount that never
-- happened, and the codes list said Rs 0 for the same code, because
-- coupon_usage has always filtered that sum to 'applied'. Two screens, two
-- answers, and the wrong one was the one with the word "claims" on it.
--
-- So coupon_claim_detail now carries the reward SETTLED separately from the
-- reward QUOTED, and both views classify a hold by whether anyone could still
-- pay it. A reservation older than the release window is not "held", it is
-- abandoned, and it stops counting against claims_left - which also means the
-- codes list heals itself. Before this, a hold sat on the screen as consumed
-- supply until the next person happened to type a code, because the only thing
-- that ever ran the release was validate_coupon.
--
-- Run after 0030_credit_bonus_is_not_a_discount.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. How long a hold lives, in one place
--
-- Three things have to agree about this number: the sweep that releases a
-- hold, the count that decides whether a code is exhausted, and the admin
-- screens that draw the holds. When they disagree the console shows "2 left"
-- while the checkout says "fully claimed", and neither is debuggable from the
-- other. It is a function rather than a comment because a view cannot read a
-- comment.
--
-- Ten minutes, down from thirty. Thirty was chosen when a hold was released by
-- nothing else at all; the number that matters is how long a real payment
-- takes, and a card with an OTP or a UPI collect request is done inside a few
-- minutes or not at all. The customer's own retry no longer waits on this
-- clock in any case - it is now only about how long ONE person may keep the
-- last claim of a code away from the next person.
-- ---------------------------------------------------------------------------
create or replace function public.coupon_hold_minutes()
returns integer
language sql
immutable
as $fn$ select 10 $fn$;

comment on function public.coupon_hold_minutes() is
  'How many minutes an unpaid coupon reservation holds a claim. Read by release_stale_coupon_holds, validate_coupon and both coupon views so they cannot drift.';

-- Not security definer, so this is housekeeping rather than a hole. Swept
-- anyway: Supabase grants execute on anything new in public to anon and
-- authenticated, and the convention 0025 set is that every function in this
-- schema says who may call it.
revoke all on function public.coupon_hold_minutes() from public;
revoke all on function public.coupon_hold_minutes() from anon, authenticated;
grant execute on function public.coupon_hold_minutes() to service_role;

-- ---------------------------------------------------------------------------
-- 2. release_stale_coupon_holds - now on the shared clock
--
-- Same signature, so nothing that calls it has to change and no stale overload
-- is left behind. Passing nothing means "the shared window"; an explicit
-- number still wins, which is what makes it testable.
-- ---------------------------------------------------------------------------
create or replace function public.release_stale_coupon_holds(p_minutes integer default null)
returns integer
language sql
security definer
set search_path = public
as $fn$
  with gone as (
    update public.coupon_redemptions r
    set status = 'released', settled_at = now()
    where r.status = 'reserved'
      and r.created_at < now() - make_interval(
            mins => greatest(coalesce(p_minutes, public.coupon_hold_minutes()), 1))
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

comment on function public.release_stale_coupon_holds(integer) is
  'Hands back reservations nobody paid for, older than coupon_hold_minutes(). A hold on a payment that did settle is never touched.';

revoke all on function public.release_stale_coupon_holds(integer) from public;
revoke all on function public.release_stale_coupon_holds(integer) from anon, authenticated;
grant execute on function public.release_stale_coupon_holds(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. validate_coupon - the fix
--
-- Everything 0030 put here stays exactly as it was: the credit_bonus refusal
-- before any other test, and the exhaustive branch over `kind` with no `else`
-- that means "a percentage". Only the two claim counts change.
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
  v_settled  integer;
  v_holding  integer;
  v_mine     integer;
  v_discount numeric(10, 2);
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty',
      'message', 'Enter a code.');
  end if;

  -- Hand back anything abandoned before counting. This is the only thing that
  -- ever runs the sweep, which is why it stays at the top: without it a code
  -- with a claim ceiling stays partly spent by whoever last walked away.
  perform public.release_stale_coupon_holds();

  select * into c from public.coupons where code = v_code;

  if c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown',
      'message', 'That code is not recognised.');
  end if;

  /*
   * A credit code is not a discount, and this is the check that matters.
   * Kept first, from 0030: everything below is about whether a DISCOUNT
   * applies, and for a credit code the question itself is wrong.
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

  /*
   * The global ceiling: settled claims, plus live holds belonging to SOMEBODY
   * ELSE.
   *
   * The caller's own holds are left out because reserve_coupon hands them back
   * as its first act - the customer is starting a fresh checkout, so their
   * previous one is being replaced, not run alongside. Counting a hold this
   * function is about to release would refuse the last claim of a code to the
   * only person who already had it.
   *
   * Everyone else's holds still count, and that is the whole guarantee: two
   * different checkouts opened in the same instant queue on the coupon's row
   * lock in reserve_coupon, so the second one counts AFTER the first one's
   * reservation exists and is refused. Nothing about that changed here.
   */
  if c.max_claims is not null then
    select
      count(*) filter (where status = 'applied'),
      count(*) filter (where status = 'reserved' and user_id is distinct from p_user)
    into v_settled, v_holding
    from public.coupon_redemptions
    where coupon_id = c.id;

    if v_settled + v_holding >= c.max_claims then
      return jsonb_build_object('ok', false, 'reason', 'exhausted',
        /* Two different situations, and telling them apart is the difference
           between "go and find another code" and "come back in a minute". */
        'message', case when v_settled >= c.max_claims
          then 'That code has been fully claimed.'
          else 'The last of that code is at somebody else''s checkout. Try again in a few minutes.'
          end);
    end if;
  end if;

  /*
   * The per-person limit: what this person has actually BEEN GIVEN.
   *
   * 'reserved' is gone from this count, and that is the bug fixed. A hold of
   * one's own is an unpaid checkout, and an unpaid checkout has given nobody
   * anything - so it cannot be the evidence that somebody "has already used"
   * a code. 'released' was never counted and still is not.
   */
  select count(*) into v_mine
  from public.coupon_redemptions
  where coupon_id = c.id and user_id = p_user and status = 'applied';

  if v_mine >= c.max_per_user then
    return jsonb_build_object('ok', false, 'reason', 'already_used',
      'message', case when c.max_per_user = 1
        then 'You have already used that code.'
        else format('You have already used that code %s times.', v_mine) end);
  end if;

  /*
   * Exhaustive, with no else that means "percentage" - 0030's fix, kept.
   * A kind added to coupons_kind_check without a branch here fails safe.
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
  'Whether a DISCOUNT code applies to an amount, and for how much. A hold counts against everybody except the person holding it; the per-person limit counts settled claims only. Refuses credit_bonus codes: those belong to redeem_bonus_coupon, not to a checkout.';

-- The revoke sweep 0025 applies to every security-definer function. Recreating
-- one resets its privileges to the schema default, and Supabase's default hands
-- anon and authenticated an execute grant - so leaving this out would reopen
-- the hole on the function that decides what a customer pays.
revoke all on function public.validate_coupon(text, uuid, numeric, text) from public;
revoke all on function public.validate_coupon(text, uuid, numeric, text) from anon, authenticated;
grant execute on function public.validate_coupon(text, uuid, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. reserve_coupon - the customer's previous checkout is replaced, not raced
--
-- The row lock from 0025 is untouched and still the whole concurrency story:
-- take the coupon's own row, then count, then insert. A second caller waits at
-- that line and by the time it counts, the first one's reservation is
-- committed and visible.
--
-- What is new is the statement between the lock and the count. One person can
-- only be at one checkout at a time for one code, so opening a new one means
-- the last one is finished with - and holding a claim for a checkout the
-- customer has walked away from is what locked them out. Handing it back HERE,
-- under the lock, is what makes validate_coupon's exclusion of the caller's own
-- holds true rather than optimistic: by the time it counts, the holds it is
-- ignoring genuinely no longer exist.
--
-- Deliberately not touching the superseded PAYMENT row. Its Razorpay order is
-- open and cannot be recalled, so marking it failed would mean a customer who
-- pays it hands over money against a row settle_payment refuses to match, and
-- gets nothing. A dead order that stays payable is a smaller problem than a
-- payment that cannot be honoured, and settle_coupon below is what keeps the
-- record straight if it ever is paid.
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
  v        jsonb;
  v_coupon uuid;
begin
  -- An unknown code locks nothing and falls through to validate_coupon, which
  -- is the one place allowed to word the refusal.
  select id into v_coupon
  from public.coupons
  where code = upper(btrim(coalesce(p_code, '')))
  for update;

  if v_coupon is not null and p_user is not null then
    update public.coupon_redemptions r
    set status = 'released', settled_at = now()
    where r.coupon_id = v_coupon
      and r.user_id = p_user
      and r.status = 'reserved'
      -- Never the hold for the order being opened right now. There is none yet,
      -- but a retried call must not release the claim it is about to take.
      and r.payment_id is distinct from p_payment
      -- A hold whose payment actually settled is a spent claim wearing the
      -- wrong status, and releasing it would erase a real discount.
      and (
        r.payment_id is null
        or exists (
          select 1 from public.payments p
          where p.id = r.payment_id and p.status <> 'paid'
        )
      );
  end if;

  v := public.validate_coupon(p_code, p_user, p_amount, p_kind);
  if not (v ->> 'ok')::boolean then return v; end if;

  insert into public.coupon_redemptions
    (coupon_id, user_id, payment_id, status, amount_inr, discount_inr)
  values (
    (v ->> 'coupon_id')::uuid, p_user, p_payment, 'reserved',
    p_amount, (v ->> 'discount_inr')::numeric);

  return v;
end $fn$;

comment on function public.reserve_coupon(text, uuid, uuid, numeric, text) is
  'Holds a claim for one open order. Takes the coupon row lock, hands back the same customer''s own unpaid hold on the same code, re-validates, then reserves.';

revoke all on function public.reserve_coupon(text, uuid, uuid, numeric, text) from public;
revoke all on function public.reserve_coupon(text, uuid, uuid, numeric, text) from anon, authenticated;
grant execute on function public.reserve_coupon(text, uuid, uuid, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. settle_coupon - money arriving settles the claim whatever the hold says
--
-- The release direction is unchanged, and that matters: it still only touches a
-- hold that is still 'reserved', so the webhook's payment.failed handler and
-- the checkout's own discard path cannot un-apply a claim that has already been
-- paid for. Only the PAID direction widens.
--
-- It has to. A hold can be handed back while its order is still open and
-- payable - by the stale sweep, which has done exactly that since 0015, and now
-- also when the customer opens a replacement checkout. When such an order is
-- then paid, the discount is given: the amount was fixed when Razorpay opened
-- the order and no later opinion changes it. Matching only 'reserved' meant
-- that claim was never written down at all, so a code with a ceiling quietly
-- gave away more than its ceiling and the console could not see it. A claim is
-- spent when the money arrives; this is the statement that says so.
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
  where payment_id = p_payment
    and case
          -- Paid: any hold that is not already spent, however it was left.
          when p_paid then status <> 'applied'
          -- Released: only a live hold, never a claim that has been paid for.
          else status = 'reserved'
        end;
$fn$;

comment on function public.settle_coupon(uuid, boolean) is
  'Spends or hands back the claim on one payment. Paying settles the claim whatever state its hold was in; releasing only ever touches a still-reserved hold.';

revoke all on function public.settle_coupon(uuid, boolean) from public;
revoke all on function public.settle_coupon(uuid, boolean) from anon, authenticated;
grant execute on function public.settle_coupon(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 6. redeem_bonus_coupon - a credit code has no holds to count
--
-- The two claim counts read `status <> 'released'`, which is 'applied' plus
-- 'reserved'. A credit code is claimed in one statement and written straight in
-- as 'applied', so it has no reservations of its own - but it HAD them: before
-- 0030 a credit code could be typed into a checkout, where validate_coupon read
-- its 500 credits as 500% and reserve_coupon held a claim on it. Any such row
-- left on the live database would still be counted here and would still refuse
-- a genuine claim, on a limit nothing had actually consumed.
--
-- Counting 'applied' is both narrower and exactly right: for this code path a
-- claim and a grant are the same event, in the same transaction, under the same
-- row lock.
--
-- The grant_credits call also had to change, and not for a reason of ours.
-- 0034 added a SIXTH parameter to grant_credits with a default while leaving
-- 0008's five-parameter version in place, so a five-argument call now matches
-- both candidates and Postgres refuses it. Measured against the live database:
--
--   select grant_credits(user, 1, 'admin_topup', null, 'probe')
--     -> ERROR: function public.grant_credits(uuid, integer, unknown, unknown,
--        unknown) is not unique
--
-- which is what this function was doing, so every credit-code claim on the
-- live database currently fails. Naming all six arguments leaves exactly one
-- candidate. The proper repair is to drop the stale five-parameter overload -
-- that belongs to whoever owns 0034, and reward_referral has the same fault
-- and is not repaired here.
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

  select count(*) into v_claims
  from public.coupon_redemptions
  where coupon_id = v_coupon.id and status = 'applied';
  if v_coupon.max_claims is not null and v_claims >= v_coupon.max_claims then
    return jsonb_build_object('ok', false, 'reason', 'all_claimed');
  end if;

  select count(*) into v_mine
  from public.coupon_redemptions
  where coupon_id = v_coupon.id and user_id = p_user and status = 'applied';
  if v_mine >= v_coupon.max_per_user then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  /*
   * The credits, through the same path every other grant takes, so the ledger
   * row and the balance are written by one writer.
   *
   * All six arguments named, including the p_payment 0034 added. Five would
   * match both overloads of grant_credits and be refused outright - see the
   * header. There is no payment: a bonus is claimed, not bought.
   */
  perform public.grant_credits(
    p_user    => p_user,
    p_amount  => v_coupon.value,
    p_reason  => 'coupon_bonus',
    p_actor   => null,
    p_note    => 'Coupon ' || v_coupon.code,
    p_payment => null
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

comment on function public.redeem_bonus_coupon(uuid, text) is
  'Grants a credit_bonus code''s credits and records the claim, in one transaction under the coupon''s row lock. Counts settled claims only: a credit code has no reservation step.';

revoke all on function public.redeem_bonus_coupon(uuid, text) from public;
revoke all on function public.redeem_bonus_coupon(uuid, text) from anon, authenticated;
grant execute on function public.redeem_bonus_coupon(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. coupon_usage - a dead checkout is not consumed supply
--
-- Dropped and recreated rather than replaced: `create or replace view` refuses
-- any change to the column list, and this one grows four.
--
-- `holding` used to count every 'reserved' row there was, and `claims_left`
-- subtracted them. Nothing sweeps them but validate_coupon, so a code with a
-- ceiling read as partly spent - "1 held, 4 left" of 5 - from the moment
-- somebody closed a tab until the next person anywhere on the platform typed
-- any code at all. On a quiet week that is the codes list telling the owner a
-- claim was taken that never was, which is the report he made.
--
-- Now a reservation past coupon_hold_minutes() is `abandoned` rather than
-- `holding`, and only `holding` is subtracted from the ceiling. The same clock
-- the sweep uses, so the screen and the checkout cannot disagree: anything this
-- view calls abandoned is something the next validate_coupon will release.
--
-- credits_given is here because it was being computed in the app, twice, as
-- value x used - once on the codes list and once in the delete warning. It is
-- the coupon's own definition (0029 explains why the ledger cannot answer it)
-- and it belongs on the row that carries `used`, not in two screens that can
-- drift apart.
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
  /* A checkout that could still be paid. */
  count(r.id) filter (
    where r.status = 'reserved'
      and r.created_at >= now() - make_interval(mins => public.coupon_hold_minutes())
  ) as holding,
  /* A checkout nobody came back to. Counted, shown, and charged to nothing. */
  count(r.id) filter (
    where r.status = 'reserved'
      and r.created_at < now() - make_interval(mins => public.coupon_hold_minutes())
  ) as abandoned,
  count(r.id) filter (where r.status = 'released') as handed_back,
  /* How many different people, not how many claims: three claims from one
     account and three from three are a popular code and a farmed one. */
  count(distinct r.user_id) filter (where r.status = 'applied') as accounts,
  coalesce(sum(r.discount_inr) filter (where r.status = 'applied'), 0) as discount_given,
  coalesce(sum(r.amount_inr)   filter (where r.status = 'applied'), 0) as list_total,
  /* The payout of a credit code, in credits, which no rupee column can see. */
  case
    when c.kind = 'credit_bonus'
      then c.value * count(r.id) filter (where r.status = 'applied')
    else 0
  end::numeric as credits_given,
  case
    when c.max_claims is null then null
    else greatest(
      c.max_claims - count(r.id) filter (
        where r.status = 'applied'
          or (r.status = 'reserved'
              and r.created_at >= now() - make_interval(mins => public.coupon_hold_minutes()))
      ), 0)
  end as claims_left
from public.coupons c
left join public.coupon_redemptions r on r.coupon_id = c.id
group by c.id;

comment on view public.coupon_usage is
  'One row per code with what it has cost: claims settled, live holds, abandoned holds, rupees off and credits granted. Only a live hold counts against claims_left.';

-- ---------------------------------------------------------------------------
-- 8. coupon_claim_detail - what was quoted, and what was actually given
--
-- The claims report summed discount_inr over every row, including the holds and
-- the handed-back ones, so an abandoned checkout on a 50%-off code reported
-- Rs 50 "taken off prices" - and the codes list, which has always filtered that
-- sum to 'applied', reported Rs 0 for the same code on the same day. A figure
-- that appears on two screens is a figure that can be wrong on one of them; the
-- one with "claims" in its title was the wrong one.
--
-- So the reward is carried twice, named for what it is. discount_quoted is what
-- the order was opened for, which is the honest thing to show against a hold;
-- discount_given is what came off a payment that settled, which is the only
-- figure a total may be built from. bonus_credits was already settled-only.
--
-- reward_kind and hold_state exist because every screen was deriving them, each
-- in its own dialect. A credit code and a discount code are paid in different
-- units and read on different columns - the mix-up that made a 500-credit grant
-- render as Rs 0 - and a claim's four states are not a status string, they are
-- "given", "in flight", "walked away from" and "handed back". Deriving them here
-- means the report, the CSV and any future screen classify identically.
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
  /* Which unit this claim is paid in. One word, decided once. */
  case when c.kind = 'credit_bonus' then 'credit' else 'discount' end as reward_kind,
  /*
   * What actually happened to the claim.
   *
   *   settled    the money arrived, or the credits were granted
   *   holding    a checkout that could still be paid
   *   abandoned  a reservation past the release window - the next validate
   *              call hands it back, and it counts against nothing
   *   released   already handed back
   *
   * Same clock as coupon_usage and as the sweep, through the same function, so
   * a row this calls abandoned is a row that screen calls abandoned.
   */
  case
    when r.status = 'applied' then 'settled'
    when r.status = 'released' then 'released'
    when r.created_at >= now() - make_interval(mins => public.coupon_hold_minutes())
      then 'holding'
    else 'abandoned'
  end as hold_state,
  /* The reward, in the unit it was paid in - and only where it was paid. */
  case when r.status = 'applied' then r.discount_inr else 0 end::numeric as discount_given,
  /* What the order was opened for. Right thing to show on a hold, wrong thing
     to add up: nobody has paid it and they may never. */
  r.discount_inr as discount_quoted,
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
  'One row per coupon claim: the account, the reward in the unit it was paid in, what was quoted against a hold, and which of settled/holding/abandoned/released the claim is.';

-- ---------------------------------------------------------------------------
-- 9. Who may read them
--
-- security_invoker means these run as the caller, so the underlying tables' own
-- RLS still applies and a view cannot be used to read round it. The explicit
-- revoke is here because Supabase grants anon and authenticated a default
-- select on anything new in public, and PUBLIC is not those roles - a
-- `revoke from public` alone leaves both grants standing.
--
-- coupon_usage was measured with exactly those grants standing before this
-- ran: anon and authenticated held select, insert, update and delete on it,
-- because 0015 created it without a sweep and 0029 only swept the two views it
-- was adding itself. RLS on `coupons` is super-admin-only and the view is
-- security_invoker, so no row was ever readable through it - but the grant had
-- no business existing, and the next view over a table with a laxer policy
-- would have leaked.
-- ---------------------------------------------------------------------------
do $blk$
declare
  v text;
begin
  foreach v in array array[
    'public.coupon_usage',
    'public.coupon_claim_detail',
    'public.referral_claim_detail'
  ] loop
    execute format('revoke all on %s from public', v);
    execute format('revoke all on %s from anon, authenticated', v);
    execute format('grant select on %s to service_role', v);
  end loop;
end $blk$;

-- ---------------------------------------------------------------------------
-- 10. The indexes the claims report reads on
--
-- The report filters by code, by kind, by account, by status and by a date
-- window, and orders newest first. The first two live on `coupons` and are
-- resolved by the join; these cover the rest. Both may already exist from 0015
-- and 0029 - stated here so this file's own reads are not accidentally
-- dependent on a migration that happened to add them for another screen.
-- ---------------------------------------------------------------------------
create index if not exists coupon_redemptions_created_idx
  on public.coupon_redemptions (created_at desc);
create index if not exists coupon_redemptions_status_created_idx
  on public.coupon_redemptions (status, created_at desc);
