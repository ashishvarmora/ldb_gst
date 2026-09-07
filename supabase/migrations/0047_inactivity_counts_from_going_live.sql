-- ===========================================================================
-- The no-movement clock starts when tracking starts, not at the last crossing.
--
-- THE BUG, in the owner's own words: "truck is stopped for last 16 hr, but i
-- add this truck in live tracking now, so from now to 8 hr". They are right,
-- and the old rule did the opposite.
--
-- dueForAutoPause() measured idleness as now - (last_event_at ?? created_at).
-- So a lorry whose last recorded crossing was a day ago was already twenty-four
-- hours "idle" the moment it was added, sailed past an eight-hour window on its
-- very first sweep, and paused itself before it had been watched once. The
-- officer sees a truck they just switched on stop immediately, for a reason
-- that is about history they were never shown.
--
-- Worse, it made the feature useless for the case it exists for: the lorry you
-- most want to start watching is the one that has been sitting still, because
-- that is the one you are waiting to see move.
--
-- So the window is measured from whichever is LATER: the last crossing, or the
-- moment tracking began. A truck parked for a week gets its full eight hours of
-- being watched; a truck that has been live for days and stops moving still
-- pauses eight hours after its last crossing. Both are what the words say.
--
-- tracking_started_at is stamped whenever a truck goes live - added, resumed,
-- or taken live again after any automatic pause - and deliberately NOT on an
-- ordinary poll, which would push the deadline forward for ever and mean no
-- truck was ever paused for standing still.
-- ===========================================================================

alter table public.tracked_trucks
  add column if not exists tracking_started_at timestamptz;

comment on column public.tracked_trucks.tracking_started_at is
  'When this truck last went live. The no-movement window counts from the later of this and last_event_at, so a lorry that was already parked still gets a full window of being watched.';

/*
 * Backfill, conservatively.
 *
 * A live truck gets the latest thing we can honestly point at as "tracking was
 * running by then": its last poll, its last crossing, or failing both the day
 * it was created. Using created_at alone would re-introduce the bug for every
 * existing truck on the first sweep after this deploys; using now() would give
 * every truck a fresh window it has not earned. A paused truck is left null -
 * it will be stamped when somebody takes it live, which is the only moment the
 * value means anything.
 */
update public.tracked_trucks
set tracking_started_at = greatest(
      coalesce(last_polled_at, created_at),
      coalesce(last_event_at, created_at),
      created_at
    )
where tracking_started_at is null
  and is_active;

-- The sweep reads it beside the two columns it already filters on.
create index if not exists tracked_trucks_inactivity_idx
  on public.tracked_trucks (is_active, tracking_started_at)
  where is_active;
