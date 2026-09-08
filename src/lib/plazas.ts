import { normaliseLocation } from "@/lib/alerts";

/**
 * Which toll plaza to watch, and how the form is allowed to talk about it.
 *
 * The plaza_crossing alert names one plaza and messages when the truck is
 * recorded there. The picker used to offer a list headed MOST RECORDED PLAZAS -
 * toll_plazas ordered by seen_count, a popularity ranking across the whole
 * platform - which has no relationship at all to the lorry in front of the
 * officer. As the owner put it: "officer need upcoming toll from current loc..
 * not past. currently it shows random basis dropdown."
 *
 * Two answers, and they are different questions:
 *
 *   AHEAD    computed from this truck's own crossings. Its last crossing is a
 *            point, its last leg is a bearing, and a plaza is ahead when it is
 *            in a cone around that bearing. plazas_ahead() in migration 0051
 *            does the geometry; everything here is what the form is allowed to
 *            SAY about the answer, which depends entirely on which of the two
 *            facts was actually available.
 *   TYPED    fuzzy, so a spelling mistake still finds the plaza. match_plazas()
 *            in the same migration, trigram similarity on the distinctive part
 *            of the name.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT THIS FILE EXISTS TO HOLD
 *
 * Fuzzy matching FINDS a plaza. It never decides whether an alert fires.
 *
 * evaluateAlert()'s plaza_crossing branch in src/lib/alerts.ts reports when
 * normaliseLocation(alert.plaza) EQUALS normaliseLocation(the crossing) -
 * trimmed, space-collapsed, lower-cased, and nothing else. So the value the
 * form stores has to be a name the toll record actually produces, and the test
 * for "is this such a name" is exact equality against the catalogue under that
 * same normalisation - which is what `exact` below is, and why it is kept
 * apart from `matches`. Nine near misses do not make an alert fire.
 *
 * Deliberately no DB access in here: the form imports these types and this copy
 * into the browser. The queries live in src/app/portal/trucks/actions.ts.
 */

/* -------------------------------------------------------------------------- */
/* rows                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One offered plaza. The same shape for both lists, because they are drawn by
 * one row component - only the note on the right differs, and which of these
 * two fields is set is what decides it.
 */
export type PlazaSuggestion = {
  name: string;
  seen_count: number;
  /**
   * Great-circle kilometres from the truck's last crossing. GREAT CIRCLE, not
   * road distance, so it always understates - see the (i) copy below, which
   * says so rather than letting a reader assume otherwise. Null on a row
   * nobody's position produced, i.e. every typed match.
   */
  km: number | null;
  /** Trigram similarity of the typed text, 0-1. Null on a row nobody typed. */
  score: number | null;
};

/* -------------------------------------------------------------------------- */
/* what is ahead                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How much the data supported, which is the only thing that decides what the
 * form may claim.
 *
 *   ahead   a position AND a bearing. The rows are plazas the truck is pointed
 *           at. An empty list here is a real finding - nothing we can place is
 *           in front of it - and not licence to pad the list with plazas
 *           behind the lorry, which is the fault being removed.
 *   near    a position but no bearing: one crossing on record, or no second one
 *           far enough away and recent enough to be a direction of travel.
 *           Ordered by distance, and the form says nearest, never ahead.
 *   none    nothing to measure from. `at` may still name the last plaza - the
 *           catalogue has no coordinates for it yet - or the truck may have no
 *           crossing at all, which is every truck on the add form.
 */
export type AheadBasis = "ahead" | "near" | "none";

/** The envelope plazas_ahead() returns, in the app's own casing. */
export type PlazasAhead = {
  basis: AheadBasis;
  /** The plaza it was last recorded at, exactly as the toll record spelt it. */
  at: string | null;
  /** Compass letter, or null when neither the route nor the feed gave one. */
  heading: string | null;
  /**
   * Where the heading came from. 'route' is measured between two crossings;
   * 'reported' is the feed's own laneDirection letter, which is one of eight
   * and therefore worth +/-22.5 degrees before any question of accuracy.
   *
   * Deliberately not rendered anywhere. The two do not deserve equal
   * confidence and they do not get it - plazas_ahead() widens the cone from 60
   * degrees to 75 for a reported letter, which is where that difference has a
   * consequence. Putting it on screen as well would be decoration: it is not a
   * distinction the officer can do anything about. Carried because throwing
   * away what the answer was built from at the boundary is how the next person
   * ends up guessing.
   */
  headingFrom: "route" | "reported" | null;
  plazas: PlazaSuggestion[];
};

/** No truck, or no answer from the database. The honest zero of this type. */
export const NO_POSITION: PlazasAhead = {
  basis: "none",
  at: null,
  heading: null,
  headingFrom: null,
  plazas: [],
};

/**
 * The heading above the suggestion list, which has to name the list's basis.
 *
 * A list of plazas under no explanation is exactly what was wrong before: the
 * reader assumed the ordering meant something about their truck. Four words in
 * the same uppercase micro-label the picker already used, so it costs no
 * height and is not a hint.
 */
export function aheadLabel(ahead: PlazasAhead): string {
  if (ahead.basis === "ahead") {
    return ahead.heading ? `Ahead, heading ${ahead.heading}` : "Ahead of it";
  }
  return "Nearest to it now";
}

/**
 * Why the list is empty, when it is.
 *
 * Only ever rendered in place of a list, so it is state rather than
 * explanation - the same rule the interval warning on this form follows. Each
 * one ends by pointing at the box, because typing is always available and is
 * the answer in every one of these cases.
 */
export function aheadEmptyNote(ahead: PlazasAhead): string {
  /* One line each, and the reason WHY the list is empty is behind the (i) with
     the rest of the prose. Longer versions of these read as an apology, and an
     apology is a paragraph appearing on the form by default - which is the one
     thing this form is not allowed to grow. */
  if (ahead.basis === "ahead") {
    return `At ${ahead.at}, heading ${ahead.heading}. Nothing we can place is ahead of it yet - type the plaza name.`;
  }
  if (ahead.at) {
    return `Last recorded at ${ahead.at}. We cannot tell what is ahead of it - type the plaza name.`;
  }
  return "No crossing on record for this truck yet, so nothing is known to be ahead of it. Type the plaza name.";
}

/** What sits behind the (i), so none of the above needs saying on the form. */
export const PLAZA_INFO_LINES = {
  ahead:
    "Worked out from this truck's own crossings: where it was last recorded, and which way that leg was pointing. Distances are straight-line, so the road is always longer, and nothing here knows where the lorry is going next - a plaza on the list is one it is pointed at. We only learn where a plaza is once some truck has been recorded there, so an empty list means we cannot place anything in front of this one yet, not that there is nothing there.",
  typing:
    "Spelling mistakes are fine - we match on the shape of the name, so a letter out either way still finds it. What we cannot do is invent a plaza: an alert fires when the toll record names the plaza you picked, so the name has to be one the network actually uses. Capitals and extra spaces do not matter.",
} as const;

/* -------------------------------------------------------------------------- */
/* a typed name                                                                */
/* -------------------------------------------------------------------------- */

/** The envelope match_plazas() returns, in the app's own casing. */
export type PlazaLookup = {
  /** The typed text, normalised. Null when the box was blank. */
  query: string | null;
  /**
   * The catalogue name this text resolves to under the worker's own
   * comparison, or null. THE field that decides whether an alert on it could
   * ever fire, which is why it is not just the top of `matches`.
   */
  exact: string | null;
  matches: PlazaSuggestion[];
};

export const NO_MATCHES: PlazaLookup = { query: null, exact: null, matches: [] };

/** The field the form posts when the officer insists on a name we do not have. */
export const PLAZA_UNLISTED_FIELD = "plaza_unlisted_ok";

/**
 * Is the typed text already the name of a plaza we hold?
 *
 * The same expression as the evaluator, via the evaluator's own function, so
 * the form cannot promise a match the worker will not make. A lookup that has
 * not come back yet answers false, and the caller must not act on that until
 * it has - see `settled` in PlazaPicker.
 */
export function isKnownPlaza(typed: string, lookup: PlazaLookup): boolean {
  const key = normaliseLocation(typed);
  return key !== null && normaliseLocation(lookup.exact) === key;
}

/**
 * The one refusal worth making, and why it is a refusal rather than a hint.
 *
 * It is NOT refused outright, because an unrecorded plaza is a legitimate thing
 * to watch: this catalogue holds under a hundred names and the country has well
 * over a thousand tolled plazas, so a plaza the platform has never seen is far
 * more often new than misspelt. The discrimination that matters is whether
 * anything close exists - a near miss is a typo and gets offered as one;
 * nothing close is either a new plaza or nonsense, and only the officer can
 * tell which.
 *
 * WHY THESE WORDS CHANGED. They used to say the alert "stays silent for ever
 * and still spends a credit on every check", which was true when the evaluator
 * compared the two names for equality: the officer typed "hathijan", the record
 * said "Hathijan Toll Plaza", and nothing ever matched. Since 0055 a typed name
 * is compared with the road furniture removed and with a tolerance for
 * misspelling, so it does fire - and telling somebody their alert is doomed
 * when it is not would talk them out of the thing that now works.
 *
 * What is still worth warning about is narrower and worth saying plainly: a
 * name that is a misspelling of a DIFFERENT plaza, or not a plaza at all, still
 * never fires. That is the case the officer is being asked to rule out, and it
 * is the only one they can rule out - we cannot.
 *
 * Shared with the server action so the words a stale form is refused with are
 * the same words it would have shown.
 */
export function unlistedPlazaError(typed: string, closest: string | null): string {
  const name = typed.trim();
  return closest
    ? `We have no plaza recorded as "${name}" - did you mean ${closest}? Picking the match is surest. Otherwise confirm "${name}" and we will watch for it, allowing for "Toll Plaza" and small spelling differences.`
    : `We have no plaza recorded as "${name}", and nothing close to it. If it is a plaza we have simply never seen, confirm it and we will watch for it - we allow for "Toll Plaza" and small spelling differences. If it is a misspelling of somewhere else, the alert will never fire, so check it first.`;
}

/** The tick-box's own words. Short, because the panel above it has said it. */
export function unlistedPlazaConfirm(typed: string): string {
  return `Watch for "${typed.trim()}" anyway`;
}

/**
 * The closest thing we hold to what was typed, for "did you mean".
 *
 * A weaker claim is on offer either way - the list above says "closest
 * matches" - so this exists only for the stronger one, and the bar is set by
 * what it would take to be wrong in print, next to somebody's own spelling.
 *
 * Two guards, and the second is the one that was actually needed. Typing "a"
 * scores 0.95 against Achhad Border Checkpost, because a prefix hit is boosted
 * to the top of the list on purpose - the officer is three letters into a name
 * and wants to see it, which is right. Reading that boost back as "did you mean
 * Achhad Border Checkpost?" is not: one letter is not a misspelling of a
 * twenty-two character name, it is somebody who has not finished typing. So the
 * typed text has to be long enough to be an attempt at a whole name before this
 * asserts anything, and the shortest plaza name on this network is four
 * characters ("Bhat").
 */
export const DID_YOU_MEAN_SCORE = 0.3;
export const DID_YOU_MEAN_MIN_CHARS = 4;

export function didYouMean(lookup: PlazaLookup): string | null {
  const best = lookup.matches[0];
  if (!best || best.score === null) return null;
  if ((lookup.query?.length ?? 0) < DID_YOU_MEAN_MIN_CHARS) return null;
  return best.score >= DID_YOU_MEAN_SCORE ? best.name : null;
}

/* -------------------------------------------------------------------------- */
/* limits                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How many plazas either list offers.
 *
 * Six, and the list is scroll-bounded on top of that. This form was cut from
 * 927px to 805px on a 390px phone and has to stay there: eight rows at 41px is
 * most of the space the whole form is allowed.
 */
export const PLAZA_LIST_LIMIT = 6;
