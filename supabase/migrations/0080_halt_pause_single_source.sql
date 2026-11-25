-- ===========================================================================
-- 0080: one source of truth for the "no toll crossing" pause (25 Nov 2026).
--
-- The halt alert's pause_after_hours (truck_alerts) is the only setting that
-- pauses a truck for not moving. The worker reads it from
-- tracked_trucks.inactive_pause_hours, which the app mirrors by hand on every
-- halt alert add / edit / on / off / delete. This makes the database keep that
-- mirror in step, and repairs any drift. Not destructive: no column dropped,
-- and trucks with NO halt alert at all keep whatever value they carry (the
-- truck page shows it as "older setting").
-- ===========================================================================

create or replace function public.sync_halt_pause()
returns trigger
language plpgsql
as $$
declare
  t uuid;
  k text;
begin
  if tg_op = 'DELETE' then
    t := old.tracked_truck_id; k := old.template_kind;
  else
    t := new.tracked_truck_id; k := new.template_kind;
    if tg_op = 'UPDATE' and old.template_kind = 'halt' then k := 'halt'; end if;
  end if;

  if k is distinct from 'halt' then
    return null;
  end if;

  update public.tracked_trucks tt
     set inactive_pause_hours = (
       select a.pause_after_hours
         from public.truck_alerts a
        where a.tracked_truck_id = tt.id
          and a.template_kind = 'halt'
          and a.is_enabled
        order by a.updated_at desc nulls last
        limit 1)
   where tt.id = t;

  return null;
end;
$$;

drop trigger if exists truck_alerts_sync_halt_pause on public.truck_alerts;
create trigger truck_alerts_sync_halt_pause
after insert or update of is_enabled, pause_after_hours, template_kind or delete
on public.truck_alerts
for each row execute function public.sync_halt_pause();

-- Repair: trucks with an enabled halt alert take its pause time.
update public.tracked_trucks tt
   set inactive_pause_hours = h.pause_after_hours
  from (
    select distinct on (tracked_truck_id) tracked_truck_id, pause_after_hours
      from public.truck_alerts
     where template_kind = 'halt' and is_enabled
     order by tracked_truck_id, updated_at desc nulls last
  ) h
 where h.tracked_truck_id = tt.id
   and tt.inactive_pause_hours is distinct from h.pause_after_hours;

-- Repair: trucks whose halt alerts are all switched off have no such pause.
update public.tracked_trucks tt
   set inactive_pause_hours = null
 where tt.inactive_pause_hours is not null
   and exists (select 1 from public.truck_alerts a
                where a.tracked_truck_id = tt.id and a.template_kind = 'halt')
   and not exists (select 1 from public.truck_alerts a
                    where a.tracked_truck_id = tt.id and a.template_kind = 'halt' and a.is_enabled);
