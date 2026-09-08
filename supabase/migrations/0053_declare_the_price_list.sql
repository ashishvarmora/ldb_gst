-- ===========================================================================
-- The price list, DECLARED rather than patched into shape.
--
-- A fresh database could not reproduce the live one. Found while writing the
-- user guide, which reads its figures from the database and so had to be
-- checked against what a clean install would actually seed.
--
-- The credit packs had been built up by five migrations of corrective UPDATEs,
-- and 0041's - the ones that produce today's ladder - are guarded on rows that
-- no migration ever creates. Its Small pack matches `name = 'mini' and
-- price_inr = 199`; nothing in this repository has ever inserted a pack called
-- 'mini'. It exists on the live database because it was renamed there. So on a
-- clean install those updates match nothing, silently, and the seeded ladder
-- from 0035 survives: Starter 500 to 750, Standard 2000 to 3600, an open tier
-- at 10,000 and 250%, and no 149 pack at all. Wrong prices, wrong rates, no
-- error. app_settings.inactive_pause_hours came out at 72 the same way.
--
-- That is a disaster-recovery hole of exactly the kind 0008 had: everything
-- looks right until the day you need to rebuild, which is the worst possible
-- day to discover it.
--
-- THE FIX IS TO STOP PATCHING. A chain of "update the row that looks like
-- this" only converges if every earlier state is known, and after fifty files
-- it is not. This migration states the intended end state instead: five packs
-- and two settings, matched on the names the app actually uses, so the live
-- database and a database built from nothing arrive at the same place. It is
-- the last word on the subject by construction - it runs last.
--
-- Deliberately NOT deleting the packs it does not name. A pack a payment
-- points at must keep existing or the receipt loses what it bought, so
-- anything else is retired rather than removed. Nothing here touches a price
-- that has already been charged: payments carry their own amount_inr and
-- credits.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The five packs on sale
-- ---------------------------------------------------------------------------
do $blk$
declare
  r record;
begin
  for r in
    select *
    from (values
      ('Small',      149::numeric,   300::numeric, false, 100::numeric,  5),
      ('Starter',    499::numeric,  1000::numeric, false, 100::numeric, 10),
      ('Standard',   999::numeric,  2500::numeric, false, 100::numeric, 20),
      ('Plus',      2499::numeric,  7000::numeric, false, 100::numeric, 30),
      -- The open tier: any amount from its minimum up, at 300% of the rupees.
      -- `credits` is a placeholder the app never reads for an open pack; it is
      -- set to the value the minimum buys so a stale reader cannot mislead.
      ('Any amount', 3000::numeric, 9000::numeric, true,  300::numeric, 40)
    ) as v(name, price_inr, credits, is_open_ended, credit_percent, sort_order)
  loop
    update public.credit_packs
    set price_inr      = r.price_inr,
        credits        = r.credits,
        is_open_ended  = r.is_open_ended,
        credit_percent = r.credit_percent,
        sort_order     = r.sort_order,
        is_active      = true,
        updated_at     = now()
    where name = r.name;

    if not found then
      insert into public.credit_packs
        (name, price_inr, credits, is_open_ended, credit_percent, sort_order, is_active)
      values
        (r.name, r.price_inr, r.credits, r.is_open_ended, r.credit_percent, r.sort_order, true);
    end if;
  end loop;
end $blk$;

/*
 * Everything else stops being offered.
 *
 * Retired, never deleted: payments.pack_id points at these rows, and a receipt
 * that cannot say what it bought is worse than a price list with a dead row in
 * it. The seeded names from 0009/0012/0035 that this replaces are covered by
 * the NOT IN, whatever they happen to be called.
 */
update public.credit_packs
set is_active = false, updated_at = now()
where is_active
  and name not in ('Small', 'Starter', 'Standard', 'Plus', 'Any amount');

-- ---------------------------------------------------------------------------
-- Two settings that a rebuild got wrong
-- ---------------------------------------------------------------------------
/*
 * The no-movement window. 0027 seeded 72 hours and the owner set 8; a rebuild
 * would have gone back to 72, which is three days of a parked lorry being
 * checked every fifteen minutes at a credit a check - about 6,900 credits
 * spent proving it has not moved.
 *
 * Written only when it still holds the seeded 72, so an operator who has since
 * chosen their own number keeps it. That is the difference between declaring an
 * end state and overwriting an operator.
 */
update public.app_settings
set value = '8'::jsonb, updated_at = now()
where key = 'inactive_pause_hours' and value = '72'::jsonb;

insert into public.app_settings (key, value)
values ('inactive_pause_hours', '8'::jsonb)
on conflict (key) do nothing;

-- Both actions cost one credit. Stated here for the same reason as the packs:
-- 0041 sets it, but only by updating a row whose earlier value it assumes.
update public.credit_rates set units_per_credit = 1, updated_at = now()
where action in ('manual_search', 'auto_check') and units_per_credit <> 1;
