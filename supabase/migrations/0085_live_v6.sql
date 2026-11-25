-- 0085: Live tracking v6 (design: docs/LIVE-PLAN-v6.md).
--
-- ADDITIVE ONLY. Two nullable columns on live_trips. Nothing is rewritten or
-- dropped. The app works before this is applied: journey hours still set the
-- planned arrival (promised_delivery_at), and the route is worked out on each
-- page view instead of being cached.

alter table public.live_trips
  add column if not exists journey_hours numeric(6,2),
  add column if not exists route_plan    jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_trips_journey_hours_chk') then
    alter table public.live_trips add constraint live_trips_journey_hours_chk
      check (journey_hours is null or (journey_hours > 0 and journey_hours <= 240));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_route_plan_chk') then
    alter table public.live_trips add constraint live_trips_route_plan_chk
      check (route_plan is null or (jsonb_typeof(route_plan) = 'object' and length(route_plan::text) <= 8000));
  end if;
end $$;

comment on column public.live_trips.journey_hours is
  '0085: planned journey time in hours incl. the driver''s halts. Planned arrival = planned start + journey hours (kept in promised_delivery_at).';
comment on column public.live_trips.route_plan is
  '0085: "Where is my truck" stops, built once per From/To (AI, validated; rule-based fallback): '
  '{"v":1,"from":{name,lat,lng},"to":{name,lat,lng},"total_km":n,"stops":[{name,lat,lng,km}],"source":"ai|rules","at":iso}.';

-- live_trips.owner_type / ownership / transporter on live_vehicles stay; v6 no longer writes them from the truck form.
