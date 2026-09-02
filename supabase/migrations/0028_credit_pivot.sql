-- ===========================================================================
-- One pivot over the credit ledger, for every question the Analyse screens ask.
--
-- The complaint: the Analyse section is "visual only, not for a data
-- scientist". Fair. Each screen drew a stacked bar chart from a series
-- function that had ONE fixed grouping baked in - admin_credit_series groups
-- by (bucket, source, reason) and nothing else, for ever - so the only
-- questions the console could answer were the ones somebody had written a
-- function for. "How much did this one account spend per truck last week"
-- had no answer at all, and neither did "who actually claimed those 500 free
-- credits", which is the question the owner asked out loud.
--
-- So: one function, and the caller says how to slice it. Any combination of
--
--   bucket   the IST day, week or month
--   account  who
--   truck    which lorry the charge was against
--   reason   the raw ledger reason
--   source   the paid / admin / free / spend bucket credit_source() decides
--
-- comes back grouped, with the dimensions nobody asked for returned as null.
-- That is what makes one function serve the usage report, the credit economy
-- panel and a per-account drill-down without three near-copies of the same
-- SQL - which was the other half of the complaint, about duplication.
--
-- Dynamic SQL, and safely: the dimension names never reach the query as text.
-- Each one is looked up in a hard-coded CASE and only the fragment this file
-- wrote is concatenated, so there is nothing a caller can pass that becomes
-- SQL. Every value - dates, ids, arrays - is bound with USING.
--
-- Run after 0027_auto_pause.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The pivot
--
-- SECURITY INVOKER, and EXECUTE granted to service_role only, exactly like the
-- rest of the admin_* family: this reads every account's spending, so the only
-- thing that may call it is the console's own server-side client.
-- ---------------------------------------------------------------------------
create or replace function public.admin_credit_pivot(
  p_from    date,
  p_to      date,
  p_dims    text[] default array['bucket'],
  p_bucket  text   default 'day',
  /* 'all', 'spend' (charges only) or 'grant' (credits added only). Kept
     separate from the source filter because "everything that was spent" is a
     sign test on the delta, not a named source, and asking for it by name
     would break the moment a new spending reason is added. */
  p_kind    text   default 'all',
  p_users   uuid[] default null,
  p_trucks  text[] default null,
  p_reasons text[] default null,
  p_sources text[] default null
)
returns table (
  bucket        date,
  user_id       uuid,
  account       text,
  truck_number  text,
  reason        text,
  source        text,
  entries       bigint,
  credits       numeric,
  accounts      bigint,
  trucks        bigint,
  first_at      timestamptz,
  last_at       timestamptz
)
language plpgsql
stable
set search_path = public, pg_catalog
as $fn$
declare
  v_selected text[] := '{}';
  v_group    text[] := '{}';
  v_dim      text;
  v_sql      text;
begin
  /*
   * The dimensions, in a fixed order so two callers asking for the same slice
   * get the same shape back. An unknown name is ignored rather than raising:
   * this is a read for a report, and refusing to render one because a query
   * string carried a stale dimension helps nobody.
   */
  -- array_append rather than the || operator. `text[] || 'literal'` makes
  -- Postgres try to parse the literal as an array and fail with "malformed
  -- array literal", because || is overloaded for array-to-array as well as
  -- array-to-element and an untyped literal matches the wrong overload.
  foreach v_dim in array coalesce(p_dims, '{}') loop
    if v_dim = 'bucket' and not ('bucket' = any(v_selected)) then
      v_selected := array_append(v_selected, 'bucket');
      v_group := array_append(v_group, 'public.ist_bucket(t.created_at, $3)');
    elsif v_dim = 'account' and not ('account' = any(v_selected)) then
      v_selected := array_append(v_selected, 'account');
      v_group := array_append(v_group, 't.user_id');
    elsif v_dim = 'truck' and not ('truck' = any(v_selected)) then
      v_selected := array_append(v_selected, 'truck');
      v_group := array_append(v_group, 't.truck_number');
    elsif v_dim = 'reason' and not ('reason' = any(v_selected)) then
      v_selected := array_append(v_selected, 'reason');
      v_group := array_append(v_group, 't.reason');
    elsif v_dim = 'source' and not ('source' = any(v_selected)) then
      v_selected := array_append(v_selected, 'source');
      v_group := array_append(v_group, 'public.credit_source(t.reason, t.delta, t.actor_id)');
    end if;
  end loop;

  /*
   * No dimensions at all is a legitimate ask - it is the totals row, one line
   * for the whole window. Without this the GROUP BY would be empty and every
   * row would come back separately, which is the opposite of what was wanted.
   */
  v_sql := format($q$
    select
      %1$s as bucket,
      %2$s as user_id,
      %3$s as account,
      %4$s as truck_number,
      %5$s as reason,
      %6$s as source,
      count(*)::bigint,
      sum(t.delta)::numeric,
      count(distinct t.user_id)::bigint,
      count(distinct t.truck_number)::bigint,
      min(t.created_at),
      max(t.created_at)
    from public.credit_transactions t
    -- An INNER join on role = 'officer', and both halves of that matter.
    --
    -- These are the customer reports, so an admin's own account is out of
    -- scope: a super_admin granting itself credits to test a plan would
    -- otherwise land in "credits issued" and in "what the giveaway cost",
    -- making the platform's own test data look like business.
    --
    -- Do NOT relax this to a left join to "recover missing rows". The rows are
    -- not missing, they are excluded, and the totals are stated as customer
    -- totals on the screens that read this. If admin-held credits ever need
    -- reporting they want their own measure, not a silent merge into these.
    join public.profiles p on p.id = t.user_id and p.role = 'officer'
    where t.created_at <@ public.ist_range($1, $2)
      and ($4 = 'all'
           or ($4 = 'spend' and t.delta < 0)
           or ($4 = 'grant' and t.delta > 0))
      and ($5 is null or t.user_id = any($5))
      and ($6 is null or t.truck_number = any($6))
      and ($7 is null or t.reason = any($7))
      and ($8 is null or public.credit_source(t.reason, t.delta, t.actor_id) = any($8))
    %7$s
  $q$,
    case when 'bucket'  = any(v_selected) then 'public.ist_bucket(t.created_at, $3)' else 'null::date' end,
    case when 'account' = any(v_selected) then 't.user_id' else 'null::uuid' end,
    -- The name is carried alongside the id so a league table does not need a
    -- second query per row to say who it is about. coalesce to the email
    -- because full_name is nullable and a blank row is unusable.
    case when 'account' = any(v_selected) then 'coalesce(p.full_name, p.email)' else 'null::text' end,
    case when 'truck'   = any(v_selected) then 't.truck_number' else 'null::text' end,
    case when 'reason'  = any(v_selected) then 't.reason' else 'null::text' end,
    case when 'source'  = any(v_selected) then 'public.credit_source(t.reason, t.delta, t.actor_id)' else 'null::text' end,
    case
      when array_length(v_group, 1) is null then ''
      -- p.full_name and p.email ride along with t.user_id, so they are grouped
      -- too whenever the account dimension is on.
      else 'group by ' || array_to_string(
             case when 'account' = any(v_selected)
                  then v_group || array['p.full_name', 'p.email']
                  else v_group end, ', ')
    end
  );

  return query execute v_sql
    using p_from, p_to, coalesce(p_bucket, 'day'), coalesce(p_kind, 'all'),
          p_users, p_trucks, p_reasons, p_sources;
end $fn$;

-- ---------------------------------------------------------------------------
-- The distinct values a filter can offer
--
-- A dropdown of accounts or trucks built from the rows currently on screen
-- only ever offers what is already visible, which makes it useless for
-- narrowing. This returns the whole set for the window, so the control can
-- offer something the reader cannot already see.
-- ---------------------------------------------------------------------------
create or replace function public.admin_credit_facets(p_from date, p_to date, p_kind text default 'all')
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $fn$
  with rows as (
    select t.user_id, t.truck_number, t.reason,
           public.credit_source(t.reason, t.delta, t.actor_id) as source,
           coalesce(p.full_name, p.email) as account
    from public.credit_transactions t
    -- An INNER join on role = 'officer', and both halves of that matter.
    --
    -- These are the customer reports, so an admin's own account is out of
    -- scope: a super_admin granting itself credits to test a plan would
    -- otherwise land in "credits issued" and in "what the giveaway cost",
    -- making the platform's own test data look like business.
    --
    -- Do NOT relax this to a left join to "recover missing rows". The rows are
    -- not missing, they are excluded, and the totals are stated as customer
    -- totals on the screens that read this. If admin-held credits ever need
    -- reporting they want their own measure, not a silent merge into these.
    join public.profiles p on p.id = t.user_id and p.role = 'officer'
    where t.created_at <@ public.ist_range(p_from, p_to)
      and (coalesce(p_kind, 'all') = 'all'
           or (p_kind = 'spend' and t.delta < 0)
           or (p_kind = 'grant' and t.delta > 0))
  )
  select jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', user_id, 'label', account, 'entries', n)
                       order by n desc)
      from (select user_id, account, count(*) n from rows group by 1, 2) a), '[]'::jsonb),
    -- Trucks are capped: an account with a large fleet would otherwise return
    -- a list nobody can scroll, and the ones worth filtering to are the ones
    -- with the most activity.
    'trucks', coalesce((
      select jsonb_agg(jsonb_build_object('label', truck_number, 'entries', n) order by n desc)
      from (select truck_number, count(*) n from rows
            where truck_number is not null group by 1 order by n desc limit 200) tr), '[]'::jsonb),
    'reasons', coalesce((
      select jsonb_agg(jsonb_build_object('label', reason, 'entries', n) order by n desc)
      from (select reason, count(*) n from rows group by 1) rs), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('label', source, 'entries', n) order by n desc)
      from (select source, count(*) n from rows group by 1) sc), '[]'::jsonb)
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Who may read any of this
-- ---------------------------------------------------------------------------
do $blk$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_credit_pivot(date, date, text[], text, text, uuid[], text[], text[], text[])',
    'public.admin_credit_facets(date, date, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $blk$;

-- The pivot slices the ledger by account and by truck inside a date window,
-- which is the one access pattern credit_transactions had no index for.
create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);
create index if not exists credit_transactions_truck_created_idx
  on public.credit_transactions (truck_number, created_at desc)
  where truck_number is not null;
