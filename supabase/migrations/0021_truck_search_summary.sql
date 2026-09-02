-- ===========================================================================
-- Who has looked up this lorry, and who has this account looked up?
--
-- The Explore screen could answer neither. It searched truck_directory, which
-- says who is TRACKING a truck - a standing arrangement - and had nothing at
-- all for who has SEARCHED one. Those are different questions and the second is
-- the one an administrator is usually asking: a number comes up, and they want
-- to know which accounts have taken an interest in it.
--
-- search_logs holds the answer but not in a usable shape: one row per lookup,
-- tens of thousands of them, so folding them in the application would mean
-- fetching a truck's whole history to count it. This is that count, grouped
-- the two ways the screen needs it.
--
-- Not security_invoker: only the console reads it, through the service role,
-- and its whole purpose is looking ACROSS accounts - which is exactly what
-- row-level security would prevent. Execution stays restricted to the roles
-- that already hold service access.
--
-- Run after 0020_exact_table_sizes.sql.
-- ===========================================================================

drop view if exists public.truck_search_summary;
create view public.truck_search_summary as
select
  s.truck_number,
  s.user_id,
  count(*)::bigint                                          as searches,
  count(*) filter (where s.source = 'manual')::bigint        as manual,
  count(*) filter (where s.source = 'tracking')::bigint      as automatic,
  count(*) filter (where not s.ok)::bigint                   as failed,
  min(s.created_at)                                          as first_at,
  max(s.created_at)                                          as last_at
from public.search_logs s
group by s.truck_number, s.user_id;

comment on view public.truck_search_summary is
  'One row per (truck number, account): how many times that account looked that lorry up, split manual/automatic, and when. Read by the admin Explore screen, which exists to look across accounts.';

revoke all on public.truck_search_summary from anon, authenticated;

-- Both directions of the same question, so neither is a scan: by number for
-- "who looked at this lorry", by account for "what has this account looked at".
create index if not exists search_logs_truck_idx
  on public.search_logs (truck_number, created_at desc);

create index if not exists search_logs_user_created_idx
  on public.search_logs (user_id, created_at desc);
