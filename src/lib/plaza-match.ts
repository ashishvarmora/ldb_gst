/**
 * Deciding whether a recorded crossing is the plaza an officer asked about.
 *
 * THE PROBLEM THIS EXISTS TO FIX.
 *
 * An officer wants an alert when their lorry reaches Hathijan. If Hathijan is
 * in the catalogue they pick it from the list and the stored name is the
 * catalogue's own spelling, so a later crossing matches it character for
 * character. But the catalogue is learned from crossings - see
 * learn_plazas_from_events() in 0051 - so a plaza no tracked lorry has ever
 * passed is simply absent, and Hathijan is one of those today.
 *
 * The form lets them type it anyway, with a confirmation tick. What happened
 * next was the bug: the evaluator compared the two names for equality after
 * folding case and runs of spaces, and nothing else. The officer types
 * "hathijan"; the portal records the crossing as "Hathijan Toll Plaza"; those
 * are not equal, so the alert never fired. Not late, not twice - never. And
 * 77% of the 87 names in the live catalogue carry that same furniture, so this
 * was the normal case rather than an edge one. The screen promised to watch a
 * plaza and then could not.
 *
 * ---------------------------------------------------------------------------
 * WHAT MATCHES, AND WHY EACH RULE IS SAFE
 *
 * Three rules, tried in order, first hit wins:
 *
 *   1 · exact   - the folded names are equal. The old rule, kept.
 *   2 · core    - the names are equal once road furniture is removed:
 *                 "hathijan" against "Hathijan Toll Plaza". Measured across all
 *                 87 catalogue names, NO TWO DISTINCT NAMES SHARE A CORE, so
 *                 this cannot conflate two plazas. It is what rescues the case
 *                 above, and it needs no threshold and no guesswork.
 *   3 · similar - trigram similarity of the cores, at or above a threshold.
 *                 Only for an alert whose plaza was typed rather than chosen,
 *                 because that is the one where the officer's spelling and the
 *                 portal's are known to differ and rule 2 may still miss.
 *
 * WHY RULE 3 IS RESTRICTED, AND WHY ITS THRESHOLD IS 0.6 BY DEFAULT.
 *
 * 0051 argued there must be no similarity anywhere near the evaluator, on the
 * grounds that it would message about Bhatia when the officer asked about Bhat.
 * That was right about the danger and wrong about the conclusion, because it
 * left the typed path unable to fire at all. The danger is real and measurable,
 * so it was measured, over every pair of distinct plazas in the live catalogue:
 *
 *   0.556  "ahmedabad"  vs "ahmedabad ring road"     - different plazas
 *   0.500  "bhat"       vs "bhatia"                  - different plazas
 *   0.500  "bhagwada"   vs "bhatwada"                - different plazas
 *   0.500  "kheda"      vs "khedi"                   - different plazas
 *   0.857  "ahmedabad ring road" vs "ahmedabad ring road pl"
 *                                                    - the SAME plaza, twice
 *
 * So the highest score between two genuinely different plazas is 0.556, and
 * the one pair that is two spellings of a single plaza scores 0.857. 0.6 is
 * the gap between those two facts. Below 0.56 this would fire on Bhatia when
 * asked about Bhat; at 0.6 it still recognises a plaza the catalogue holds
 * under two names. The number is a setting - plaza_match_threshold - so it can
 * be moved, and anyone moving it below 0.56 should know they are buying that
 * confusion, at a credit a check.
 *
 * Word containment was considered as a fourth rule and rejected by the same
 * data: "Ahmedabad Toll Plaza" and "Ahmedabad Ring Road 2" are two different
 * plazas, and "ahmedabad" is a whole-word prefix of "ahmedabad ring road".
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCORING IS PORTED HERE INSTEAD OF CALLED IN SQL
 *
 * plaza_core() and similarity() are Postgres functions, and the evaluator is a
 * synchronous pure function that the worker calls in a loop over every alert on
 * every truck. Reaching the database from inside it would mean a round trip per
 * alert per sweep, and would make a function that is currently trivial to reason
 * about into one that can fail.
 *
 * So both are reimplemented below, and then CHECKED AGAINST POSTGRES over the
 * real catalogue rather than trusted - see scripts/check-plaza-match.mjs, which
 * compares every pair of the 87 live names and fails on any disagreement. A
 * port that is verified against the thing it copies is safe; one that is merely
 * careful is not, and this file would otherwise be a second opinion about
 * whether an alert fires.
 */

/** Values of truck_alerts.plaza_match. */
export type PlazaMatchMode = "exact" | "fuzzy";

/** Which rule fired, for the log line and for explaining a match to a human. */
export type PlazaMatchBasis = "exact" | "core" | "similar" | "none";

export type PlazaMatchResult = {
  matched: boolean;
  basis: PlazaMatchBasis;
  /** Trigram similarity of the two cores. Reported whatever the basis, so a
      near miss can be read out of a log without recomputing it. */
  score: number;
};

/**
 * The default threshold for rule 3. See the header for how 0.6 was arrived at;
 * the admin setting `plaza_match_threshold` overrides it.
 */
export const DEFAULT_PLAZA_MATCH_THRESHOLD = 0.6;

/**
 * Case and whitespace folded, nothing else. The same rule as
 * normaliseLocation() in src/lib/alerts.ts and as the SQL expression in the
 * 0048 unique index - a fourth copy, and deliberately not an import, because
 * this module must not depend on the alert evaluator that depends on it.
 */
function fold(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/*
 * The furniture, longest alternative first.
 *
 * Postgres ARE resolves an ambiguous alternation leftmost-longest; JavaScript
 * takes the first alternative that lets the rest of the pattern match. On this
 * list the two agree anyway, because every alternative is followed by \b and
 * the engine backtracks - but ordering by length removes the need to know that,
 * and removes the chance that adding a word later quietly changes which one
 * wins.
 *
 * Kept in step with 0051's plaza_core() by hand; the checker compares the two
 * over the whole catalogue, so a divergence is a failed check rather than a
 * wrong alert.
 */
const FURNITURE =
  /\b(?:checkpost|plazas|chowki|border|tolls|plaza|check|tols|toll|plza|post|tol|plz|fee|the|km|at|no|nh[0-9]*|tp[0-9]*|[0-9]+)\b/g;

/**
 * A plaza name with the road furniture stripped: "Mehsana Toll Plaza" becomes
 * "mehsana". A faithful port of public.plaza_core().
 *
 * The fallback matters: when a name is nothing but furniture, the core would be
 * the empty string, which would compare equal to every other empty core and
 * make the row match everything. In that case the folded name is used instead,
 * exactly as the SQL does with its coalesce.
 */
export function plazaCore(name: string | null | undefined): string {
  const lowered = (name ?? "").toLowerCase();
  // Punctuation to spaces first, so "L&T", "AMTL-TP-01" and "Km.946.300" break
  // into words the pass below can recognise.
  const words = lowered.replace(/[^a-z0-9]+/g, " ");
  const stripped = words.replace(FURNITURE, " ").replace(/\s+/g, " ").trim();
  return stripped === "" ? fold(name) : stripped;
}

/**
 * The trigram set pg_trgm would build.
 *
 * Non-alphanumeric characters separate words, and each WORD is padded on its
 * own - two spaces before, one after - so "ab cd" yields six trigrams and no
 * trigram ever spans the gap between two words. De-duplicated, because
 * similarity is measured on sets.
 */
function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  for (const word of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word === "") continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/**
 * pg_trgm's similarity(): the size of the intersection over the size of the
 * union. 1 when the trigram sets are identical, 0 when they are disjoint.
 */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;

  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Does this crossing satisfy this alert?
 *
 * `watched` is what the officer asked for, `seen` is what the portal recorded.
 * `mode` is how the alert was created: "exact" when the plaza was chosen from
 * the catalogue, "fuzzy" when it was typed and confirmed as unlisted. Rules 1
 * and 2 apply to both; rule 3 only to "fuzzy".
 */
export function matchPlaza({
  watched,
  seen,
  mode,
  threshold = DEFAULT_PLAZA_MATCH_THRESHOLD,
}: {
  watched: string | null | undefined;
  seen: string | null | undefined;
  mode: PlazaMatchMode;
  threshold?: number;
}): PlazaMatchResult {
  const wantFolded = fold(watched);
  const sawFolded = fold(seen);

  // Nothing to compare. Not a match, and not an error either: a truck with no
  // recorded position yet reaches this on every sweep.
  if (wantFolded === "" || sawFolded === "") {
    return { matched: false, basis: "none", score: 0 };
  }

  const wantCore = plazaCore(watched);
  const sawCore = plazaCore(seen);
  const score = trigramSimilarity(wantCore, sawCore);

  if (wantFolded === sawFolded) return { matched: true, basis: "exact", score };
  if (wantCore === sawCore) return { matched: true, basis: "core", score };

  /*
   * Rule 3, and only for a typed plaza. An alert made by picking from the
   * catalogue already holds a real plaza name, so rules 1 and 2 will recognise
   * that plaza when it is crossed; letting similarity near it would add the
   * risk of confusing two plazas and rescue nothing.
   */
  if (mode === "fuzzy" && score >= threshold) {
    return { matched: true, basis: "similar", score };
  }

  return { matched: false, basis: "none", score };
}
