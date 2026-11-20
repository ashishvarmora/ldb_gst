-- 0070: Halt alert ("When the truck halts"), owner spec 20 Nov 2026.
--
--   * No new toll crossing for halt_after_hours -> "has halted" alert.
--   * Still no crossing -> a reminder every 1 hour (fixed, always on).
--   * A new crossing -> "is moving again" (always on).
--   * Still halted after pause_after_hours -> tracking auto-pauses
--     (tracked_trucks.inactive_pause_hours mirrors pause_after_hours, so the
--     existing auto-pause does the pausing). pause_after_hours > halt_after_hours.
--
-- Both hour values are required from the customer; there are no platform
-- defaults. The alert checks the truck every 60 minutes so reminders are
-- hourly.

insert into public.alert_rule_templates
  (name, kind, description, is_active, min_interval_minutes, default_interval_minutes, sort_order)
select 'Halt alert', 'halt',
       'When the truck has crossed no toll for the hours you set, with hourly reminders and a message when it moves again.',
       true, 60, 60, 40
where not exists (select 1 from public.alert_rule_templates where kind = 'halt');

alter table public.truck_alerts
  add column if not exists halt_after_hours  integer check (halt_after_hours  is null or halt_after_hours  between 1 and 72),
  add column if not exists pause_after_hours integer check (pause_after_hours is null or pause_after_hours between 2 and 168),
  add column if not exists halt_active       boolean not null default false,
  add column if not exists halt_notified_at  timestamptz;

comment on column public.truck_alerts.halt_after_hours  is 'Halt alert: hours without a toll crossing before the first alert (0070).';
comment on column public.truck_alerts.pause_after_hours is 'Halt alert: hours without a crossing before tracking pauses; mirrored to tracked_trucks.inactive_pause_hours (0070).';
comment on column public.truck_alerts.halt_active       is 'Halt alert: the truck is currently reported as halted (0070).';
comment on column public.truck_alerts.halt_notified_at  is 'Halt alert: when the last halt alert or hourly reminder went out (0070).';
