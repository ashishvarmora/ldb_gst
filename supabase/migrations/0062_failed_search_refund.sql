-- 0062: a search that fails is refunded, and the refund nets against spend.
--
-- runManualLookup() now gives back the credit when the toll portal fails
-- (src/lib/manual-search.ts), as a positive ledger row with reason
-- 'search_refund'. Without this change credit_source() would file that row
-- under 'other' - "credits given away" - and every failed search would make
-- the finance pages show free credits that were never given. It is the reverse
-- of a spend, so it is counted as spend: the -1 and the +1 cancel out there.
--
-- Otherwise identical to the definition in 0043.

create or replace function public.credit_source(p_reason text, p_delta numeric, p_actor uuid)
returns text
language sql
immutable
as $$
  select case
    -- Spending is not a source. Kept as its own bucket so a caller can sum
    -- signed deltas without having to exclude it by name.
    when p_delta < 0 then 'spend'
    -- A refunded search undoes a spend, so it belongs with spending (0062).
    when p_reason = 'search_refund' then 'spend'
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
$$;
