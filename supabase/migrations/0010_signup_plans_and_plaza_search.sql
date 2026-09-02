-- ===========================================================================
-- People can sign themselves up, buy a plan, and top up when it runs out.
--
-- Until now an account only existed because an admin made one. That is fine
-- for a handful of colleagues and wrong for a product: the path from "found
-- the site" to "watching a truck" has to work without anyone being asked.
--
-- Four pieces:
--
-- 1. PAYMENTS BUY TWO THINGS. A payment was always a credit pack. It can now
--    also be a plan, which is what a new account buys first. One table, one
--    webhook, one settle function - the kind decides what is handed over.
--
-- 2. PLAZA SEARCH. "Alert me when it reaches this plaza" offered a dropdown of
--    every plaza ever seen, which is unusable past a few dozen and useless for
--    a plaza nobody has crossed yet. Now it is searched, with trigram matching
--    so a near-miss spelling still finds it.
--
-- 3. CREDIT HISTORY THAT READS. Every automatic check was its own ledger line,
--    so a week of tracking buried the top-ups under hundreds of half-credit
--    rows. Money in stays itemised; usage is rolled up per day.
--
-- 4. SITE SETTINGS. Support address, privacy policy, and whether signup is
--    open at all - the things a public site needs and a private tool did not.
--
-- Run after 0009_payments_packs_and_backup.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A payment buys either credits or a plan
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists kind    text not null default 'credits',
  add column if not exists plan_id uuid references public.plans (id) on delete set null,
  add column if not exists months  integer not null default 1;

comment on column public.payments.kind is
  'credits = a pack top-up. plan = buying or renewing a plan, which also hands over that plan''s included credits.';

-- ---------------------------------------------------------------------------
-- settle_payment - hand over whatever was bought, exactly once.
--
-- Replaces credit_payment. Same guard: the update only matches while the row
-- is still 'created', so a webhook delivered twice settles nothing the second
-- time. Kept as one function because both kinds must be idempotent in exactly
-- the same way, and two functions would be two chances to get that wrong.
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
  v_user    uuid;
  v_credits numeric(12, 2);
  v_amount  numeric(10, 2);
  v_kind    text;
  v_plan    uuid;
  v_months  integer;
  v_plan_credits numeric(12, 2);
  v_from    date;
begin
  update public.payments
  set status = 'paid',
      razorpay_payment_id = p_payment_id,
      paid_at = now()
  where razorpay_order_id = p_order_id
    and status = 'created'
  returning user_id, credits, amount_inr, kind, plan_id, months
  into v_user, v_credits, v_amount, v_kind, v_plan, v_months;

  if v_user is null then
    -- Unknown, or already settled. Both are fine to see twice.
    return jsonb_build_object('ok', true, 'granted', false, 'reason', 'not_pending');
  end if;

  if v_kind = 'plan' and v_plan is not null then
    select included_credits into v_plan_credits from public.plans where id = v_plan;

    -- Renewing early should extend, not truncate: count from the later of
    -- today and the existing expiry.
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

    return jsonb_build_object(
      'ok', true, 'granted', true, 'kind', 'plan',
      'credits', coalesce(v_plan_credits, 0), 'user_id', v_user);
  end if;

  perform public.grant_credits(
    v_user, v_credits, 'purchase', null,
    format('Paid %s rupees, order %s', v_amount, p_order_id));

  return jsonb_build_object(
    'ok', true, 'granted', true, 'kind', 'credits',
    'credits', v_credits, 'user_id', v_user);
end $fn$;

revoke all on function public.settle_payment(text, text) from public;
grant execute on function public.settle_payment(text, text) to service_role;

drop function if exists public.credit_payment(text, text);

-- ---------------------------------------------------------------------------
-- 2. Plaza search
--
-- Trigram matching so "nadiad tol" and a misspelt "nadiyad" both find Nadiad
-- Toll Plaza. A plain ILIKE is kept alongside it and scored higher, because an
-- exact substring is always the better answer when it exists.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists toll_plazas_name_trgm_idx
  on public.toll_plazas using gin (name gin_trgm_ops);

create or replace function public.search_plazas(
  p_q     text default null,
  p_limit integer default 20
)
returns table (name text, seen_count integer, score real)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    p.name,
    p.seen_count,
    case
      when p_q is null or btrim(p_q) = '' then 0::real
      when p.name ilike '%' || btrim(p_q) || '%' then 1::real
      else similarity(p.name, btrim(p_q))
    end as score
  from public.toll_plazas p
  where
    p_q is null
    or btrim(p_q) = ''
    or p.name ilike '%' || btrim(p_q) || '%'
    or similarity(p.name, btrim(p_q)) > 0.15
  order by score desc, p.seen_count desc, p.name
  limit greatest(coalesce(p_limit, 20), 1);
$fn$;

revoke all on function public.search_plazas(text, integer) from public;
-- Granted to service_role only. An earlier version of this line also named
-- `authenticated`, on the assumption that the browser would call this directly.
-- It never has - every .rpc() in this codebase goes through the server-side
-- service client - so the grant only widened the attack surface, and
-- 0025_security_hardening.sql revoked it again on every run. Removed here so
-- the file says what is actually intended.
grant execute on function public.search_plazas(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Credit history that a person can read
--
-- Money in stays one row each - those are the entries someone actually looks
-- for. Usage is grouped per day and per kind, so a week of half-credit checks
-- is seven lines instead of seven hundred.
-- ---------------------------------------------------------------------------
drop view if exists public.credit_activity;
create view public.credit_activity with (security_invoker = on) as
select
  c.user_id,
  c.created_at,
  (c.created_at at time zone 'Asia/Kolkata')::date as activity_date,
  c.reason,
  c.delta as amount,
  c.balance_after,
  c.truck_number,
  c.note,
  1::bigint as entries,
  false as is_rollup
from public.credit_transactions c
where c.delta > 0
union all
select
  c.user_id,
  max(c.created_at) as created_at,
  (c.created_at at time zone 'Asia/Kolkata')::date as activity_date,
  c.reason,
  sum(c.delta) as amount,
  -- The balance after the last movement of that day, which is the one a
  -- reader is checking against.
  (array_agg(c.balance_after order by c.id desc))[1] as balance_after,
  null::text as truck_number,
  null::text as note,
  count(*)::bigint as entries,
  true as is_rollup
from public.credit_transactions c
where c.delta < 0
group by c.user_id, (c.created_at at time zone 'Asia/Kolkata')::date, c.reason;

comment on view public.credit_activity is
  'Credit history for people: top-ups itemised, usage rolled up per day and kind. credit_transactions remains the exact record.';

-- ---------------------------------------------------------------------------
-- 4. Site settings
--
-- A private tool needed none of this. A site anyone can sign up to needs a way
-- to be contacted and a policy to point at.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('brand_name',      '"Truck Watch"'::jsonb),
  ('signup_enabled',  'true'::jsonb),
  ('support_email',   '""'::jsonb),
  ('support_phone',   '""'::jsonb),
  ('support_address', '""'::jsonb),
  ('privacy_url',     '""'::jsonb),
  ('terms_url',       '""'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. A self-service account starts with no plan and no credits
--
-- The trigger from 0008 handed every new profile the default plan and its
-- credits. That was right when only an admin could create one; it is wrong now
-- that anyone can sign up, because it would give the plan away for free.
--
-- Signing up now gets you an account. Buying a plan gets you the plan and its
-- credits, through settle_payment above. An admin can still assign one by hand
-- from the account's own page.
-- ---------------------------------------------------------------------------
drop trigger if exists assign_default_plan_trg on public.profiles;
drop function if exists public.assign_default_plan();
