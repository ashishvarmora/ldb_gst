-- ===========================================================================
-- The plaza to watch is the one AHEAD of the lorry, and a typo still finds it.
--
-- ---------------------------------------------------------------------------
-- 1 · THE COMPLAINT, IN THE OWNER'S WORDS
--
--     "for alert rule : reached a toll plaza is senseless bcs officer need
--      upcoming toll from current loc.. not past. currently it shows random
--      basis dropdown. fix that logic. either officer manual type kare and
--      fuzzy logic se usko match kare ( spelling mistake ignore ) or if
--      possible expected future ke toll plaza list me shows ho and officer
--      woh chose kare, if not found he can write manually also and use hybrid
--      approach with fuzzy logic. if not found in list, write a toll plaza
--      name, fuzzy logic matching, found or not !!"
--
-- The picker offered "MOST RECORDED PLAZAS" - search_plazas() from 0010 with a
-- blank query, which is toll_plazas ordered by seen_count. That is a popularity
-- ranking across the whole platform. It has no relationship whatsoever to where
-- the lorry in front of the officer is, which way it is pointing, or where it
-- is going, and the plaza at the top of it is usually one the truck passed days
-- ago or will never see. The officer is choosing the subject of an alert that
-- costs a credit on every check, from a list assembled by a criterion that has
-- nothing to do with their question.
--
-- ---------------------------------------------------------------------------
-- 2 · WHAT "AHEAD" CAN HONESTLY MEAN WITH THE DATA THAT EXISTS
--
-- There is no road network here and nothing to route with. What there is:
--
--   truck_events   one row per crossing - loc_name, lat, lng, direction and
--                  event_time. direction is laneDirection from the upstream
--                  feed (see src/lib/ldb.ts), one of eight compass letters,
--                  and the rest of this codebase already reads it as the
--                  direction of TRAVEL - "North bound" in DIRECTION_LABEL,
--                  src/components/Timeline.tsx.
--   toll_plazas    name, seen_count, last_seen_at. NO COORDINATES AT ALL,
--                  which is the whole reason this file starts with a column.
--
-- So "ahead" is built out of two facts and nothing else: the truck's last
-- crossing is a POINT, and its two last crossings are a BEARING. A plaza is
-- ahead when it sits inside a cone around that bearing, and the list is ordered
-- by how far away it is - because "which toll comes next" is, in the absence of
-- a road graph, "the nearest one in the direction of travel".
--
-- Three things this is NOT, and the form is written to say so rather than to
-- imply otherwise:
--
--   * Not a route. The distance is great-circle, not road distance, so it
--     always understates. Every row shows its number so the reader can judge.
--   * Not a prediction. Nothing here knows the lorry's destination or which
--     highway it will take at the next junction. A plaza in the cone is a plaza
--     the truck is pointed at, which is a weaker claim and the true one.
--   * Not available for every truck. Two things can be missing - the bearing
--     and the coordinates - and each one is degraded to a weaker honest answer
--     rather than filled in with a guess. See the `basis` field below.
--
-- ---------------------------------------------------------------------------
-- 3 · WHERE PLAZA COORDINATES COME FROM, AND WHY THEY HAVE TO BE LEARNED
--
-- Every crossing carries the plaza's lat/lng, so the coordinates have always
-- been arriving - they were just never kept anywhere durable. truck_events is
-- pruned on a 30-day rule (retention_rules, 0004), so a plaza the platform has
-- placed perfectly well is unplaceable again a month later. On this database
-- today that has already happened: toll_plazas holds 80 plazas and 94 recorded
-- sightings between them, and truck_events holds three rows.
--
-- A toll plaza does not move. Its position is a permanent fact worth exactly
-- one column, and the trigger below lifts it off each crossing as it lands and
-- keeps it after the crossing itself has been deleted. Coverage therefore
-- starts thin and only grows: the backfill can place whatever events survive
-- right now, and every sweep from here places a few more.
--
-- The trigger, not recordPlazas() in src/lib/tracking.ts. It could have been a
-- couple of extra fields on that upsert, but the catalogue is what the alert
-- form tests a typed name against - "will this name ever match anything?" - so
-- it must not be possible for a crossing to be stored while the catalogue is
-- unaware of the name. In the database, that is a trigger; in application code
-- it is two statements and a hope. It also fixes seen_count, which no longer
-- moved at all: recordPlazas() upserts with ignoreDuplicates, so every count
-- has been frozen at whatever the 0008 backfill left, and the picker has been
-- printing "seen 3 times" off a number two years out of date.
--
-- ---------------------------------------------------------------------------
-- 4 · FUZZY MATCHING ON THE PART OF THE NAME THAT IS ACTUALLY A NAME
--
-- pg_trgm is available, and on this project it is installed in PUBLIC - not in
-- extensions, where pgcrypto lives. That matters: a `set search_path = public`
-- function can see similarity() but could not see gen_random_uuid(), which is
-- what 0023 exists to work around. Checked with pg_extension before writing a
-- line of this, because getting it wrong once broke every signup.
--
-- search_plazas() from 0010 already used similarity() on the whole name, and
-- that is the wrong string to compare. Two thirds of every one of these names
-- is road furniture - "Toll Plaza", "Fee Plaza", "Border Checkpost", "NH48" -
-- so those trigrams are shared by almost the entire catalogue and they drown
-- the part a person actually typed. Measured on the live 80 rows:
--
--   'qqqqq plaza'  -> 8 matches, top score 0.38   nonsense, scored confidently
--   'waashi'       -> 0 matches                   Vashi Toll Plaza, missed
--   'mehsna'       -> Mehsana Toll Plaza at 0.24  right answer, barely
--
-- plaza_core() strips the furniture and compares what is left. Same 80 rows,
-- same queries, core against core:
--
--   'qqqqq plaza'  -> 0.00      'mehsna'      -> 0.50
--   'zzzzzz'       -> 0.00      'adlaj'       -> 0.44
--   'random nonsense toll plaza' -> 0.15      'khanivade'   -> 0.54
--   'nadiad' (genuinely absent)  -> 0.14      'vaishnodevo' -> 0.71
--                                             'waashi'      -> 0.30
--
-- Every real misspelling lands at 0.30 or above and nothing that is not a
-- plaza name gets past 0.15, so the threshold is 0.25 with the widest margin
-- the live data offers on both sides.
--
-- ---------------------------------------------------------------------------
-- 5 · FUZZY FINDS IT. FUZZY NEVER DECIDES WHETHER THE ALERT FIRES.
--
-- The evaluator is exact. evaluateAlert()'s plaza_crossing branch, in
-- src/lib/alerts.ts, reports when normaliseLocation(alert.plaza) EQUALS
-- normaliseLocation(the crossing) - trimmed, space-collapsed, lower-cased, and
-- nothing else. There is no similarity anywhere near it and there must not be:
-- a fuzzy evaluator would message about Bhatia when the officer asked about
-- Bhat, and it would do it at a credit a check.
--
-- So trigrams are used for one thing only - putting the right name in front of
-- the officer - and the value that gets STORED is a catalogue name, matched by
-- the same exact expression the worker uses:
--
--   lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
--
-- Written out at every use below rather than wrapped in a function of its own,
-- which is not laziness. This is the same expression as
-- truck_alerts_one_enabled_per_kind_idx in 0048, and that one is an INDEX:
-- 0048 explains why it is spelt out there, and an index cannot be taught to
-- call a function a later migration might redefine underneath it. Copies that
-- are literally identical to the index are safer than a shared definition that
-- only the index cannot follow.
--
-- ---------------------------------------------------------------------------
-- 6 · AND A NAME THAT MATCHES NOTHING IS THE ONE OUTCOME WORTH BLOCKING
--
-- A plaza_crossing alert on a name no toll record will ever produce is the
-- worst thing this form can build: it is silent for ever, indistinguishable
-- from "the truck has not got there yet", and it spends a credit on every
-- check while being silent. match_plazas() returns `exact` - the catalogue row
-- the typed name resolves to, or null - which is the one fact the form needs to
-- refuse it. The refusal itself, and why an unrecorded plaza is still allowed
-- through with a confirmation, is in TruckAlertForm.tsx and in the plaza
-- validation in src/app/portal/trucks/actions.ts.
--
-- Runs after 0050, which is not in the tree yet - that number is reserved, and
-- nothing here depends on whatever lands in it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 7 · Where each plaza is
-- ---------------------------------------------------------------------------
alter table public.toll_plazas
  add column if not exists lat numeric(10, 6),
  add column if not exists lng numeric(10, 6);

comment on column public.toll_plazas.lat is
  'Learned from the crossings that name this plaza, and kept after those crossings are pruned. Null until some truck has been recorded here with coordinates.';
comment on column public.toll_plazas.lng is
  'See lat. Written once and never overwritten - a toll plaza does not move, so the first reading is as good as any and a stable value cannot churn the suggestion list.';

/*
 * India, generously. Nothing else is a toll plaza this platform tracks, and
 * the reading worth guarding against is the 0,0 that a feed emits when it has
 * no fix - which would place every unplaced plaza in the Gulf of Guinea and
 * put the whole catalogue "ahead" of a lorry in Gujarat.
 */
create or replace function public.plaza_coords_sane(p_lat numeric, p_lng numeric)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select p_lat is not null and p_lng is not null
     and p_lat between 6 and 38 and p_lng between 68 and 98
$fn$;

revoke all on function public.plaza_coords_sane(numeric, numeric) from public;
revoke all on function public.plaza_coords_sane(numeric, numeric) from anon, authenticated;
grant execute on function public.plaza_coords_sane(numeric, numeric) to service_role;
grant execute on function public.plaza_coords_sane(numeric, numeric) to postgres;

/*
 * Whatever the surviving events can still place. Idempotent by the `is null`
 * guard, which is also what makes the column write-once: push-migrations.mjs
 * re-runs this file on every deploy and it must not re-decide a coordinate it
 * has already settled.
 */
update public.toll_plazas p
set lat = c.lat, lng = c.lng
from (
  select distinct on (e.loc_name) e.loc_name, e.lat, e.lng
  from public.truck_events e
  where e.loc_name is not null
    and public.plaza_coords_sane(e.lat, e.lng)
  order by e.loc_name, coalesce(e.event_time, e.fetched_at) desc
) c
where p.name = c.loc_name
  and p.lat is null;

-- ---------------------------------------------------------------------------
-- 8 · The catalogue learns from every crossing, as it lands
--
-- Statement level with a transition table rather than for-each-row: one sweep
-- inserts a truck's whole batch in a single statement, and a row-level trigger
-- would run the upsert once per crossing. It also has to be one statement per
-- name for a harder reason - ON CONFLICT DO UPDATE cannot touch the same row
-- twice in one command, and a batch routinely carries the same plaza twice, so
-- the names are grouped before they are written or the sweep would fail with
-- "cannot affect row a second time".
-- ---------------------------------------------------------------------------
create or replace function public.learn_plazas_from_events()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  insert into public.toll_plazas as t (name, seen_count, last_seen_at)
  select i.loc_name,
         count(*)::int,
         max(coalesce(i.event_time, i.fetched_at))
  from inserted i
  where i.loc_name is not null and btrim(i.loc_name) <> ''
  group by i.loc_name
  on conflict (name) do update
    set seen_count   = t.seen_count + excluded.seen_count,
        /* greatest(), not excluded: events arrive out of order and a backfilled
           crossing from last week must not drag last_seen_at backwards. */
        last_seen_at = greatest(t.last_seen_at, excluded.last_seen_at);

  /*
   * Coordinates second, and only onto a row that has none. Separate statement
   * because it is a different question with a different filter - the newest
   * SANE reading for each name, where the statement above wants every reading
   * counted - and one clever statement doing both reads worse than two plain
   * ones.
   */
  update public.toll_plazas p
  set lat = c.lat, lng = c.lng
  from (
    select distinct on (i.loc_name) i.loc_name, i.lat, i.lng
    from inserted i
    where i.loc_name is not null
      and public.plaza_coords_sane(i.lat, i.lng)
    order by i.loc_name, coalesce(i.event_time, i.fetched_at) desc
  ) c
  where p.name = c.loc_name
    and p.lat is null;

  return null;
end $$;

comment on function public.learn_plazas_from_events() is
  'Keeps public.toll_plazas abreast of every stored crossing: the name, its running count, and the plaza position lifted off the crossing and kept after the crossing is pruned. The alert form tests typed names against this catalogue, so the catalogue must never be behind the events.';

revoke all on function public.learn_plazas_from_events() from public;
revoke all on function public.learn_plazas_from_events() from anon, authenticated;
grant execute on function public.learn_plazas_from_events() to service_role;
grant execute on function public.learn_plazas_from_events() to postgres;

drop trigger if exists learn_plazas_from_events on public.truck_events;
create trigger learn_plazas_from_events
  after insert on public.truck_events
  referencing new table as inserted
  for each statement execute function public.learn_plazas_from_events();

-- ---------------------------------------------------------------------------
-- 9 · The distinctive part of a plaza name
-- ---------------------------------------------------------------------------
create or replace function public.plaza_core(p_name text)
returns text
language sql
immutable
parallel safe
as $fn$
  select coalesce(
    nullif(
      btrim(regexp_replace(
        regexp_replace(
          -- Punctuation to spaces first, so "L&T", "AMTL-TP-01" and
          -- "Km.946.300" break into words the pass below can recognise.
          regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g'),
          /*
           * The furniture. Bare numbers go with it - "Ahmedabad Ring Road 2"
           * and "Eethakota at Km.946.300" are a place plus a milestone, and
           * the milestone is never what anybody types. tol/tols are in the
           * list because they are how "toll" is misspelt, and a misspelling of
           * the generic word must not be left in the core to be compared.
           */
          '\y(toll|tol|tolls|tols|fee|plaza|plazas|plza|plz|check|post|checkpost|chowki|border|nh[0-9]*|tp[0-9]*|km|at|no|the|[0-9]+)\y',
          ' ', 'g'),
        '\s+', ' ', 'g')),
      ''),
    -- Nothing distinctive left, because the whole name was furniture. Compare
    -- on the normalised name rather than on the empty string, which would
    -- match everything at zero and make the row unfindable.
    btrim(regexp_replace(lower(coalesce(p_name, '')), '\s+', ' ', 'g'))
  )
$fn$;

comment on function public.plaza_core(text) is
  'A plaza name with the road furniture removed - "Mehsana Toll Plaza" to "mehsana". What trigram similarity is measured on, because the furniture is shared by most of the catalogue and swamps the part a person typed.';

revoke all on function public.plaza_core(text) from public;
revoke all on function public.plaza_core(text) from anon, authenticated;
grant execute on function public.plaza_core(text) to service_role;
grant execute on function public.plaza_core(text) to postgres;

/*
 * AND NO TRIGRAM INDEX ON IT, which is a deliberate reversal worth writing
 * down because a trigram index is the obvious thing to reach for here.
 *
 * A GIN trgm index answers exactly three things: the % operator, <%, and
 * LIKE/ILIKE patterns. It cannot answer `similarity(a, b) >= 0.25`; the only
 * index-served form of a threshold comparison is %, and % takes its threshold
 * from the pg_trgm.similarity_threshold session GUC rather than from the query.
 * Pinning that GUC on the function - `set pg_trgm.similarity_threshold` in
 * match_plazas() - is the documented way to do it, and on this project it does
 * not work: the postgres role here is not a superuser, and setting a parameter
 * belonging to a not-yet-loaded module is superuser-only, so
 *
 *     ERROR: permission denied to set parameter "pg_trgm.similarity_threshold"
 *
 * It is worse than a plain failure. The very first run of this file happened to
 * succeed, because building a gin_trgm_ops index in the same session loads the
 * pg_trgm module and the parameter becomes ordinary and settable - and the
 * second run failed, because `create index if not exists` had nothing to build.
 * A migration that only works the first time is no migration at all;
 * push-migrations.mjs re-runs every file on every deploy.
 *
 * So the threshold is written out as an explicit similarity() comparison, which
 * needs no GUC and no privilege and says its own number, and the query is a
 * sequential scan of toll_plazas. That is the right trade at this size and for
 * a long way past it: 80 rows today, and the whole country is on the order of a
 * thousand tolled plazas, so this is three regexp_replace calls over a table
 * that fits in a page or two, behind a 220 ms debounce. If the catalogue ever
 * does outgrow the scan, the fix is not this index - it is a stored core column
 * maintained by learn_plazas_from_events() with a gin_trgm_ops index on the
 * plain column, and % against it with the threshold set by whatever role
 * arrangement exists then.
 *
 * toll_plazas_name_trgm_idx from 0010 is left exactly where it is. It indexes
 * the whole name, which is not the string this file compares.
 */
drop index if exists public.toll_plazas_core_trgm_idx;

-- ---------------------------------------------------------------------------
-- 10 · Great-circle distance and bearing
--
-- No postgis and no earthdistance on this project, and neither is worth
-- installing for two formulae. Immutable and parallel safe so they can be used
-- freely in a where clause over the catalogue.
-- ---------------------------------------------------------------------------
create or replace function public.geo_km(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns numeric
language sql
immutable
parallel safe
as $fn$
  -- Haversine, mean earth radius 6371 km. Good to a few parts in a thousand at
  -- these distances, which is far inside the precision anybody reads off a
  -- "48 km" label.
  select round((2 * 6371 * asin(least(1, sqrt(
      sin(radians(p_lat2 - p_lat1) / 2) ^ 2
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * sin(radians(p_lng2 - p_lng1) / 2) ^ 2
    ))))::numeric, 3)
$fn$;

create or replace function public.geo_bearing(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns numeric
language sql
immutable
parallel safe
as $fn$
  -- Initial great-circle bearing, degrees clockwise from north, 0-360.
  select (degrees(atan2(
      sin(radians(p_lng2 - p_lng1)) * cos(radians(p_lat2)),
      cos(radians(p_lat1)) * sin(radians(p_lat2))
      - sin(radians(p_lat1)) * cos(radians(p_lat2)) * cos(radians(p_lng2 - p_lng1))
    ))::numeric + 360) % 360
$fn$;

revoke all on function public.geo_km(numeric, numeric, numeric, numeric) from public;
revoke all on function public.geo_km(numeric, numeric, numeric, numeric) from anon, authenticated;
grant execute on function public.geo_km(numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.geo_km(numeric, numeric, numeric, numeric) to postgres;

revoke all on function public.geo_bearing(numeric, numeric, numeric, numeric) from public;
revoke all on function public.geo_bearing(numeric, numeric, numeric, numeric) from anon, authenticated;
grant execute on function public.geo_bearing(numeric, numeric, numeric, numeric) to service_role;
grant execute on function public.geo_bearing(numeric, numeric, numeric, numeric) to postgres;

-- ---------------------------------------------------------------------------
-- 11 · What is ahead of one lorry
--
-- Returns an envelope rather than rows, because the empty list is an answer
-- here and the form has to be able to say WHICH empty list it is. `basis` is
-- the whole point of the shape:
--
--   ahead   a bearing and a position, so the rows are plazas the truck is
--           pointed at, nearest first. An empty list under this basis is a
--           real finding - "nothing we can place is in front of it" - and not
--           a reason to pad the list out with plazas behind the lorry, which
--           is the fault this migration exists to remove.
--   near    a position but no bearing: one crossing on record, or a second one
--           too close or too stale to be a direction of travel. Ordered by
--           distance and labelled as nearest, never as ahead.
--   none    nothing to measure from - no crossing at all, or a crossing whose
--           plaza has no coordinates yet. `at` still carries the plaza name
--           when there is one, so the form can say where it was last seen
--           while admitting it cannot say what comes next.
-- ---------------------------------------------------------------------------
create or replace function public.plazas_ahead(
  p_user  uuid,
  p_truck text,
  p_limit integer default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  /*
   * The cone. Half-angles, so 60 is a 120-degree fan in front of the lorry.
   *
   * Wider for a reported compass letter than for a measured bearing, because
   * the letter is only one of eight and is therefore worth +/-22.5 degrees
   * before any question of accuracy - on the crossings this was written
   * against, a letter of W accompanied a leg whose true bearing was 313, and
   * an N accompanied 335. Narrower than that and a lorry going north-west up
   * NH48 with "N" on its last crossing sees nothing ahead of it at all.
   */
  c_cone_route    constant numeric := 60;
  c_cone_reported constant numeric := 75;
  /*
   * A plaza under a kilometre away is the one the truck is standing at, under
   * a second spelling - the catalogue is keyed on the raw name, so "Bhatia
   * Toll Plaza" and "Bhatia  Toll Plaza" are two rows for one place. The name
   * test below removes the exact duplicate; this removes the near ones.
   */
  c_min_km        constant numeric := 1;
  /*
   * And a ceiling, because "upcoming" has to mean something. 500 km is about a
   * day's run for a lorry and it is deliberately generous: the catalogue can
   * place very few plazas so far, and a tight radius on sparse data returns an
   * empty list that reads as a fault. Every row shows its distance.
   */
  c_max_km        constant numeric := 500;

  v_at       text;
  v_lat      numeric;
  v_lng      numeric;
  v_dir      text;
  v_time     timestamptz;
  v_prev_lat numeric;
  v_prev_lng numeric;
  v_bearing  numeric;
  v_source   text;
  v_cone     numeric;
  v_rows     jsonb := '[]'::jsonb;
begin
  if p_user is null or coalesce(btrim(p_truck), '') = '' then
    return jsonb_build_object(
      'basis', 'none', 'at', null, 'heading', null, 'heading_from', null, 'plazas', v_rows);
  end if;

  /*
   * Scoped to the account's own crossings, exactly as the truck page is. Two
   * accounts can watch one registration number and each has its own history of
   * it; suggesting from the other one's would be answering with somebody
   * else's data.
   */
  select e.loc_name, e.lat, e.lng, e.direction, e.event_time
    into v_at, v_lat, v_lng, v_dir, v_time
  from public.truck_events e
  where e.user_id = p_user
    and e.truck_number = p_truck
    and e.loc_name is not null
    and btrim(e.loc_name) <> ''
  order by e.event_time desc nulls last, e.id desc
  limit 1;

  if v_at is null then
    return jsonb_build_object(
      'basis', 'none', 'at', null, 'heading', null, 'heading_from', null, 'plazas', v_rows);
  end if;

  /*
   * The leg it arrived on. Conditions, each of which is a way the bearing
   * would otherwise be a lie:
   *
   *   within 24 hours   a displacement measured across a longer gap can span a
   *                     whole unrecorded round trip, and would report the
   *                     bearing of the net drift rather than of the journey.
   *   at least 2 km     a plaza reports one crossing under several sequence
   *                     numbers, and the bearing between two readings of the
   *                     same gantry is noise pointing anywhere.
   */
  if public.plaza_coords_sane(v_lat, v_lng) and v_time is not null then
    select e.lat, e.lng
      into v_prev_lat, v_prev_lng
    from public.truck_events e
    where e.user_id = p_user
      and e.truck_number = p_truck
      and public.plaza_coords_sane(e.lat, e.lng)
      and e.event_time is not null
      and e.event_time < v_time
      and e.event_time > v_time - interval '24 hours'
      and public.geo_km(v_lat, v_lng, e.lat, e.lng) >= 2
    order by e.event_time desc, e.id desc
    limit 1;
  end if;

  if v_prev_lat is not null then
    v_bearing := public.geo_bearing(v_prev_lat, v_prev_lng, v_lat, v_lng);
    v_source  := 'route';
    v_cone    := c_cone_route;
  else
    /* Only one crossing, or none of them far enough apart. The feed's own
       compass letter is all that is left, and it is still a real reading. */
    v_bearing := case upper(btrim(coalesce(v_dir, '')))
                   when 'N'  then 0   when 'NE' then 45
                   when 'E'  then 90  when 'SE' then 135
                   when 'S'  then 180 when 'SW' then 225
                   when 'W'  then 270 when 'NW' then 315
                 end;
    v_source  := case when v_bearing is null then null else 'reported' end;
    v_cone    := c_cone_reported;
  end if;

  if public.plaza_coords_sane(v_lat, v_lng) then
    with placed as (
      select p.name,
             p.seen_count,
             public.geo_km(v_lat, v_lng, p.lat, p.lng)      as km,
             public.geo_bearing(v_lat, v_lng, p.lat, p.lng) as brg
      from public.toll_plazas p
      where public.plaza_coords_sane(p.lat, p.lng)
        -- The plaza it is standing at is not somewhere it is going. Compared
        -- the way the worker compares - see section 5.
        and lower(btrim(regexp_replace(p.name, '\s+', ' ', 'g')))
         <> lower(btrim(regexp_replace(v_at,   '\s+', ' ', 'g')))
    ),
    picked as (
      select name, seen_count, km
      from placed
      where km between c_min_km and c_max_km
        -- Signed difference folded to 0-180, so a cone across due north does
        -- not fall apart at the 359/0 seam.
        and (v_bearing is null
             or abs((((brg - v_bearing) + 540)::numeric % 360) - 180) <= v_cone)
      order by km
      limit greatest(coalesce(p_limit, 6), 1)
    )
    select coalesce(
             jsonb_agg(jsonb_build_object(
               'name', name, 'seen_count', seen_count, 'km', round(km)::int
             ) order by km),
             '[]'::jsonb)
      into v_rows
    from picked;
  end if;

  return jsonb_build_object(
    'basis',
      case
        when not public.plaza_coords_sane(v_lat, v_lng) then 'none'
        when v_bearing is null then 'near'
        else 'ahead'
      end,
    'at', v_at,
    -- Back as a compass letter, which is what the officer reads everywhere else
    -- on this truck's page. round() to the nearest eighth, wrapped.
    'heading',
      case when v_bearing is null then null
      else (array['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])[(round(v_bearing / 45.0)::int % 8) + 1]
      end,
    'heading_from', v_source,
    'plazas', v_rows
  );
end $fn$;

comment on function public.plazas_ahead(uuid, text, integer) is
  'Toll plazas one lorry is pointed at: its last crossing is the point, its last leg the bearing, and the catalogue''s learned coordinates the candidates. Returns basis = ahead | near | none so the caller can say which question it is answering rather than presenting a weaker answer as the strong one.';

revoke all on function public.plazas_ahead(uuid, text, integer) from public;
revoke all on function public.plazas_ahead(uuid, text, integer) from anon, authenticated;
grant execute on function public.plazas_ahead(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 12 · A typed name, matched on the part that is a name
--
-- `exact` is separate from `matches` and is the more important half. It is the
-- catalogue row the typed text resolves to under the worker's own comparison,
-- or null - which is the form's answer to "will an alert on this name ever
-- fire?". A name with nine close matches and no exact one still gets a null
-- there, because nine near misses do not make an alert fire.
-- ---------------------------------------------------------------------------
create or replace function public.match_plazas(
  p_q     text,
  p_limit integer default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  /*
   * Measured, not chosen - section 4 has the numbers off the live catalogue.
   * Every real misspelling of a real plaza name scores 0.30 or better and
   * nothing that is not a plaza name gets past 0.15, so this sits in the
   * middle of the widest gap the data offers. Written out as a comparison
   * rather than handed to the % operator: see the note above plaza_core().
   */
  c_threshold constant real := 0.25;

  v_key   text;
  v_core  text;
  v_exact text;
  v_rows  jsonb;
begin
  v_key := nullif(lower(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'))), '');

  /*
   * A blank box gets nothing, deliberately. This is where the old
   * "MOST RECORDED PLAZAS" list came from - search_plazas() with a null query -
   * and a platform-wide popularity ranking is exactly what the owner asked to
   * be rid of. An empty box is answered by plazas_ahead() or by nothing at all.
   */
  if v_key is null then
    return jsonb_build_object('query', null, 'exact', null, 'matches', '[]'::jsonb);
  end if;

  select p.name
    into v_exact
  from public.toll_plazas p
  where lower(btrim(regexp_replace(p.name, '\s+', ' ', 'g'))) = v_key
  order by p.seen_count desc, p.name
  limit 1;

  v_core := public.plaza_core(p_q);

  with scored as (
    select p.name,
           p.seen_count,
           case
             /* An exact hit outranks everything, however the trigrams fall. */
             when lower(btrim(regexp_replace(p.name, '\s+', ' ', 'g'))) = v_key then 1.0
             /* Typing is a prefix before it is a spelling mistake: three
                letters of "meh" must put Mehsana at the top, and its trigram
                similarity against the short query is only about 0.33. */
             when public.plaza_core(p.name) like v_core || '%' then 0.95
             when public.plaza_core(p.name) like '%' || v_core || '%' then 0.9
             else similarity(public.plaza_core(p.name), v_core)
           end::real as score
    from public.toll_plazas p
    where similarity(public.plaza_core(p.name), v_core) >= c_threshold
       -- plaza_core() emits only a-z, 0-9 and single spaces, so this pattern
       -- cannot carry a % or _ of the caller's own.
       or public.plaza_core(p.name) like '%' || v_core || '%'
  )
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'name', t.name, 'seen_count', t.seen_count, 'score', round(t.score::numeric, 3)
           ) order by t.score desc, t.seen_count desc, t.name),
           '[]'::jsonb)
    into v_rows
  from (
    select * from scored
    order by score desc, seen_count desc, name
    limit greatest(coalesce(p_limit, 6), 1)
  ) t;

  return jsonb_build_object('query', v_key, 'exact', v_exact, 'matches', v_rows);
end $fn$;

comment on function public.match_plazas(text, integer) is
  'Fuzzy plaza lookup for the alert form: trigram similarity on plaza_core(), plus `exact` - the catalogue name the typed text resolves to under the worker''s own comparison, or null when an alert on it could never fire.';

revoke all on function public.match_plazas(text, integer) from public;
revoke all on function public.match_plazas(text, integer) from anon, authenticated;
grant execute on function public.match_plazas(text, integer) to service_role;
