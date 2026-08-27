-- ===========================================================================
-- Store movements only.
--
-- 0005 stored every reading and flagged the ones that moved the truck. That
-- still wrote a row each time a plaza re-reported the same crossing, which is
-- exactly the noise the flag was meant to hide. The database should hold what
-- actually happened: a time and a new location, once per move.
--
-- The worker now decides before inserting, seeding the comparison from the
-- truck's last saved location, so the decision is the same on every poll and
-- a repeat is simply never written.
--
-- Run after 0005_location_change_flag.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Drop the rows 0005 flagged as repeats. They carry no information the
-- preceding row does not already have.
-- ---------------------------------------------------------------------------
delete from public.truck_events where is_location_change = false;

-- ---------------------------------------------------------------------------
-- With only movements stored, the flag is always true and the view that
-- filtered on it is the table itself.
-- ---------------------------------------------------------------------------
drop view if exists public.truck_movements;
drop index if exists public.truck_events_user_change_time_idx;

alter table public.truck_events drop column if exists is_location_change;

comment on table public.truck_events is
  'One row per movement: the truck reached a toll plaza different from the one before it. Repeat readings of the same plaza are never stored - the Google Sheet mirrors these same rows.';
