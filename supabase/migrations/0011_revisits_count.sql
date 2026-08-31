-- ===========================================================================
-- A truck can pass the same toll plaza twice, and both times count.
--
-- The bug, in the shape it was reported:
--
--   Dahegam -> Malvan (11:00) -> Ahmedabad, then back
--   Ahmedabad -> Malvan (15:00) -> Dahegam
--
-- Only Malvan is a toll plaza, so the platform sees Malvan at 11:00 and Malvan
-- at 15:00 and nothing in between. Two failures stacked up:
--
-- 1. THE 15:00 CROSSING WAS NEVER STORED. The worker drops a reading whose
--    plaza matches the previous stored one. That filter exists for a real
--    reason - the portal reports one physical crossing under several sequence
--    numbers - but it cannot tell that apart from a return trip, so the second
--    Malvan looked like a duplicate of the first.
--
-- 2. THE ALERT COMPARED NAMES, NOT CROSSINGS. "Only when it moves" asked
--    whether the plaza differed from the last one reported. Malvan to Malvan
--    is not a different name, so it would have stayed silent even if the row
--    had been stored.
--
-- The missing signal in both is time. Two readings of one crossing arrive
-- minutes apart; a return trip is hours later. So:
--
--   revisit_minutes  how long the same plaza counts as the same crossing.
--                    Beyond it, the truck has come back and it is news.
--
--   truck_alerts.last_event_at
--                    which crossing an alert last reported, so "has anything
--                    happened since I told you" is asked about the crossing
--                    rather than about the plaza name.
--
-- Run after 0010_signup_plans_and_plaza_search.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. How long one crossing keeps re-reporting
--
-- 90 minutes is a judgement, not a fact: long enough to absorb a plaza that
-- keeps re-reporting the same pass, short enough that a there-and-back on the
-- same day is two crossings. It is a setting because the right answer depends
-- on the routes being watched.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('revisit_minutes', '90'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Which crossing an alert last spoke about
--
-- Backfilled to the alert's last run so an alert that is already live does not
-- treat the crossing it has just reported as brand new and repeat itself once
-- on the next check.
-- ---------------------------------------------------------------------------
alter table public.truck_alerts
  add column if not exists last_event_at timestamptz;

update public.truck_alerts
set last_event_at = last_run_at
where last_event_at is null
  and last_run_at is not null
  and last_location is not null;

comment on column public.truck_alerts.last_event_at is
  'event_time of the crossing this alert last reported. Two passes of one plaza differ by time, not by name, so this is what "anything new?" is asked against.';
