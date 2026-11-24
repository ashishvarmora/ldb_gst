-- ===========================================================================
-- 0075: give every truck its own "pause after N failed checks" (24 Nov 2026).
--
-- Since 20 Nov the number is REQUIRED on add and edit, with no admin fallback
-- written. Trucks added before that were left null and quietly used the admin
-- setting (tracking_failure_cutoff, 10 today) - so the truck page showed an
-- empty required box and any edit failed until it was filled. This writes the
-- number those trucks were already running with, so nothing changes in how
-- they are tracked; it only stops being invisible.
-- ===========================================================================
update public.tracked_trucks t
set max_consecutive_failures = greatest(1, least(50, coalesce(
  (select (value #>> '{}')::int from public.app_settings where key = 'tracking_failure_cutoff'),
  10)))
where t.max_consecutive_failures is null;
