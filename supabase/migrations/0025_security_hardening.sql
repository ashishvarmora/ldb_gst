-- ===========================================================================
-- Shutting the front door.
--
-- Every earlier migration ends its security-definer functions with
--
--     revoke all on function public.grant_credits(...) from public;
--     grant execute on function public.grant_credits(...) to service_role;
--
-- and every one of them has been wrong since the day it was written. PUBLIC is
-- the pseudo-role that means "everyone by default". It is not the role `anon`
-- and it is not the role `authenticated`. Supabase ships a default privilege in
-- this schema -
--
--     alter default privileges in schema public
--       grant execute on functions to anon, authenticated, service_role;
--
-- - so the moment any of those functions was created, Postgres wrote an
-- EXPLICIT grant to anon and to authenticated into its ACL. Revoking from
-- PUBLIC never touched those two, and `grant ... to service_role` read like the
-- function had been narrowed when nothing had been narrowed at all.
--
-- What that meant in practice, verified against this database over PostgREST
-- with nothing but the anon key that ships inside the browser bundle:
--
--     POST /rest/v1/rpc/grant_credits
--     { "p_user": "<any account>", "p_amount": 1000000, "p_reason": "purchase" }
--
-- Anyone at all could mint themselves any number of credits. settle_payment
-- would hand over a pack for an order nobody had paid for; spend_credits would
-- empty a stranger's balance; purge_officer_data would delete their history.
-- None of it needed an account.
--
-- 0022 is the one file that got it right - `revoke all ... from public, anon,
-- authenticated` - and redeem_bonus_coupon is correspondingly the one function
-- the probe could not reach. This migration applies that same treatment to
-- every other one, and then changes the schema default so the next function
-- somebody writes does not quietly inherit the same hole.
--
-- Also here, because they are the other half of the same question - how does an
-- account end up holding credits nobody paid for:
--
--   * a rate_limits table and rate_limit_hit(), so the app can throttle sign-in,
--     sign-up, password resets, checkout and code redemption across all the
--     serverless instances it happens to be running on;
--   * reserve_coupon takes the coupon's row lock before it counts claims, which
--     it never did - two checkouts could both spend the last claim of a
--     single-use code;
--   * reward_referral serialises on the referrer and is backed by a unique
--     index, because two referred people paying at the same moment could each
--     see "no milestone paid yet" and both pay it;
--   * truck_alerts may no longer be pointed at somebody else's truck.
--
-- Run after 0024_admin_analytics.sql.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Stop the schema handing EXECUTE to the world by default
--
-- This is the root cause, so it is fixed before anything else. From here on a
-- newly created function in public is reachable by service_role and by the
-- owner only, and a function that genuinely wants to be called from a browser
-- session has to say so with its own explicit grant. That is the right way
-- round: a grant somebody had to type is a decision, an inherited one is an
-- accident.
--
-- Only the `postgres` grantor's default is changed, because that is the role
-- migrations run as and therefore the one that will create everything after
-- this line.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Take EXECUTE back off everything that moves money, spends credits or
--    deletes history
--
-- Written as a sweep over every SECURITY DEFINER function in the schema rather
-- than as a list of the ones known to be dangerous today. A list is a thing to
-- forget to add to, and the whole failure being fixed here is somebody writing
-- a revoke that looked right; the next money function to be added would inherit
-- the same grant and nobody would notice, because nothing about the ACL is
-- visible from the migration that created it.
--
-- SECURITY DEFINER is the right thing to sweep on. It means "run this with the
-- owner's rights, not the caller's" - which is the entire reason these
-- functions can move money at all, and therefore the entire reason it matters
-- who may call them. A function without it can only do what the caller could
-- already do for themselves.
--
-- Matching on the whole set also survives signature drift. spend_credits gained
-- p_truck and purge_entity gained p_user since they were written, and a revoke
-- aimed at an old signature fails in the way that matters: quietly, leaving the
-- old grant in place.
--
-- WHAT IS KEPT, and why each exception is safe - checked against this database
-- rather than assumed:
--
--   is_super_admin  Every RLS policy in the schema calls it, and a policy is
--                   evaluated as the role running the query. Revoke this and
--                   every officer loses access to their own rows. Confirmed by
--                   reading all thirty policy expressions: auth.uid() and
--                   is_super_admin() are the only functions any of them names.
--
--   trigger and event_trigger bodies  handle_new_user, rls_auto_enable and the
--                   like. EXECUTE on a trigger function is checked when the
--                   trigger is created, not when it fires, and PostgREST will
--                   not expose a function returning trigger. Excluded by return
--                   type so nothing depends on remembering their names.
--
-- Views were the other thing worth checking, since a security_invoker view runs
-- its body as the reader. Per pg_depend the only public functions any view
-- calls are ist_today and credit_source, and neither is SECURITY DEFINER, so
-- this sweep cannot break one.
--
-- Everything it does revoke is called through the service-role client and only
-- through it: credits.ts, coupons.ts, backup.ts, manual-search.ts,
-- checkout-actions.ts, the Razorpay webhook, portal/trucks/actions.ts and the
-- admin pages all build their client with getSupabaseAdmin().
-- ---------------------------------------------------------------------------
do $blk$
declare
  fn      record;
  v_fixed text[] := '{}';
begin
  for fn in
    select p.oid::regprocedure::text as sig, p.proname, p.proacl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      -- See above: a trigger body is not callable and is not a hole.
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      -- The one function the row-level security policies themselves depend on.
      and p.proname <> 'is_super_admin'
  loop
    -- Only worth reporting the ones that actually had a grant to take away, so
    -- a re-run of this file is quiet rather than repeating the whole schema.
    if has_function_privilege('anon', fn.sig, 'EXECUTE')
       or has_function_privilege('authenticated', fn.sig, 'EXECUTE') then
      v_fixed := v_fixed || fn.proname;
    end if;

    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;

  if array_length(v_fixed, 1) is not null then
    raise notice 'EXECUTE taken back from anon/authenticated on: %',
      array_to_string(v_fixed, ', ');
  else
    raise notice 'No security-definer function was reachable by anon or authenticated.';
  end if;
end $blk$;


-- ---------------------------------------------------------------------------
-- 3. Rate limiting that survives more than one serverless instance
--
-- The app runs on Vercel, where every request may land on a fresh instance with
-- its own empty memory. An in-process counter there stops a hot loop hitting
-- one instance and nothing else, which is worth having but is not a limit. This
-- table is the shared one: a fixed window per (bucket, identity), counted in the
-- database so that ten instances answering a password-spray see one number
-- between them.
--
-- A fixed window rather than a sliding one on purpose. A sliding window needs
-- either a row per hit or a sorted structure, and the worst a fixed window
-- allows is a double burst across a boundary - which is a rounding error next
-- to the difference between "some limit" and "none".
--
-- identity is whatever the caller decided to count: an IP for sign-up, an email
-- address for sign-in, an account id for checkout. It is never read back, only
-- matched, so an address sitting here is not a lookup table of who has an
-- account: rows are written for addresses that do not exist either, and they
-- are swept within the day.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket            text not null,
  identity          text not null,
  window_started_at timestamptz not null default now(),
  hits              integer not null default 0,
  primary key (bucket, identity)
);

create index if not exists rate_limits_window_idx
  on public.rate_limits (window_started_at);

comment on table public.rate_limits is
  'One counter per (bucket, identity) for a fixed time window. Written only by rate_limit_hit(); nothing else reads it. Swept of rows older than a day as it goes.';

/*
 * Nobody but the service role has any business here - not to read it, and
 * certainly not to reset their own counter. RLS with no policy already denies
 * every authenticated request, and the revoke makes the intent explicit rather
 * than leaving it to be inferred from an absence.
 */
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(
  p_bucket         text,
  p_identity       text,
  p_limit          integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_window integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_limit  integer := greatest(coalesce(p_limit, 1), 1);
  v_ident  text    := left(btrim(coalesce(p_identity, '')), 200);
  v_start  timestamptz;
  v_hits   integer;
begin
  /*
   * Nothing to count. Happens when a header the caller hoped for was absent -
   * no x-forwarded-for, say - and the honest answer is to let the request
   * through rather than to lump every such caller into one shared bucket, which
   * would be a denial-of-service switch anyone could flip by stripping a header.
   */
  if coalesce(btrim(coalesce(p_bucket, '')), '') = '' or v_ident = '' then
    return jsonb_build_object('allowed', true, 'remaining', v_limit, 'retry_after', 0);
  end if;

  /*
   * The whole thing is one statement, which is what makes it a limit at all.
   * Two requests arriving together contend on the primary key: the second waits
   * for the first to commit and then reads its count, so neither can decide it
   * was the only one asking.
   *
   * An expired window is reset in the same breath rather than by a separate
   * pass, because a separate pass is a second place for the window to be wrong.
   */
  insert into public.rate_limits as rl (bucket, identity, window_started_at, hits)
  values (p_bucket, v_ident, now(), 1)
  on conflict (bucket, identity) do update
    set hits = case
                 when rl.window_started_at < now() - make_interval(secs => v_window) then 1
                 else rl.hits + 1
               end,
        window_started_at = case
                 when rl.window_started_at < now() - make_interval(secs => v_window) then now()
                 else rl.window_started_at
               end
  returning rl.window_started_at, rl.hits into v_start, v_hits;

  /*
   * Swept here rather than from a scheduled job, so the table cannot grow
   * without bound on a deployment where nobody remembered to schedule anything.
   * One call in a thousand pays for it, and a day is long after the longest
   * window in use.
   */
  if random() < 0.001 then
    delete from public.rate_limits where window_started_at < now() - interval '1 day';
  end if;

  if v_hits > v_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      -- Whole seconds, rounded up and never zero: a retry_after of 0 reads as
      -- "try again now", which is the one thing this is refusing.
      'retry_after', greatest(
        ceil(extract(epoch from (v_start + make_interval(secs => v_window)) - now()))::integer, 1));
  end if;

  return jsonb_build_object(
    'allowed', true,
    'remaining', v_limit - v_hits,
    'retry_after', 0);
end $fn$;

revoke all on function public.rate_limit_hit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;

comment on function public.rate_limit_hit(text, text, integer, integer) is
  'Counts one hit against (bucket, identity) in a fixed window and says whether it is allowed. Returns {allowed, remaining, retry_after}. The caller fails open if this errors - a broken limiter must not lock real people out.';


-- ---------------------------------------------------------------------------
-- 4. reserve_coupon holds the coupon still while it counts
--
-- The old body asked validate_coupon whether there was a claim left and then
-- inserted one. Nothing sat between those two steps, so two checkouts opened at
-- the same instant both read "one claim left" and both took it. Same for
-- max_per_user, from two tabs.
--
-- The fix is the lock 0022 already uses for bonus codes: take the coupon's own
-- row before counting anything. A second caller then waits at that line, and by
-- the time it counts, the first caller's reservation is committed and visible.
--
-- The lock is taken on the coupon rather than on the redemptions, because there
-- is no redemption row yet to lock - which is exactly the shape of problem a
-- row lock on the parent is for.
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
  v      jsonb;
  v_held uuid;
begin
  -- An unknown code locks nothing and falls through to validate_coupon, which
  -- is the one place allowed to word the refusal.
  select id into v_held
  from public.coupons
  where code = upper(btrim(coalesce(p_code, '')))
  for update;

  v := public.validate_coupon(p_code, p_user, p_amount, p_kind);
  if not (v ->> 'ok')::boolean then return v; end if;

  insert into public.coupon_redemptions
    (coupon_id, user_id, payment_id, status, amount_inr, discount_inr)
  values (
    (v ->> 'coupon_id')::uuid, p_user, p_payment, 'reserved',
    p_amount, (v ->> 'discount_inr')::numeric);

  return v;
end $fn$;

revoke all on function public.reserve_coupon(text, uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.reserve_coupon(text, uuid, uuid, numeric, text) to service_role;


-- ---------------------------------------------------------------------------
-- 5. The referral milestone is paid once, under contention as well as on paper
--
-- reward_referral locks the referral it is rewarding, which stops one referral
-- being paid twice. It never locked the REFERRER, and the milestone is a
-- property of the referrer: "have five of the people you invited paid, and have
-- you had the bonus yet".
--
-- So two different referred people paying in the same second took two different
-- referral locks, both counted five, both saw no milestone row, and both were
-- paid the bonus. Nothing about that is far-fetched on a launch day or at the
-- end of a campaign, which is precisely when it would happen.
--
-- Two changes. The referrer's own profile row is locked before the count, so
-- the second transaction waits and then sees the first one's ledger row. And a
-- unique index makes a second milestone row impossible even if some future
-- caller forgets the lock - caught rather than raised, because a settled
-- payment must not be rolled back over a bonus that was already paid.
-- ---------------------------------------------------------------------------
create unique index if not exists credit_transactions_one_referral_milestone
  on public.credit_transactions (user_id)
  where reason = 'referral_milestone';

create or replace function public.reward_referral(
  p_user   uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_referrer  uuid;
  v_percent   numeric;
  v_reward    numeric(12, 2);
  v_need      integer;
  v_bonus     numeric;
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
   * Everything below is about the referrer rather than about this one referral,
   * so this is where the transactions have to queue. Taken before the reward is
   * granted, not just before the milestone check, so that the count and the
   * "has it been paid" test below cannot straddle another transaction's commit.
   */
  select id into v_lock from public.profiles where id = v_referrer for update;

  select coalesce((value #>> '{}')::numeric, 0) into v_percent
  from public.app_settings where key = 'referral_percent';

  v_reward := floor(coalesce(p_amount, 0) * coalesce(v_percent, 0) / 100);

  update public.referrals
  set status = 'rewarded',
      reward_credits = v_reward,
      first_amount = p_amount,
      rewarded_at = now()
  where referred_id = p_user and status = 'pending';

  if v_reward > 0 then
    perform public.grant_credits(
      v_referrer, v_reward, 'referral', null,
      format('Referral reward, %s%% of a %s rupee payment', v_percent, p_amount));
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
       * The index is the backstop, and it is caught rather than allowed to
       * propagate. A duplicate here means the bonus has already been paid,
       * which is not a reason to fail the payment that was being settled -
       * somebody's credits would go missing over a bonus they already had.
       */
      begin
        perform public.grant_credits(
          v_referrer, v_bonus, 'referral_milestone', null,
          format('Bonus for %s referrals who paid', v_qualified));

        return jsonb_build_object(
          'ok', true, 'rewarded', true, 'credits', v_reward,
          'milestone', v_bonus, 'referrer', v_referrer);
      exception when unique_violation then
        raise log 'reward_referral: milestone for % was already paid, skipping', v_referrer;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'rewarded', true, 'credits', v_reward, 'referrer', v_referrer);
end $fn$;

revoke all on function public.reward_referral(uuid, numeric) from public, anon, authenticated;
grant execute on function public.reward_referral(uuid, numeric) to service_role;


-- ---------------------------------------------------------------------------
-- 6. An alert may only watch a truck you actually own
--
-- truck_alerts_owner checked user_id = auth.uid() and stopped there. The row
-- being yours is not the same as the TRUCK being yours: tracked_truck_id was
-- unchecked, so a row with your own user_id could point at somebody else's
-- lorry, and the worker would then deliver you their movements. Nothing in the
-- app does this - every write goes through the service-role client from the
-- truck page - but the policy is what stands between a hand-made PostgREST
-- request and another operator's fleet.
--
-- Written as a separate policy per command rather than one FOR ALL, because
-- SELECT has no WITH CHECK and folding the two together would make reading a
-- row conditional on a join that only matters when writing one.
-- ---------------------------------------------------------------------------
drop policy if exists truck_alerts_owner on public.truck_alerts;
drop policy if exists truck_alerts_owner_read on public.truck_alerts;
drop policy if exists truck_alerts_owner_write on public.truck_alerts;

create policy truck_alerts_owner_read on public.truck_alerts
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

create policy truck_alerts_owner_write on public.truck_alerts
  for all to authenticated
  using (
    (user_id = auth.uid() and exists (
       select 1 from public.tracked_trucks t
       where t.id = truck_alerts.tracked_truck_id and t.user_id = auth.uid()))
    or public.is_super_admin())
  with check (
    (user_id = auth.uid() and exists (
       select 1 from public.tracked_trucks t
       where t.id = truck_alerts.tracked_truck_id and t.user_id = auth.uid()))
    or public.is_super_admin());


-- ---------------------------------------------------------------------------
-- 7. The sweep: RLS on, everywhere, and a note about what has no policy
--
-- Belt and braces over the ensure_rls event trigger, which only fires on CREATE
-- TABLE - a table whose RLS was switched off by hand afterwards would not be
-- caught by it. Idempotent, and a no-op on a database that is already correct.
--
-- A table with RLS enabled and no policy at all is DENIED to anon and
-- authenticated, which is the safe direction and is deliberate for
-- retention_rules and rate_limits - both are admin-only and read through the
-- service role. The notice exists so that fact is visible at migration time
-- rather than discovered later as a mystery empty screen.
-- ---------------------------------------------------------------------------
do $blk$
declare
  t record;
  v_missing text[] := '{}';
  v_bare    text[] := '{}';
begin
  for t in
    select c.oid, c.relname, c.relrowsecurity,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    if not t.relrowsecurity then
      execute format('alter table public.%I enable row level security', t.relname);
      v_missing := v_missing || t.relname;
    end if;
    if t.policies = 0 then
      v_bare := v_bare || t.relname;
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise notice 'Row level security was OFF and has been switched on for: %',
      array_to_string(v_missing, ', ');
  end if;
  if array_length(v_bare, 1) is not null then
    raise notice 'RLS on with no policy (service role only, by design): %',
      array_to_string(v_bare, ', ');
  end if;
end $blk$;
