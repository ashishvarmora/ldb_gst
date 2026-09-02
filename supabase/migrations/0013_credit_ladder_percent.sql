-- ===========================================================================
-- Say the rate the way the owner says it.
--
-- The open tier stored a "bonus": 25 meant 25% on top of the base rate. But
-- the ladder is written and spoken as a share of the money - "3,000 or more
-- gets 250% credit, so 3,000 rupees is 7,500 credits". Storing 150 to mean
-- 250% is a translation the admin has to do in their head every time they
-- touch it, and translations in the head are where pricing mistakes come from.
--
-- So the column becomes credit_percent, and it means exactly what it says:
--
--     credits = rupees x credits_per_rupee x credit_percent / 100
--
-- 100 is one credit per rupee. 250 is two and a half. Nothing to convert.
--
-- Run after 0012_open_credit_tier.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. bonus_percent -> credit_percent
--
-- Existing rows carried a bonus on top of 100%, so 25 becomes 125. Guarded by
-- the column's existence rather than by a value check, because a re-run must
-- not add another 100 to a column that has already been converted.
-- ---------------------------------------------------------------------------
do $blk$
declare
  v_old boolean;
  v_new boolean;
begin
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'credit_packs'
                   and column_name = 'bonus_percent') into v_old;
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'credit_packs'
                   and column_name = 'credit_percent') into v_new;

  if v_old and not v_new then
    -- The upgrade path: rename, and lift the stored number from a bonus on
    -- top of 100% to the whole share, so 25 becomes 125.
    alter table public.credit_packs rename column bonus_percent to credit_percent;
    update public.credit_packs set credit_percent = credit_percent + 100;

  elsif v_old and v_new then
    -- Both present, which happens on every re-run: 0012 adds bonus_percent
    -- back with `if not exists`, having no idea this file renamed it away.
    -- The resurrected column holds nothing anyone wrote, so it just goes.
    alter table public.credit_packs drop column bonus_percent;
  end if;
end $blk$;

alter table public.credit_packs
  add column if not exists credit_percent numeric(7, 2) not null default 100;

-- A renamed column keeps the old column's default, and the old one was 0 - a
-- bonus of nothing. As a percentage of the money, 0 means "no credits at all",
-- which the constraint below rightly refuses. Set it explicitly so a row
-- inserted without the column still lands at one credit per rupee.
alter table public.credit_packs
  alter column credit_percent set default 100;

alter table public.credit_packs
  drop constraint if exists credit_packs_bonus_percent_check;
alter table public.credit_packs
  drop constraint if exists credit_packs_credit_percent_check;
alter table public.credit_packs
  add constraint credit_packs_credit_percent_check
  check (credit_percent > 0 and credit_percent <= 10000);

comment on column public.credit_packs.credit_percent is
  'Open tiers only: what share of the money becomes credits, against the base rate. 100 = one credit per rupee, 250 = two and a half. A fixed rung states its credits outright and ignores this.';

-- ---------------------------------------------------------------------------
-- 2. The ladder as the owner wrote it
--
-- Only applied while the packs are still the seeded ones. Once an admin has
-- priced their own, re-running this migration must not overwrite their work,
-- so every statement is keyed to the name it is replacing.
-- ---------------------------------------------------------------------------
update public.credit_packs
set price_inr = 100, credits = 100, credit_percent = 100, is_open_ended = false, sort_order = 10
where name = 'Starter' and price_inr = 100 and credits = 200;

update public.credit_packs
set price_inr = 500, credits = 1200, credit_percent = 100, is_open_ended = false, sort_order = 20
where name = 'Standard' and price_inr = 500 and credits = 1100;

insert into public.credit_packs (name, price_inr, credits, sort_order, is_open_ended)
values ('Plus', 1000, 2500, 30, false)
on conflict (name) do nothing;

-- The open tier: 3,000 or more, at 250%.
update public.credit_packs
set price_inr = 3000, credit_percent = 250, is_open_ended = true, sort_order = 40,
    -- credits is not-null and must stay positive; on an open tier it is only a
    -- placeholder, so it holds what the minimum buys.
    credits = 7500
where name = 'Custom amount';

insert into public.credit_packs (name, price_inr, credits, sort_order, is_open_ended, credit_percent)
values ('Custom amount', 3000, 7500, 40, true, 250)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. One place the sum is done
-- ---------------------------------------------------------------------------
create or replace function public.credits_for_amount(
  p_pack   uuid,
  p_amount numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_open    boolean;
  v_price   numeric(10, 2);
  v_credits numeric(12, 2);
  v_percent numeric(7, 2);
  v_rate    numeric(10, 4);
begin
  select is_open_ended, price_inr, credits, credit_percent
  into v_open, v_price, v_credits, v_percent
  from public.credit_packs
  where id = p_pack and is_active;

  if v_price is null then return null; end if;

  -- A fixed rung is worth what it says, whatever is typed alongside it.
  if not v_open then return v_credits; end if;

  if p_amount is null or p_amount < v_price then return null; end if;

  select coalesce((value #>> '{}')::numeric, 1) into v_rate
  from public.app_settings where key = 'credits_per_rupee';

  -- Rounded down: never hand over a fraction of a credit nobody paid for.
  return floor(p_amount * coalesce(v_rate, 1) * coalesce(v_percent, 100) / 100);
end $fn$;

revoke all on function public.credits_for_amount(uuid, numeric) from public;
-- Granted to service_role only. An earlier version of this line also named
-- `authenticated`, on the assumption that the browser would call this directly.
-- It never has - every .rpc() in this codebase goes through the server-side
-- service client - so the grant only widened the attack surface, and
-- 0025_security_hardening.sql revoked it again on every run. Removed here so
-- the file says what is actually intended.
grant execute on function public.credits_for_amount(uuid, numeric) to service_role;
