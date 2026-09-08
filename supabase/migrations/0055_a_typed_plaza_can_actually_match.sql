-- ===========================================================================
-- An alert on a plaza the officer TYPED can now actually fire.
--
-- The owner: "reach at toll plaza alert: if given toll is get by search then
-- perfect to chose, but if not found then?? then it still use as a name like
-- hathijan, then all loc status after X min can check name with hathijan toll
-- plaza with fuzzy logic ... if match then send alert else not."
--
-- ---------------------------------------------------------------------------
-- 1 · THE BUG THIS FIXES, WHICH IS WORSE THAN A MISSING FEATURE
--
-- toll_plazas is learned from crossings - learn_plazas_from_events() in 0051 -
-- so a plaza no tracked lorry has ever passed is absent. Hathijan is one of
-- those: match_plazas('hathijan') returns exact null and no matches at all.
-- The form allows a typed name anyway, behind a confirmation tick, because
-- refusing would mean an officer cannot watch a plaza until somebody else's
-- lorry has been through it.
--
-- But the evaluator compared the watched name to the recorded one for equality
-- after folding case and runs of spaces, and nothing else. So: the officer
-- types "hathijan", the portal records "Hathijan Toll Plaza", and those are not
-- equal. The alert never fired. Not late, not twice - never, silently, while
-- every check still cost a credit.
--
-- And this was the normal case, not an edge one. Of the 87 names in the live
-- catalogue, 67 carry "Toll Plaza", "TP", "Fee Plaza" or similar furniture -
-- 77%. Nobody types that suffix. So the confirm-and-watch path the form offers
-- was, in the large majority of cases, a promise the evaluator could not keep.
--
-- ---------------------------------------------------------------------------
-- 2 · WHAT THIS FILE ADDS
--
-- One column, truck_alerts.plaza_match, recording HOW the plaza was chosen:
--
--   'exact' - picked from the catalogue. The stored name is the catalogue's own
--             spelling, so a crossing at that plaza matches it.
--   'fuzzy' - typed and confirmed as unlisted. The officer's spelling and the
--             portal's are not expected to agree.
--
-- The matching itself lives in src/lib/plaza-match.ts, next to the evaluator
-- that uses it, and its header carries the full reasoning. In short: both modes
-- match on the folded name and on plaza_core() equality - the latter is what
-- turns "hathijan" into a match for "Hathijan Toll Plaza", and across all 87
-- catalogue names NO TWO DISTINCT NAMES SHARE A CORE, so it cannot conflate two
-- plazas. Trigram similarity is tried only for 'fuzzy', at or above a
-- threshold.
--
-- ---------------------------------------------------------------------------
-- 3 · WHY SIMILARITY IS RESTRICTED, AND WHERE 0.6 COMES FROM
--
-- 0051 said there must be no similarity near the evaluator, because it would
-- "message about Bhatia when the officer asked about Bhat". That was right
-- about the danger and wrong to stop there, since it left the typed path unable
-- to fire. So the danger was measured across every pair of distinct plazas in
-- the live catalogue:
--
--   0.556  "ahmedabad"           vs "ahmedabad ring road"      different plazas
--   0.500  "bhat"                vs "bhatia"                   different plazas
--   0.500  "bhagwada"            vs "bhatwada"                 different plazas
--   0.500  "kheda"               vs "khedi"                    different plazas
--   0.857  "ahmedabad ring road" vs "ahmedabad ring road pl"   ONE plaza, twice
--
-- Bhat and Bhatia are both real, both in the catalogue, and score 0.500. The
-- highest score between two genuinely different plazas is 0.556. The only pair
-- above that is two spellings of a single plaza, at 0.857. 0.6 sits in that gap:
-- high enough to refuse all four confusions, low enough to still recognise a
-- plaza the catalogue holds under two names.
--
-- It is a setting rather than a constant so it can be moved - but anyone moving
-- it below 0.56 is buying the Bhat/Bhatia confusion, at a credit a check.
-- scripts/check-plaza-match.mjs re-measures this on every run and warns when a
-- newly learned plaza changes the picture.
--
-- Word containment was considered as a further rule and rejected by the same
-- data: "ahmedabad" is a whole-word prefix of "ahmedabad ring road", and those
-- are two different plazas.
--
-- ---------------------------------------------------------------------------
-- 4 · THE BACKFILL REPAIRS EXISTING ALERTS
--
-- Every plaza alert that already exists is classified by asking the question
-- the form asked at the time: is this name in the catalogue? If it is not, the
-- alert was created through the unlisted path and has been unable to fire, so
-- it becomes 'fuzzy' and starts working. Nothing is deleted and no alert is
-- switched on or off - only how its name is compared changes.
--
-- ---------------------------------------------------------------------------
-- 5 · IDEMPOTENT, BECAUSE npm run migrate RE-RUNS EVERY FILE
--
-- The column is added if absent; the backfill is confined to rows that are
-- still NULL, so a second run classifies nothing a second time and cannot
-- overwrite a mode an officer or an admin has since changed. The setting is
-- inserted on conflict do nothing.
-- ===========================================================================

alter table public.truck_alerts
  add column if not exists plaza_match text;

/*
 * The check constraint is added separately and guarded, because `add column if
 * not exists` will not add one to a column that already exists, and a plain
 * `add constraint` fails on a re-run.
 */
do $blk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'truck_alerts_plaza_match_chk'
      and conrelid = 'public.truck_alerts'::regclass
  ) then
    alter table public.truck_alerts
      add constraint truck_alerts_plaza_match_chk
      check (plaza_match is null or plaza_match in ('exact', 'fuzzy'));
  end if;
end $blk$;

comment on column public.truck_alerts.plaza_match is
  'How the watched plaza was chosen: exact = picked from the catalogue, fuzzy = typed and confirmed unlisted. Only fuzzy is compared by trigram similarity; both are compared on the folded name and on plaza_core(). NULL on a non-plaza alert.';

-- ---------------------------------------------------------------------------
-- The backfill
-- ---------------------------------------------------------------------------
/*
 * Only rows that are still NULL and are actually plaza alerts. template_kind is
 * the mirror 0048 put on this table for exactly this sort of query, so the
 * classification does not have to join the template catalogue that an admin can
 * rename.
 *
 * The catalogue test is the evaluator's own folding - lower, trim, collapse
 * runs of whitespace - and NOT plaza_core(), because the question being asked
 * is "would the old exact comparison ever have matched this name", and that
 * comparison was the folded one.
 */
update public.truck_alerts a
set plaza_match = case
      when exists (
        select 1 from public.toll_plazas p
        where lower(btrim(regexp_replace(p.name, '\s+', ' ', 'g')))
            = lower(btrim(regexp_replace(a.plaza, '\s+', ' ', 'g')))
      ) then 'exact'
      else 'fuzzy'
    end,
    updated_at = now()
where a.plaza_match is null
  and a.template_kind = 'plaza_crossing'
  and a.plaza is not null
  and btrim(a.plaza) <> '';

-- ---------------------------------------------------------------------------
-- The threshold
-- ---------------------------------------------------------------------------
/*
 * Read by src/lib/settings.ts and passed into matchPlaza(). Stored as a jsonb
 * number like every other numeric setting in this table.
 */
insert into public.app_settings (key, value)
values ('plaza_match_threshold', '0.6'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- An index for the classification, not for the evaluator
-- ---------------------------------------------------------------------------
/*
 * The worker loads a truck's alerts by tracked_truck_id and already has an
 * index for that, so this is not on the hot path. It is here for the admin
 * screens that ask "which alerts are watching a plaza we have never recorded",
 * which is the question that finds an officer whose alert will never fire
 * because they typed a name that is not a plaza at all.
 */
create index if not exists truck_alerts_plaza_match_idx
  on public.truck_alerts (plaza_match)
  where plaza_match is not null;
