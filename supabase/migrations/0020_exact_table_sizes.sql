-- ===========================================================================
-- The storage page tells the truth about how many rows there are.
--
-- table_sizes() reported reltuples, which is not a row count. It is a planner
-- estimate maintained by ANALYZE, so it is -1 on a table that has never been
-- analysed and stale on one written to since. The storage screen therefore
-- showed "0 rows" for tables holding thousands, and an admin deciding whether a
-- retention rule is safe was reading a number that had nothing to do with what
-- would be deleted.
--
-- Counted exactly now. The original comment defended the estimate on the
-- grounds that exact counts mean a sequential scan of every table - true, and
-- irrelevant at this size: two dozen small tables on a page an admin opens
-- occasionally. A figure that is right matters more here than a page that is
-- fast, because this is the screen deletion is authorised from.
--
-- The identifier comes from pg_class and goes through format('%I'), so the
-- dynamic SQL cannot be steered by anything a caller supplies.
--
-- Run after 0019_one_credit_ledger.sql.
-- ===========================================================================

create or replace function public.table_sizes()
returns table (entity text, rows bigint, bytes bigint, pretty text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  rec    record;
  counted bigint;
begin
  for rec in
    select c.relname, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc
  loop
    execute format('select count(*) from public.%I', rec.relname) into counted;

    entity := rec.relname::text;
    rows   := counted;
    bytes  := pg_total_relation_size(rec.oid);
    pretty := pg_size_pretty(bytes);
    return next;
  end loop;
end $fn$;

comment on function public.table_sizes() is
  'Exact row count and on-disk size per public table. Counts rather than estimating from reltuples, because the storage screen is where deletion is authorised.';

revoke all on function public.table_sizes() from public;
grant execute on function public.table_sizes() to service_role;
