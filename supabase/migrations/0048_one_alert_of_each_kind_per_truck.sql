-- ===========================================================================
-- One alert of each kind per truck, refused by the database.
--
-- ---------------------------------------------------------------------------
-- 1 · THE RULE, IN THE OWNER'S WORDS
--
--     "also single alert can be use only once : Location changed. now it can
--      not be add again for that perticuler truck ( ex.. 15 min and 30 min
--      check to loc change ). wire proper. merge all every X=15 min to check
--      loc change or not"
--
-- Nothing stopped a truck carrying two alerts on the same rule. So "Location
-- changed every 15 minutes" and "Location changed every 30 minutes" could both
-- sit on one lorry, and the worker polls on the union of every due alert - see
-- the `due` list in src/lib/tracking.ts. Four times an hour from the first, two
-- from the second, and the two coincide only every half hour: six checks an
-- hour where the officer asked one question. Since 0041 every automatic check
-- is one credit, so that is the officer paying six credits an hour to be told
-- the same thing, and being messaged twice each time it changes.
--
-- ---------------------------------------------------------------------------
-- 2 · WHAT COUNTS AS "THE SAME ALERT": KIND, NOT TEMPLATE, AND THE PLAZA
--
-- Per KIND rather than per template_id. alert_rule_templates is a catalogue an
-- admin writes without a deploy: nothing stops two rows of kind
-- 'location_change' with different names, and today's live catalogue has
-- already been renamed and reordered by hand. Keyed on template_id, "Location
-- changed" and a second rule called "Location changed (fast)" would be two
-- different alerts to the database and one identical question to the officer -
-- exactly the case this file exists to refuse. The kind is what evaluateAlert()
-- switches on, so the kind is what the money follows.
--
-- The plaza IS part of the key, and that is what keeps 'plaza_crossing'
-- usable. It watches one NAMED plaza, so two rows for two different plazas are
-- two different questions - "tell me when it reaches Nadiad" and "tell me when
-- it reaches Malvan" - and a per-kind rule alone would refuse the second one.
-- The other two kinds have no plaza to name and always store null there (see
-- needsPlaza() in src/lib/alerts.ts, which is what nulls it on the way in), so
-- every row of those kinds keys on the empty string and collides as intended.
-- coalesce() rather than a bare column, because null is never equal to null in
-- a unique index: without it two null-plaza rows would BOTH be allowed and this
-- whole file would enforce nothing at all.
--
-- The plaza is normalised the way normaliseLocation() in src/lib/alerts.ts
-- normalises it - trimmed, collapsed spacing, lower case - because that is how
-- the alert MATCHES at evaluation time. "Nadiad Toll Plaza" and " nadiad  toll
-- plaza " are one plaza to the worker, so letting them be two rows would bring
-- the double charge back through the door the plaza exemption has to leave
-- open.
--
-- ---------------------------------------------------------------------------
-- 3 · WHY THE INDEX NEEDS A COLUMN ON THE ROW
--
-- kind lives on alert_rule_templates and an index can only see the row it is
-- built on, so the kind is mirrored onto truck_alerts and DERIVED rather than
-- trusted: the trigger below overwrites it from the template on every insert
-- and every update, so there is no value an app, a form or a console can put
-- there that disagrees with the catalogue. Same argument, and the same shape,
-- as plans_derive_mirrors() in 0042.
--
-- ---------------------------------------------------------------------------
-- 4 · WHY THE INDEX IS PARTIAL ON is_enabled
--
-- Only alerts that are switched ON can collide, because only they cost
-- anything: a switched-off row makes no upstream call and spends no credit, so
-- there is no double charge to refuse. And it is worth keeping - it carries the
-- interval the officer chose and, more importantly, last_location and
-- last_event_at, the baseline that stops "Turn on" firing a message about a
-- crossing the officer was already told about weeks ago. Deleting it to satisfy
-- a stricter index would throw that away to enforce a rule about money that a
-- silent row does not spend.
--
-- The forms go further than the index and refuse a SECOND ROW of a kind at all,
-- switched on or off, because two rows of one kind in a list is confusing
-- whatever their state - see addTruckAlert() in
-- src/app/portal/trucks/actions.ts. That is advice with a good reason; this is
-- the rule.
--
-- ---------------------------------------------------------------------------
-- 5 · THE FOLD KEEPS THE FASTEST BEAT, AND THE OLDEST ROW
--
-- Duplicates that already exist are folded, never orphaned. The survivor is the
-- OLDEST row of each group and it takes the SHORTEST interval in that group.
--
-- The shortest interval, because that is the beat the truck is already being
-- checked on and the officer is already paying for. A 15 and a 30 on one lorry
-- poll every 15 minutes today; folding to the slower of the two would halve the
-- coverage of a truck nobody asked to change, and the crossing that goes
-- unreported is the one they were paying to catch. Making an alert slower is a
-- change an officer would notice and did not ask for; leaving it as fast as it
-- was is the status quo, and it is trivially reversible from the truck's own
-- page now that the interval is editable there.
--
-- The oldest ROW, because a row is not only an interval: last_run_at,
-- last_location and last_event_at are on it, and its id is what alert_logs
-- rows already point at. Keeping the oldest and moving the interval onto it
-- means nothing loses its history. The bookkeeping itself is taken from
-- whichever row in the group reported most recently, so the survivor cannot
-- re-announce a crossing a sibling already sent.
--
-- Idempotent, and it has to be: scripts/push-migrations.mjs re-runs every file
-- on every deploy. After one pass each group holds a single enabled row, so the
-- fold matches nothing and the index is already there.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 6 · The mirrored kind
-- ---------------------------------------------------------------------------
alter table public.truck_alerts
  add column if not exists template_kind text;

comment on column public.truck_alerts.template_kind is
  'Mirror of alert_rule_templates.kind, kept by derive_truck_alert_kind(). Exists so the one-alert-of-each-kind index can be built on this table; never write it by hand.';

/*
 * Backfill before the column is made not-null, and before the fold - the fold
 * groups on it.
 */
update public.truck_alerts a
set template_kind = t.kind
from public.alert_rule_templates t
where t.id = a.template_id
  and (a.template_kind is null or a.template_kind <> t.kind);

alter table public.truck_alerts
  alter column template_kind set not null;

create or replace function public.derive_truck_alert_kind()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  /*
   * Derived on every write rather than only when template_id is mentioned, so
   * a hand-written UPDATE that names template_kind cannot leave the row
   * claiming to be a kind its template is not. There is no value to trust here:
   * the catalogue is the only source.
   */
  select t.kind into new.template_kind
  from public.alert_rule_templates t
  where t.id = new.template_id;

  /*
   * The foreign key would refuse this too, at the end of the statement. Said
   * here in words because a BEFORE trigger runs first, and "null value in
   * column template_kind" is not an error message that tells anybody the
   * template id was wrong.
   */
  if new.template_kind is null then
    raise exception 'No alert rule with id % exists, so nothing can be watched.', new.template_id;
  end if;

  return new;
end $$;

comment on function public.derive_truck_alert_kind() is
  'Copies the alert rule''s kind onto truck_alerts.template_kind on every insert and update. The one-enabled-alert-per-kind index is built on that column, so this is what makes the index mean what it says.';

/*
 * Not SECURITY DEFINER: a plpgsql function returning trigger raises if it is
 * invoked any other way, so there is nothing here for a caller to reach. The
 * grants are the house rule regardless - service_role is the role the app
 * writes alerts as, postgres is the role migrations run as, and the trigger has
 * to fire whichever of them does the write.
 */
revoke all on function public.derive_truck_alert_kind() from public;
revoke all on function public.derive_truck_alert_kind() from anon, authenticated;
grant execute on function public.derive_truck_alert_kind() to service_role;
grant execute on function public.derive_truck_alert_kind() to postgres;

drop trigger if exists derive_truck_alert_kind on public.truck_alerts;
create trigger derive_truck_alert_kind
  before insert or update on public.truck_alerts
  for each row execute function public.derive_truck_alert_kind();

/*
 * And the other direction: updateAlertRule() in src/app/admin/alerts/actions.ts
 * lets a super admin change an existing rule's kind, which silently changes
 * what every alert built on it watches for. Without this the mirror would go
 * stale on the officers' rows and the index would be guarding a question none
 * of them is asking any more.
 */
create or replace function public.propagate_alert_rule_kind()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  if new.kind is distinct from old.kind then
    begin
      update public.truck_alerts set template_kind = new.kind where template_id = new.id;
    exception when unique_violation then
      /*
       * Re-kinding a rule can collide two alerts that were different questions
       * a moment ago: a truck watching one plaza AND watching for movement now
       * has two movement alerts. Refused with words rather than an index name,
       * because the admin has to go and remove one of them by hand and only the
       * officer's own page can say which.
       */
      raise exception
        'Rule "%" cannot change to % - a truck already has another % alert switched on. Remove one of them from that truck first.',
        new.name, new.kind, new.kind;
    end;
  end if;
  return null;
end $$;

comment on function public.propagate_alert_rule_kind() is
  'Pushes a changed alert_rule_templates.kind out to every truck_alerts row built on that rule, so the mirrored kind cannot go stale under the uniqueness index.';

revoke all on function public.propagate_alert_rule_kind() from public;
revoke all on function public.propagate_alert_rule_kind() from anon, authenticated;
grant execute on function public.propagate_alert_rule_kind() to service_role;
grant execute on function public.propagate_alert_rule_kind() to postgres;

drop trigger if exists propagate_alert_rule_kind on public.alert_rule_templates;
create trigger propagate_alert_rule_kind
  after update of kind on public.alert_rule_templates
  for each row execute function public.propagate_alert_rule_kind();

-- ---------------------------------------------------------------------------
-- 7 · Folding the duplicates that already exist
--
-- The interval and the bookkeeping move onto the survivor FIRST, because both
-- are read from rows the next statement deletes.
-- ---------------------------------------------------------------------------
with keyed as (
  select
    a.id,
    a.tracked_truck_id,
    a.template_kind,
    /* Written out rather than shared with the index below: an index expression
       cannot be a view or a variable, and a function would make the index
       depend on something a later migration could redefine underneath it. */
    coalesce(lower(btrim(regexp_replace(a.plaza, '\s+', ' ', 'g'))), '') as plaza_key,
    a.interval_minutes,
    a.last_run_at,
    a.last_location,
    a.last_event_at,
    a.created_at
  from public.truck_alerts a
  where a.is_enabled
),
duplicated as (
  select tracked_truck_id, template_kind, plaza_key, min(interval_minutes) as fastest
  from keyed
  group by 1, 2, 3
  having count(*) > 1
),
survivor as (
  select distinct on (k.tracked_truck_id, k.template_kind, k.plaza_key)
    k.id,
    k.tracked_truck_id,
    k.template_kind,
    k.plaza_key,
    d.fastest
  from keyed k
  join duplicated d
    on d.tracked_truck_id = k.tracked_truck_id
   and d.template_kind = k.template_kind
   and d.plaza_key = k.plaza_key
  order by k.tracked_truck_id, k.template_kind, k.plaza_key, k.created_at, k.id
),
/* Whichever of the duplicates last told the officer something. Carrying that
   forward is what stops the survivor re-reporting a crossing a sibling has
   already sent - the "is this new" test in evaluateAlert() is last_event_at. */
reported as (
  select distinct on (k.tracked_truck_id, k.template_kind, k.plaza_key)
    k.tracked_truck_id,
    k.template_kind,
    k.plaza_key,
    k.last_run_at,
    k.last_location,
    k.last_event_at
  from keyed k
  join duplicated d
    on d.tracked_truck_id = k.tracked_truck_id
   and d.template_kind = k.template_kind
   and d.plaza_key = k.plaza_key
  order by
    k.tracked_truck_id, k.template_kind, k.plaza_key,
    k.last_event_at desc nulls last, k.last_run_at desc nulls last, k.id
)
update public.truck_alerts a
set interval_minutes = s.fastest,
    last_run_at   = r.last_run_at,
    last_location = r.last_location,
    last_event_at = r.last_event_at
from survivor s
join reported r
  on r.tracked_truck_id = s.tracked_truck_id
 and r.template_kind = s.template_kind
 and r.plaza_key = s.plaza_key
where a.id = s.id;

/*
 * And the losers go. Same shape as the template repair in 0008: a row is a
 * duplicate when an older enabled row on the same truck asks the same question,
 * so exactly one row of each group survives however many there were.
 */
delete from public.truck_alerts a
where a.is_enabled
  and exists (
    select 1
    from public.truck_alerts other
    where other.is_enabled
      and other.tracked_truck_id = a.tracked_truck_id
      and other.template_kind = a.template_kind
      and coalesce(lower(btrim(regexp_replace(other.plaza, '\s+', ' ', 'g'))), '')
        = coalesce(lower(btrim(regexp_replace(a.plaza, '\s+', ' ', 'g'))), '')
      and (other.created_at, other.id) < (a.created_at, a.id)
  );

-- ---------------------------------------------------------------------------
-- 8 · The rule itself
-- ---------------------------------------------------------------------------
create unique index if not exists truck_alerts_one_enabled_per_kind_idx
  on public.truck_alerts (
    tracked_truck_id,
    template_kind,
    coalesce(lower(btrim(regexp_replace(plaza, '\s+', ' ', 'g'))), '')
  )
  where is_enabled;

comment on index public.truck_alerts_one_enabled_per_kind_idx is
  'At most one switched-on alert per truck per kind - per plaza for plaza_crossing, which names the plaza it watches. Two alerts of one kind means the truck is polled on the union of both beats and charged for every check, which is the officer paying twice for one question.';
