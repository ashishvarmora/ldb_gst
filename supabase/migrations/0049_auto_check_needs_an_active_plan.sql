-- ===========================================================================
-- An automatic check needs an active plan, in the function as well as the query.
--
-- The rule, as stated: an ACTIVE plan allows manual search, automatic tracking
-- and top-up. An EXPIRED plan or NO plan allows manual search ONLY, because
-- credits are a lifetime wallet.
--
-- The worker already honoured it - its candidate query decides which trucks are
-- polled - but spend_credits() did not. Asked directly it allowed 'auto_check'
-- for an expired plan and for an account that had never bought one, and the
-- caller's own filter was the only thing between that and a charge.
--
-- One layer is not enough for a money rule. The query and the function are
-- edited by different people at different times, and the function is what every
-- future caller trusts: an admin's manual re-check, a backfill, a retry path
-- somebody adds next year. A rule that lives only in the SELECT which happens
-- to precede today's call lapses the first time a second caller is written.
--
-- WHY THIS IS AN INJECTION AND NOT A REWRITE. I first rewrote the whole
-- function from the rule, and diffing it against pg_get_functiondef caught
-- three regressions I would otherwise have shipped: the live signature takes
-- p_count, not p_units, so every named-argument caller would have broken; there
-- is an account_suspended branch I had dropped entirely; and the cost is
-- rounded as ceil((count / rate) * 100) / 100, not ceil(count / rate), which
-- changes what a fractional rate charges. So the live definition is read and one
-- guard is inserted into it, leaving everything else byte-identical.
-- ===========================================================================

do $blk$
declare
  v_def text;
  v_anchor text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'spend_credits';

  if v_def is null then
    raise exception 'spend_credits() is missing - the earlier migrations have not run';
  end if;

  if position('no_active_plan' in v_def) > 0 then
    return;  -- already guarded
  end if;

  /*
   * Inserted immediately before the zero-rate branch, which is the first thing
   * after the trial check. That ordering matters: a suspended account and a
   * spent-out trial are both refused ahead of this, so their own reasons keep
   * priority over a plan reason, and the guard still lands before any balance
   * is read or charged.
   */
  v_anchor := '  if v_rate <= 0 then';
  if position(v_anchor in v_def) = 0 then
    raise exception 'spend_credits() no longer contains the expected zero-rate branch; refusing to guess where the guard belongs';
  end if;

  v_def := replace(
    v_def,
    v_anchor,
    '  -- Automatic tracking needs an active plan. Manual search deliberately' || chr(10) ||
    '  -- does not: credits are a lifetime wallet, and a lapsed or plan-less' || chr(10) ||
    '  -- account may still search while it has any. A live trial counts as' || chr(10) ||
    '  -- active, which is what lets a trial truck be tracked at all.' || chr(10) ||
    '  if p_action = ''auto_check''' || chr(10) ||
    '     and not (v_plan is not null' || chr(10) ||
    '              and (v_expires is null or v_expires >= public.ist_today()))' || chr(10) ||
    '  then' || chr(10) ||
    '    select credits into v_balance from public.profiles where id = p_user;' || chr(10) ||
    '    return jsonb_build_object(' || chr(10) ||
    '      ''allowed'', false, ''reason'', ''no_active_plan'',' || chr(10) ||
    '      ''balance'', v_balance, ''cost'', 0);' || chr(10) ||
    '  end if;' || chr(10) || chr(10) ||
    v_anchor
  );

  execute v_def;
end $blk$;

comment on function public.spend_credits(uuid, text, integer, text) is
  'The only writer of profiles.credits. Charges on execution, never on outcome. auto_check requires an active plan; manual_search does not, because credits are a lifetime wallet.';

-- The revoke ceremony, because the function was just recreated and Supabase
-- grants anon and authenticated an execute by default on anything new.
revoke all on function public.spend_credits(uuid, text, integer, text) from public;
revoke all on function public.spend_credits(uuid, text, integer, text) from anon, authenticated;
grant execute on function public.spend_credits(uuid, text, integer, text) to service_role;
