-- ===========================================================================
-- The top of the credit ladder stops being a rung.
--
-- The packs are fixed amounts: 100, 500, 5,000. Someone who wants 7,500 has to
-- either buy the 5,000 and top up again, or overshoot to 10,000. The ladder
-- should end in a rule rather than a wall.
--
-- So a pack can be OPEN ENDED: the price becomes a minimum, the buyer types
-- any amount at or above it, and the credits are worked out from two numbers
-- the admin sets:
--
--   credits_per_rupee   the base rate, "1 rupee = N credits". Default 1.
--   bonus_percent       what this tier adds on top. 25 means 25% more credits
--                       for the same money.
--
-- A fixed pack keeps its explicit credits column and ignores both, so the
-- named rungs stay exactly what the admin typed and only the open tier is
-- computed. Two ways of pricing, but only one of them applies to any row.
--
-- Run after 0011_revisits_count.sql.
-- ===========================================================================

alter table public.credit_packs
  add column if not exists is_open_ended boolean not null default false,
  add column if not exists bonus_percent numeric(6, 2) not null default 0;

alter table public.credit_packs
  drop constraint if exists credit_packs_bonus_percent_check;
alter table public.credit_packs
  add constraint credit_packs_bonus_percent_check
  check (bonus_percent >= 0 and bonus_percent <= 1000);

comment on column public.credit_packs.is_open_ended is
  'True: price_inr is a minimum and the buyer names the amount, with credits computed from credits_per_rupee and bonus_percent. False: the credits column is what they get.';

comment on column public.credit_packs.bonus_percent is
  'Extra credits on an open-ended tier, as a percentage. Ignored on a fixed pack, whose credits are stated outright.';

-- The base conversion. Their own example: 100 rupees buys 100 credits.
insert into public.app_settings (key, value) values
  ('credits_per_rupee', '1'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Turn the largest seeded pack into the open tier, at 25%.
--
-- Guarded so it only fires while the ladder is still untouched: once an admin
-- has edited the packs, re-running the migration must not silently reshape
-- their pricing.
-- ---------------------------------------------------------------------------
update public.credit_packs
set is_open_ended = true,
    bonus_percent = 25,
    name = 'Custom amount',
    price_inr = 5000
where name = 'Maximum'
  and not exists (select 1 from public.credit_packs where is_open_ended);

-- The rungs between the entry pack and the open tier are now redundant: the
-- open tier covers everything from 5,000 up, at a better rate than either.
delete from public.credit_packs
where name in ('Bulk', 'Bulk+')
  and exists (select 1 from public.credit_packs where is_open_ended);

-- ---------------------------------------------------------------------------
-- credits_for_amount - the one place the sum is done.
--
-- The checkout, the admin preview and the buyer's own screen all have to agree
-- on what a number of rupees buys, and three copies of a rounding rule is
-- three chances to disagree about someone's money.
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
  v_bonus   numeric(6, 2);
  v_rate    numeric(10, 4);
begin
  select is_open_ended, price_inr, credits, bonus_percent
  into v_open, v_price, v_credits, v_bonus
  from public.credit_packs
  where id = p_pack and is_active;

  if v_price is null then return null; end if;

  -- A fixed rung is worth what it says, whatever is typed alongside it.
  if not v_open then return v_credits; end if;

  if p_amount is null or p_amount < v_price then return null; end if;

  select coalesce((value #>> '{}')::numeric, 1) into v_rate
  from public.app_settings where key = 'credits_per_rupee';

  -- Rounded down: never hand over a fraction of a credit that was not paid for.
  return floor(p_amount * coalesce(v_rate, 1) * (1 + v_bonus / 100));
end $fn$;

revoke all on function public.credits_for_amount(uuid, numeric) from public;
grant execute on function public.credits_for_amount(uuid, numeric) to authenticated, service_role;
