-- ===========================================================================
-- Mark which crossings are an actual change of toll plaza.
--
-- The portal reports the same plaza under several sequence numbers, and a
-- truck sitting at a plaza registers again and again. Those rows say nothing
-- new, but they cannot simply be thrown away: seq_no is what stops the worker
-- re-processing a crossing it has already seen, and dropping a row would make
-- it look new on the next poll and fire the alerts a second time.
--
-- So every crossing is still stored, and the ones that moved the truck are
-- flagged. The sheet, the records view and the officer's timeline all read the
-- flag; the worker keeps its full dedupe history.
--
-- Run after 0004_retention_and_records.sql.
-- ===========================================================================

alter table public.truck_events
  add column if not exists is_location_change boolean not null default true;

comment on column public.truck_events.is_location_change is
  'False when this crossing reports the same plaza as the previous one for this truck. Set by the worker at insert time.';

-- ---------------------------------------------------------------------------
-- Backfill: walk each truck''s history in order and flag repeats.
-- ---------------------------------------------------------------------------
with ordered as (
  select
    id,
    lower(regexp_replace(coalesce(loc_name, ''), '\s+', ' ', 'g')) as norm,
    lag(lower(regexp_replace(coalesce(loc_name, ''), '\s+', ' ', 'g'))) over (
      partition by user_id, truck_number
      order by event_time nulls first, id
    ) as previous_norm
  from public.truck_events
)
update public.truck_events e
set is_location_change = false
from ordered o
where o.id = e.id
  and o.norm <> ''
  and o.norm = o.previous_norm;

-- The records view and the sheet both filter on this, per user, newest first.
create index if not exists truck_events_user_change_time_idx
  on public.truck_events (user_id, is_location_change, event_time desc);

-- ---------------------------------------------------------------------------
-- A single place to ask "where has this truck actually been", used by the
-- officer's timeline and records view so both agree on what counts as a move.
-- ---------------------------------------------------------------------------
create or replace view public.truck_movements with (security_invoker = on) as
select
  e.id,
  e.user_id,
  e.tracked_truck_id,
  e.truck_number,
  e.seq_no,
  e.event_time,
  e.loc_name,
  e.lat,
  e.lng,
  e.direction,
  e.event_name,
  e.fetched_at
from public.truck_events e
where e.is_location_change;
