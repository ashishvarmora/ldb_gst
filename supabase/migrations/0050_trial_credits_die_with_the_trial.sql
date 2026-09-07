-- ===========================================================================
-- Trial credits are not lifetime credits. When the trial ends they are gone.
--
-- The rule, as decided: "Destroy remaining trial credits. Trial credits exist
-- only during the trial period. They should not be frozen. They should not
-- become usable later. They should not be restored after purchasing a plan.
-- Only purchased credits are lifetime credits."
--
-- Until now spend_credits() refused to spend them - reason 'trial_ended' - but
-- left the number sitting on the row. That is "frozen", which is exactly what
-- was ruled out, and it reads badly: an officer sees 50 credits on their
-- account and every action refused, with the balance still promising something.
--
-- So the balance is zeroed, once, when the trial has ended, and it is written
-- THROUGH THE LEDGER rather than by touching profiles.credits directly. Every
-- other movement in this system is explained by a credit_transactions row, and
-- a balance that drops by 50 with no row against it is the one thing an audit
-- cannot answer. grant_credits() is the only sanctioned writer, so a negative
-- grant is how a reversal is recorded.
--
-- WHO IS AFFECTED, precisely: an account whose plan is a trial, whose trial has
-- expired, that has never made a paid payment, and that still holds credits.
-- The "never paid" test is the escape - and it is the same predicate
-- spend_credits() and start_free_trial() already use, so the three cannot
-- disagree about who is a trial user. An account that bought anything owns its
-- balance like any other customer and is never swept.
-- ===========================================================================

create or replace function public.expire_trial_credits()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r         record;
  v_taken   numeric(12, 2) := 0;
  v_accounts integer := 0;
begin
  for r in
    select p.id, p.credits
    from public.profiles p
    join public.plans pl on pl.id = p.plan_id
    where pl.is_trial
      and p.plan_expires_on is not null
      and p.plan_expires_on < public.ist_today()
      and p.credits > 0
      /*
       * Never paid. An account that bought anything - a plan, a top-up, even a
       * cash receipt an admin recorded - owns its balance and is not a trial
       * user any more, whatever plan row it still points at.
       */
      and not exists (
        select 1 from public.payments pay
        where pay.user_id = p.id and pay.status = 'paid'
      )
  loop
    /*
     * A negative grant, so the ledger explains the drop. grant_credits() is the
     * only sanctioned writer of the balance and it records balance_after, which
     * is what makes the account's history still add up afterwards.
     */
    perform public.grant_credits(
      r.id,
      -r.credits,
      'admin_adjust',
      null,
      'Free trial ended. Trial credits are not lifetime credits, so the unused balance was cleared.'
    );
    v_taken := v_taken + r.credits;
    v_accounts := v_accounts + 1;
  end loop;

  return jsonb_build_object('accounts', v_accounts, 'credits_cleared', v_taken);
end $$;

comment on function public.expire_trial_credits() is
  'Zeroes the balance of an expired trial that never paid, through the ledger so the drop is explained. Idempotent: credits > 0 is part of the filter, so a second run finds nothing.';

revoke all on function public.expire_trial_credits() from public;
revoke all on function public.expire_trial_credits() from anon, authenticated;
grant execute on function public.expire_trial_credits() to service_role;

-- The sweep looks for expired trials, which is a filter on two columns it had
-- no index for.
create index if not exists profiles_trial_expiry_idx
  on public.profiles (plan_expires_on)
  where plan_id is not null and credits > 0;
