-- ===========================================================================
-- Two more ways a truck stops checking itself, so nobody pays for a watch they
-- forgot to switch off.
--
-- The complaint that prompted this: somebody puts a lorry on automatic
-- checking because they want to follow it for an afternoon, and then does not
-- come back. Every check after that afternoon costs a credit and tells them
-- nothing. There was no way to say "watch this until this evening" - the only
-- stop was a person remembering to press pause.
--
-- Three stops exist now, and each has its own reason on the row so the officer
-- is told WHICH one fired rather than finding a truck that mysteriously went
-- quiet:
--
--   repeated_failures   the toll network could not answer, N times running
--                       (already here - the officer's own number, or the
--                        admin's fallback)
--   schedule            the officer said "for six hours" and six hours passed
--   inactive            the lorry has not moved for Y hours, so there is
--                       nothing left to watch
--
-- Both new stops follow the pattern the failure budget already set: the number
-- is the OFFICER'S if they gave one, and the ADMIN'S platform-wide setting if
-- they did not. A per-truck null is never resolved at write time - freezing
-- today's default onto the row would mean changing the platform setting later
-- did nothing for any truck already added.
--
-- Run after 0026_referral_minimum_payment.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The two new controls
--
-- auto_pause_at is a moment, not a duration. The officer types "6 hours" and
-- the server stores the instant that lands on, because a duration would have
-- to be re-based against something and the two obvious candidates - when the
-- truck was added, and when it was last edited - are both wrong the moment
-- anybody touches the row for another reason.
--
-- inactive_pause_hours is a duration, because it is measured from a moving
-- target: the last crossing seen. Null means "use the platform setting".
-- ---------------------------------------------------------------------------
alter table public.tracked_trucks
  add column if not exists auto_pause_at timestamptz,
  add column if not exists inactive_pause_hours integer;

comment on column public.tracked_trucks.auto_pause_at is
  'When automatic checking should stop by itself. Null means it runs until something else stops it.';
comment on column public.tracked_trucks.inactive_pause_hours is
  'Pause once no new crossing has been seen for this many hours. Null means use inactive_pause_hours from app_settings.';

-- One hour is the shortest window worth offering: the sweep does not run more
-- often than that in practice, so anything shorter would pause the truck
-- before it had been checked once. A year is the ceiling on both, which is
-- less a real limit than a guard against a slipped decimal point.
alter table public.tracked_trucks
  drop constraint if exists tracked_trucks_inactive_hours_range;
alter table public.tracked_trucks
  add constraint tracked_trucks_inactive_hours_range
  check (inactive_pause_hours is null
         or (inactive_pause_hours >= 1 and inactive_pause_hours <= 8760));

-- ---------------------------------------------------------------------------
-- 2. The two new reasons
--
-- Widened rather than replaced: every value already stored is still legal, so
-- no truck that is currently paused loses the explanation for why.
-- ---------------------------------------------------------------------------
alter table public.tracked_trucks
  drop constraint if exists tracked_trucks_paused_reason_known;
alter table public.tracked_trucks
  add constraint tracked_trucks_paused_reason_known
  check (paused_reason is null
         or paused_reason in ('manual', 'repeated_failures', 'account_suspended',
                              'schedule', 'inactive'));

comment on column public.tracked_trucks.paused_reason is
  'Why is_active went false: manual, repeated_failures, account_suspended, schedule (its auto-pause time arrived) or inactive (no crossing for long enough). Null while it is running.';

-- The sweep asks "which active trucks are past their auto-pause time" on every
-- run, and that is a tiny slice of a table that is mostly nulls here.
create index if not exists tracked_trucks_auto_pause_idx
  on public.tracked_trucks (auto_pause_at)
  where is_active and auto_pause_at is not null;

-- ---------------------------------------------------------------------------
-- 3. The admin's fallback
--
-- 72 hours, deliberately generous. This number stops a truck being checked, so
-- the cost of setting it too low is a customer whose lorry quietly stopped
-- being watched while it sat in a yard over a long weekend - much worse than
-- the cost of setting it too high, which is some wasted credits. An
-- administrator who wants it tighter can say so; nobody should be surprised by
-- it out of the box.
--
-- tracking_failure_cutoff is seeded here too. It has always been read with a
-- fallback of 10 in the application and edited on the Settings screen, but the
-- row itself was never created, so the screen was editing something that did
-- not exist until the first save.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('inactive_pause_hours', '72'::jsonb),
       ('tracking_failure_cutoff', '10'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. So the admin can answer the question the customer will ring about
--
-- truck_directory is what /admin/trucks and an account's Trucks tab read, and
-- it carried is_active but not the reason. That meant the one person fielding
-- "why has my lorry stopped being checked?" saw the word "paused" and nothing
-- else - while the customer's own screen explained it perfectly. With two new
-- stops that fire on a timer rather than on anything visible, that gap goes
-- from awkward to unworkable.
--
-- Dropped and recreated rather than replaced: adding columns to a view is a
-- column-list change, and create-or-replace cannot do those.
-- ---------------------------------------------------------------------------
drop view if exists public.truck_directory;
create view public.truck_directory with (security_invoker = on) as
select
  t.id as tracked_truck_id,
  t.truck_number,
  t.label,
  t.is_active,
  t.status,
  t.last_location,
  t.last_event_at,
  t.last_polled_at,
  t.created_at,
  -- The three that answer "why did it stop, and when".
  t.paused_reason,
  t.paused_at,
  t.auto_pause_at,
  p.id    as officer_id,
  p.full_name as officer_name,
  p.email as officer_email,
  p.phone as officer_phone,
  p.office,
  p.district,
  p.state,
  coalesce(al.alert_count, 0) as alert_count,
  coalesce(ev.event_count, 0) as event_count
from public.tracked_trucks t
join public.profiles p on p.id = t.user_id
left join lateral (
  select count(*) as alert_count from public.truck_alerts a
  where a.tracked_truck_id = t.id and a.is_enabled
) al on true
left join lateral (
  select count(*) as event_count from public.truck_events e
  where e.user_id = t.user_id and e.truck_number = t.truck_number
) ev on true;
