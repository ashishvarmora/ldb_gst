/**
 * Proves that src/lib/plaza-match.ts agrees with Postgres.
 *
 * The alert evaluator decides whether a plaza alert fires, and it does that in
 * TypeScript using its own copies of public.plaza_core() and pg_trgm's
 * similarity(). Two implementations of the same rule drift, and when these two
 * drift the symptom is an alert that fires when it should not or - worse, being
 * silent - one that does not fire when it should.
 *
 * So they are not trusted, they are compared: every name in the live catalogue
 * through both cores, and every ordered pair of those names through both
 * similarity functions. Any disagreement is a failure with the offending values
 * printed.
 *
 * Run: node scripts/check-plaza-match.mjs
 * Needs SUPABASE_DB_URL in .env.local, like scripts/push-migrations.mjs.
 *
 * Exit code 0 = the port is faithful on real data. 1 = it is not, and the
 * evaluator must not be trusted until the difference is understood.
 */

import { readFileSync } from "node:fs";
import pg from "pg";

/*
 * Imported directly. Node strips the types itself from 22.18, so the very code
 * the worker runs is the code under test here - not a copy of it, and not the
 * output of a regex that tried to remove the annotations. If this import ever
 * fails, fix the import rather than reintroducing a second copy: a checker that
 * tests its own transcription of the module proves nothing about the module.
 */
const { plazaCore, trigramSimilarity } = await import(
  new URL("../src/lib/plaza-match.ts", import.meta.url).href
);

function loadEnv() {
  const out = {};
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    out[t.slice(0, t.indexOf("=")).trim()] = t.slice(t.indexOf("=") + 1).trim();
  }
  return out;
}

const env = loadEnv();
if (!env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL is not set in .env.local");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: plazas } = await client.query("select name from public.toll_plazas order by name");
const names = plazas.map((r) => r.name);
console.log(`Checking against ${names.length} live plaza names.`);

/* ---------------------------------------------------------------- cores ---- */
const { rows: coreRows } = await client.query(
  "select name, public.plaza_core(name) as core from public.toll_plazas order by name",
);
let coreBad = 0;
for (const { name, core } of coreRows) {
  const mine = plazaCore(name);
  if (mine !== core) {
    coreBad += 1;
    if (coreBad <= 10) console.error(`  core "${name}": pg="${core}" ts="${mine}"`);
  }
}
console.log(coreBad === 0 ? "plaza_core: identical on all names." : `plaza_core: ${coreBad} MISMATCH(ES).`);

/*
 * Names invented to exercise what the catalogue does not: furniture-only names
 * (which must fall back rather than become empty), unspaced furniture, single
 * characters, punctuation and digits.
 */
const SYNTHETIC = [
  "hathijan", "Hathijan Toll Plaza", "HATHIJAN  TP", "hathijaan",
  "Toll Plaza", "toll", "TP", "NH48", "nh 48", "km 12",
  "DodakaToll Plaza", "L&T Vadodra", "AMTL-TP-01", "Km.946.300",
  "a", "ab", "  spaced   out  ", "Bhat", "Bhatia", "Kheda", "Khedi",
  "Ahmedabad (Ring Road) Toll Pl", "Ahmedabad Ring Road 2", "", "123", "!!!",
];
const { rows: synthCores } = await client.query(
  "select v as name, public.plaza_core(v) as core from unnest($1::text[]) as v",
  [SYNTHETIC],
);
let synthBad = 0;
for (const { name, core } of synthCores) {
  const mine = plazaCore(name);
  if (mine !== core) {
    synthBad += 1;
    console.error(`  core (synthetic) "${name}": pg="${core}" ts="${mine}"`);
  }
}
console.log(
  synthBad === 0
    ? `plaza_core: identical on ${SYNTHETIC.length} synthetic names too.`
    : `plaza_core: ${synthBad} synthetic MISMATCH(ES).`,
);

/* ---------------------------------------------------------- similarity ---- */
/*
 * Every ordered pair, real and synthetic, scored in the database and in the
 * port.
 *
 * The tolerance is 1e-5, and it is that loose for a boring reason: similarity()
 * returns float4, and Postgres prints a float4 to six significant figures, so
 * 0.13333333... arrives over the wire as the string "0.133333". Parsing that
 * back can be out by 3e-7 no matter how exact the port is. A first attempt at
 * 1e-9 reported 1,270 "mismatches" that were all this - the largest was 3.3e-7,
 * and every one of them agreed to six figures.
 *
 * 1e-5 is still four orders of magnitude tighter than anything that could move
 * a decision: a genuine difference in how trigrams are built changes a score by
 * a whole trigram's worth, which on these short names is 0.05 at the very least.
 */
const universe = [...new Set([...names, ...SYNTHETIC])].filter((v) => v !== "");
const { rows: pairs } = await client.query(
  `select a.v as a, b.v as b,
          similarity(public.plaza_core(a.v), public.plaza_core(b.v)) as sim
   from unnest($1::text[]) as a(v) cross join unnest($1::text[]) as b(v)`,
  [universe],
);
let simBad = 0;
let worst = 0;
for (const { a, b, sim } of pairs) {
  const mine = trigramSimilarity(plazaCore(a), plazaCore(b));
  const delta = Math.abs(mine - Number(sim));
  if (delta > worst) worst = delta;
  if (delta > 1e-5) {
    simBad += 1;
    if (simBad <= 10) {
      console.error(`  sim "${a}" ~ "${b}": pg=${sim} ts=${mine} (delta ${delta})`);
    }
  }
}
console.log(
  simBad === 0
    ? `similarity: agrees on all ${pairs.length} pairs (worst delta ${worst.toExponential(2)}, float4 print precision).`
    : `similarity: ${simBad} of ${pairs.length} pairs MISMATCH.`,
);

/* ------------------------------------------- the threshold, re-measured ---- */
/*
 * The 0.6 default is justified by a gap in the live data, and the data can
 * change: a new plaza whose core scores above 0.6 against a DIFFERENT plaza
 * would make the default unsafe. Printed on every run so it is noticed when it
 * moves, and reported as a warning rather than a failure - it is a fact about
 * the catalogue, not a bug in the code.
 */
const { rows: close } = await client.query(
  `select a.name as a, b.name as b,
          round(similarity(public.plaza_core(a.name), public.plaza_core(b.name))::numeric, 3) as sim
   from public.toll_plazas a join public.toll_plazas b on a.name < b.name
   where public.plaza_core(a.name) <> public.plaza_core(b.name)
     and similarity(public.plaza_core(a.name), public.plaza_core(b.name)) >= 0.6
   order by sim desc`,
);
if (close.length === 0) {
  console.log("threshold 0.6: no two distinct plazas in the catalogue reach it.");
} else {
  console.log(`threshold 0.6: WARNING - ${close.length} pair(s) of distinct plazas reach it:`);
  for (const r of close) console.log(`  ${r.sim}  "${r.a}" vs "${r.b}"`);
  console.log("  Check whether these are two spellings of one plaza. If they are");
  console.log("  not, plaza_match_threshold should be raised above the highest.");
}

/* ------------------------------------------------------- core collisions -- */
const { rows: collide } = await client.query(
  `select public.plaza_core(name) as core, count(*) as n, string_agg(name, ' | ') as names
   from public.toll_plazas group by 1 having count(*) > 1 order by n desc`,
);
if (collide.length === 0) {
  console.log("core equality: unambiguous - no two catalogue names share a core.");
} else {
  console.log(`core equality: ${collide.length} core(s) shared by more than one name:`);
  for (const r of collide) console.log(`  ${r.n}x "${r.core}": ${r.names}`);
  console.log("  Rule 2 treats these as the same plaza. Confirm that is right.");
}

/* --------------------------------------------------- the decisions made ---- */
/*
 * The rules, as behaviour rather than as scores. Each case is a real pair of
 * names from the live catalogue or the owner's own example, and each says
 * whether an alert should fire. These are what actually matter: the numbers
 * above only support them.
 *
 * The four "quiet" cases in the middle are pairs of GENUINELY DIFFERENT plazas
 * that a lower threshold would confuse. They are the reason 0.6 is not 0.5.
 */
const CASES = [
  // watched, seen, mode, should fire, why
  ["hathijan", "Hathijan Toll Plaza", "fuzzy", true, "the owner's example: typed short name, recorded with furniture"],
  ["hathijan", "Hathijan Toll Plaza", "exact", true, "the core rule serves both modes"],
  ["hathijaan", "Hathijan Toll Plaza", "fuzzy", true, "a genuine typo, 0.727"],
  ["hathijaan", "Hathijan Toll Plaza", "exact", false, "the same typo on a catalogue pick: similarity is not offered"],
  ["Ahmedabad Ring Road 2", "Ahmedabad (Ring Road) Toll Pl", "fuzzy", true, "one plaza the catalogue holds twice, 0.857"],

  ["hathijan", "Hathi Kheda Toll Plaza", "fuzzy", false, "different plaza, 0.313"],
  ["bhat", "Bhatia  Toll Plaza", "fuzzy", false, "Bhat and Bhatia are both real, 0.500"],
  ["bhagwada", "Bhatwada Toll Plaza", "fuzzy", false, "both real, 0.500"],
  ["kheda", "Khedi", "fuzzy", false, "both real, 0.500"],
  ["ahmedabad", "Ahmedabad Ring Road 2", "fuzzy", false, "different plazas, 0.556 - the highest such pair"],

  /*
   * KNOWN AND ACCEPTED. "DodakaToll Plaza" has the furniture glued to the name
   * with no space, so plaza_core's word boundaries cannot strip it and the core
   * is "dodakatoll", which scores 0.500 against "dodaka" - the same score as
   * Bhat against Bhatia. It cannot be made to fire without also confusing those
   * two, so it does not fire.
   *
   * It costs nothing in practice: the name IS in the catalogue, and
   * match_plazas('dodaka') suggests it, so an officer picks it from the search
   * and gets an exact alert. Only 1 of the 87 live names is shaped this way.
   */
  ["dodaka", "DodakaToll Plaza", "fuzzy", false, "glued furniture, 0.500 - documented limitation"],

  ["", "Hathijan Toll Plaza", "fuzzy", false, "nothing watched"],
  ["hathijan", "", "fuzzy", false, "nothing recorded yet"],
  ["Toll Plaza", "Fee Plaza", "fuzzy", false, "two furniture-only names must not collapse to one empty core"],
];

const { matchPlaza } = await import(new URL("../src/lib/plaza-match.ts", import.meta.url).href);
const { rows: thresholdRow } = await client.query(
  "select (value #>> '{}')::real as t from public.app_settings where key = 'plaza_match_threshold'",
);
const threshold = thresholdRow[0]?.t ?? 0.6;
console.log(`\nBehaviour, at the live threshold of ${threshold}:`);

let caseBad = 0;
for (const [watched, seen, mode, want, why] of CASES) {
  const got = matchPlaza({ watched, seen, mode, threshold });
  const ok = got.matched === want;
  if (!ok) caseBad += 1;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${want ? "fire " : "quiet"} "${watched}" ~ "${seen}" [${mode}]` +
      ` -> ${got.basis} ${got.score.toFixed(3)}   ${why}`,
  );
}

await client.end();

const failed = coreBad + synthBad + simBad + caseBad;
console.log(failed === 0 ? "\nOK - the port matches Postgres." : `\nFAILED - ${failed} mismatch(es).`);
process.exit(failed === 0 ? 0 : 1);
