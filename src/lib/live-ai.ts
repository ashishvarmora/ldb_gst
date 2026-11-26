import "server-only";
import { unstable_cache } from "next/cache";

import { aiAvailable, aiJson, redact } from "@/lib/ai";

/**
 * AI helpers for Rahdari Live (a logistics owner, e.g. a Morbi tiles factory
 * dispatching trucks). Every AI function returns null when no key is set or
 * the model's output does not pass validation; each has a pure rule-based
 * twin (…Basic) so the module works with no key at all.
 *
 * Privacy: all free text goes through redact() before reaching a model.
 * Hallucination guard: identifiers the model returns must actually occur in
 * the pasted text, and summaries may only quote numbers that are in the facts.
 */

/* ======================================================================
 * 1. Dispatch extraction
 * ==================================================================== */

export type DispatchExtract = {
  /** 12 digits, no spaces. */
  ewayBillNo?: string;
  /** ISO 8601 with +05:30 offset. */
  ewayValidUntil?: string;
  invoiceNo?: string;
  invoiceValueInr?: number;
  lrNo?: string;
  /** Uppercase, no spaces/dashes, e.g. GJ36AB1234 or 22BH1234AA. */
  vehicleNo?: string;
  fromPlace?: string;
  toPlace?: string;
  consigneeName?: string;
  material?: string;
  /** Free text with unit, e.g. "1200 boxes". */
  quantity?: string;
  weightKg?: number;
  transporter?: string;
};

export type DispatchExtractResult = {
  data: DispatchExtract;
  source: "ai" | "rules";
};

const STATE_CODES = new Set(
  "AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP WB".split(
    " ",
  ),
);

/** GJ 36 AB 1234 / gj-36-ab-1234 / 22 BH 1234 AA -> canonical, or null. */
export function normalizeVehicleNo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const std = s.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  if (std && STATE_CODES.has(std[1])) {
    return `${std[1]}${std[2].padStart(2, "0")}${std[3]}${std[4]}`;
  }
  if (/^\d{2}BH\d{4}[A-Z]{1,2}$/.test(s)) return s; // Bharat series
  return null;
}

export function normalizeEwayBillNo(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).replace(/[\s-]/g, "");
  return /^\d{12}$/.test(s) ? s : null;
}

/** "25/11/2026 11:59 PM", "25-11-2026", "2026-11-25T23:59" -> ISO (+05:30). */
export function parseIndianDateTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  let y: number, mo: number, d: number;
  let h = 23,
    mi = 59; // a validity date with no time means end of that day
  const dmy = t.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
  const ymd = t.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?/i);
  if (ymd) {
    y = +ymd[1];
    mo = +ymd[2];
    d = +ymd[3];
    if (ymd[4]) {
      h = +ymd[4];
      mi = +ymd[5];
    }
    if (ymd[6]) {
      const dt = new Date(t);
      return Number.isNaN(dt.getTime()) ? null : toIstIso(dt);
    }
  } else if (dmy) {
    d = +dmy[1];
    mo = +dmy[2];
    y = +dmy[3];
    if (dmy[4]) {
      h = +dmy[4];
      mi = +dmy[5];
      const ap = dmy[6]?.toUpperCase();
      if (ap === "PM" && h < 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
    }
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || y < 2017 || y > 2100) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+05:30`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function toIstIso(dt: Date): string {
  const ist = new Date(dt.getTime() + 330 * 60_000);
  return ist.toISOString().replace(/\.\d{3}Z$/, "+05:30");
}

function parseInr(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 && raw < 1e11 ? Math.round(raw * 100) / 100 : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/lakh|lac/i.test(raw)) n *= 1e5;
  else if (/crore|cr\b/i.test(raw)) n *= 1e7;
  return n > 0 && n < 1e11 ? Math.round(n * 100) / 100 : null;
}

function parseWeightKg(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 && raw < 200_000 ? raw : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|tons?|tonnes?|mt|t|quintals?|qtl)?\b/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const u = (m[2] ?? "kg").toLowerCase();
  if (/^(tons?|tonnes?|mt|t)$/.test(u)) n *= 1000;
  else if (/^(quintals?|qtl)$/.test(u)) n *= 100;
  return n > 0 && n < 200_000 ? Math.round(n * 10) / 10 : null;
}

function cleanStr(raw: unknown, max = 80): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim().replace(/^[:\-–\s]+|[,;\s]+$/g, "");
  if (!s || s.length > max || /^(n\/?a|null|none|unknown|-)$/i.test(s)) return null;
  if (/\[(phone|email)\]/.test(s)) return null;
  return s;
}

function cleanDocNo(raw: unknown): string | null {
  const s = cleanStr(typeof raw === "number" ? String(raw) : raw, 30);
  if (!s) return null;
  const t = s.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9/\-_.]{0,29}$/.test(t) && /\d/.test(t) ? t : null;
}

/** Text with spaces, dashes and case removed, for "does this id occur" checks. */
function squash(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ---------- rule-based extractor (no AI, pure) ---------- */

/**
 * All values that follow a label, in order. `strictSep` requires a ":" or "-"
 * after the label (used for words like "to"/"from" that also occur in prose).
 */
function labelledAll(text: string, labels: string, value = String.raw`([^\n]+)`, strictSep = false): string[] {
  const sep = strictSep ? String.raw`\s*[:\-]\s*` : String.raw`\s*[:\-.#]?\s*`;
  const re = new RegExp(
    String.raw`(?<![A-Za-z])(?:${labels})(?![A-Za-z])\s*(?:no\b\.?|number|#)?(?!\s*date)` + sep + value,
    "gi",
  );
  return [...text.matchAll(re)].map((m) => m[1].trim());
}

function firstValid<T>(values: string[], check: (v: string) => T | null): T | null {
  for (const v of values) {
    const r = check(v);
    if (r != null) return r;
  }
  return null;
}

const noGstin = (max: number) => (v: string) => {
  const s = cleanStr(v, max);
  return s && !/gstin/i.test(s) && !/^(?:₹|rs\.?|inr)?[\d,.\s]+$/i.test(s) ? s : null;
};

const DOC_VALUE = String.raw`([A-Za-z0-9/\-_.]{1,30})`;

/** Regex extraction of the fields that have a reliable shape or label. Pure. */
export function extractDispatchFromTextBasic(text: string): DispatchExtract {
  const out: DispatchExtract = {};
  if (!text) return out;
  const t = text.replace(/\r/g, "");

  // E-way bill: prefer a labelled one, else a standalone 12-digit number
  // (also printed as 1234 5678 9012) that does not look like 91+mobile.
  const ewbLabelled = t.match(/(?:e[\s-]?way\s*bill|ewb|eway)[^\d\n]{0,25}(\d{4}[\s-]?\d{4}[\s-]?\d{4})(?!\d)/i);
  let ewb = normalizeEwayBillNo(ewbLabelled?.[1]);
  if (!ewb) {
    for (const m of t.matchAll(/(?<![\d])(\d{4}[ -]?\d{4}[ -]?\d{4})(?![\d])/g)) {
      const n = normalizeEwayBillNo(m[1]);
      if (n && !/^91[6-9]/.test(n)) {
        ewb = n;
        break;
      }
    }
  }
  if (ewb) out.ewayBillNo = ewb;

  const validIso = firstValid(
    labelledAll(t, String.raw`valid\s*(?:upto|up\s*to|until|till)|validity`, String.raw`([^\n]{6,30})`),
    parseIndianDateTime,
  );
  if (validIso) out.ewayValidUntil = validIso;

  // Vehicle: first plate-shaped token with a real state code.
  const plateRe =
    /(?<![A-Z0-9])([A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{4}|\d{2}[\s-]?BH[\s-]?\d{4}[\s-]?[A-Z]{1,2})(?![A-Z0-9])/gi;
  for (const m of t.matchAll(plateRe)) {
    const v = normalizeVehicleNo(m[1]);
    if (v) {
      out.vehicleNo = v;
      break;
    }
  }

  const inv = firstValid(
    labelledAll(t, String.raw`tax\s*invoice|invoice|inv|bill\s*of\s*supply|document|doc|challan`, DOC_VALUE),
    (v) => (v === ewb ? null : cleanDocNo(v)),
  );
  if (inv) out.invoiceNo = inv;

  const lr = firstValid(
    labelledAll(t, String.raw`l\.?\s*r\.?|g\.?\s*r\.?|bilty|consignment\s*note|c\.?\s*n\.?|docket`, DOC_VALUE),
    cleanDocNo,
  );
  if (lr) out.lrNo = lr;

  const valN = firstValid(
    labelledAll(
      t,
      String.raw`(?:total\s*)?invoice\s*(?:value|amount)|value\s*of\s*goods|total\s*(?:inv\.?\s*)?value|grand\s*total|total\s*amount`,
      String.raw`((?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d+)?(?:\s*(?:lakh|lac|crore))?)`,
    ),
    parseInr,
  );
  if (valN) out.invoiceValueInr = valN;

  const wtN = firstValid(
    labelledAll(
      t,
      String.raw`(?:gross\s*|net\s*|total\s*)?weight|wt\.?`,
      String.raw`([\d,.]+\s*(?:kgs?|tons?|tonnes?|mt|qtl)?)`,
    ),
    parseWeightKg,
  );
  if (wtN) out.weightKg = wtN;

  const from = firstValid(
    labelledAll(t, String.raw`dispatch\s*from|place\s*of\s*dispatch|from\s*place|from|origin`, undefined, true),
    noGstin(60),
  );
  if (from) out.fromPlace = from;
  const to = firstValid(
    labelledAll(t, String.raw`place\s*of\s*delivery|ship\s*to\s*place|to\s*place|destination|delivery\s*at|to`, undefined, true),
    noGstin(60),
  );
  if (to) out.toPlace = to;

  const cons = firstValid(
    labelledAll(t, String.raw`consignee(?:\s*name)?|buyer|party(?:\s*name)?`, undefined, true),
    noGstin(80),
  );
  if (cons) out.consigneeName = cons;

  const mat = firstValid(
    labelledAll(t, String.raw`description\s*of\s*goods|material|goods|product(?:\s*name)?|item`, undefined, true),
    noGstin(80),
  );
  if (mat) out.material = mat;

  const qty = firstValid(labelledAll(t, "qty|quantity", String.raw`([\d,.]+\s*[A-Za-z]{0,12})`), (v) => cleanStr(v, 40));
  if (qty) out.quantity = qty;

  const tr = firstValid(
    labelledAll(t, String.raw`transporter(?:\s*name)?|transport(?:\s*name)?`, undefined, true),
    (v) => {
      const s = noGstin(80)(v);
      return s && !/^(id|doc)\b/i.test(s) ? s : null;
    },
  );
  if (tr) out.transporter = tr;

  return out;
}

/* ---------- AI extractor ---------- */

const EXTRACT_SYSTEM = `You extract shipping details for an Indian goods dispatch from pasted text (GST e-way bill, tax invoice, lorry receipt / bilty, or a WhatsApp message).
Return one JSON object with only these optional keys:
ewayBillNo (12 digits), ewayValidUntil (date-time as printed), invoiceNo, invoiceValueInr (number, rupees), lrNo, vehicleNo, fromPlace, toPlace, consigneeName, material, quantity (number with unit, e.g. "1200 boxes"), weightKg (number), transporter.
Rules: copy values exactly as they appear; never guess or invent; omit any key that is not clearly in the text. Places are town/city names, not full addresses. "[phone]" and "[email]" are masked values: never output them.`;

function validateExtract(x: unknown, rawSquashed: string): DispatchExtract | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const out: DispatchExtract = {};
  const occurs = (v: string) => rawSquashed.includes(squash(v));

  const ewb = normalizeEwayBillNo(o.ewayBillNo);
  if (ewb && occurs(ewb)) out.ewayBillNo = ewb;
  const vu = parseIndianDateTime(o.ewayValidUntil);
  if (vu) out.ewayValidUntil = vu;
  const inv = cleanDocNo(o.invoiceNo);
  if (inv && occurs(inv)) out.invoiceNo = inv;
  const lr = cleanDocNo(o.lrNo);
  if (lr && occurs(lr)) out.lrNo = lr;
  const veh = normalizeVehicleNo(o.vehicleNo);
  if (veh && (occurs(veh) || occurs(veh.replace(/^([A-Z]{2})0/, "$1")))) out.vehicleNo = veh;
  const val = parseInr(o.invoiceValueInr);
  if (val) out.invoiceValueInr = val;
  const wt = parseWeightKg(o.weightKg);
  if (wt) out.weightKg = wt;
  for (const k of ["fromPlace", "toPlace", "consigneeName", "material", "quantity", "transporter"] as const) {
    const s = cleanStr(o[k], k === "quantity" ? 40 : 80);
    if (s) out[k] = s;
  }
  return out;
}

/**
 * AI extraction from pasted dispatch text. Null when AI is off or nothing
 * valid came back. Strict-format fields found by the regex extractor on the
 * raw (unredacted) text win over the model's; the model fills the rest.
 */
export async function extractDispatchFromText(text: string): Promise<DispatchExtract | null> {
  if (!aiAvailable() || !text?.trim()) return null;
  const clipped = text.slice(0, 12_000);
  const rawSquashed = squash(clipped);
  const ai = await aiJson<DispatchExtract>(`Text:\n"""\n${redact(clipped)}\n"""`, {
    system: EXTRACT_SYSTEM,
    maxTokens: 600,
    validate: (x) => validateExtract(x, rawSquashed),
  });
  if (!ai) return null;
  const basic = extractDispatchFromTextBasic(clipped);
  const merged: DispatchExtract = { ...ai };
  for (const k of ["ewayBillNo", "vehicleNo", "ewayValidUntil"] as const) {
    if (basic[k]) merged[k] = basic[k];
  }
  for (const [k, v] of Object.entries(basic) as [keyof DispatchExtract, never][]) {
    if (merged[k] === undefined) merged[k] = v;
  }
  return Object.keys(merged).length ? merged : null;
}

/** Convenience: AI when available and useful, otherwise the regex result. */
export async function extractDispatch(text: string): Promise<DispatchExtractResult> {
  const ai = await extractDispatchFromText(text);
  if (ai) return { data: ai, source: "ai" };
  return { data: extractDispatchFromTextBasic(text), source: "rules" };
}

/* ======================================================================
 * Shared: number guard + IST formatting
 * ==================================================================== */

const IST_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "25 Nov, 9:45 pm" in IST, or undefined. */
export function istLabel(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : IST_FMT.format(d);
}

export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Every number in the output must also be in the facts given to the model. */
function numbersAllowed(output: string, factsJson: string): boolean {
  const allowed = new Set((factsJson.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(parseFloat(n))));
  allowed.add("0");
  allowed.add("1");
  for (const n of output.replace(/(\d),(?=\d{2,3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!allowed.has(String(parseFloat(n)))) return false;
  }
  return true;
}

/* ======================================================================
 * 2. Operations summary
 * ==================================================================== */

export type OperationsFacts = {
  /** When these facts were computed (ISO). */
  asOf: string;
  /** "daily" = end/start of day digest, "live" = right now. */
  scope: "daily" | "live";
  counts: {
    inTransit: number;
    delayed: number;
    arrivedToday: number;
    deliveredToday: number;
    stoppedNow: number;
    ewayExpiringSoon: number;
    ewayExpired?: number;
    dispatchedToday?: number;
  };
  /** Worst first; only the first 5 are used. */
  delayedTrips?: { vehicleNo: string; toPlace?: string; delayMinutes?: number; reason?: string }[];
  stoppages?: { vehicleNo: string; place?: string; minutes: number }[];
  ewayExpiring?: { vehicleNo?: string; ewayBillNo?: string; validUntil?: string }[];
  deliveries?: { vehicleNo: string; toPlace?: string; onTime?: boolean }[];
  /** Extra one-line facts the caller wants mentioned, already phrased. */
  notes?: string[];
};

/** What the model sees: same facts, times pre-formatted, lists capped. */
function factsForModel(f: OperationsFacts) {
  return {
    scope: f.scope,
    asOfIst: istLabel(f.asOf),
    counts: f.counts,
    delayedTrips: (f.delayedTrips ?? []).slice(0, 5).map((d) => ({
      vehicleNo: d.vehicleNo,
      toPlace: d.toPlace,
      delay: d.delayMinutes != null ? durationLabel(d.delayMinutes) : undefined,
      reason: d.reason ? redact(d.reason) : undefined,
    })),
    stoppages: (f.stoppages ?? []).slice(0, 5).map((s) => ({
      vehicleNo: s.vehicleNo,
      place: s.place,
      stoppedFor: durationLabel(s.minutes),
    })),
    ewayExpiring: (f.ewayExpiring ?? []).slice(0, 5).map((e) => ({
      vehicleNo: e.vehicleNo,
      ewayBillNo: e.ewayBillNo,
      validUntilIst: istLabel(e.validUntil),
    })),
    deliveries: (f.deliveries ?? []).slice(0, 5),
    notes: (f.notes ?? []).slice(0, 5).map(redact),
  };
}

const SUMMARY_SYSTEM = `You write a short status update for the owner of an Indian factory who dispatches goods by truck.
Use plain, simple English; a few common Hindi words in Latin script are fine (e.g. "gaadi", "maal", "aaj").
Use ONLY the facts given. Never invent or compute new numbers, places, vehicles or reasons. If a list is empty, do not mention it.
Most urgent first: delays, e-way bills expiring, long stoppages; then good news (deliveries).
Return JSON: {"bullets": ["...", "..."]} with 2 to 6 bullets, each under 120 characters, no emojis, no leading symbols.`;

/** AI summary: up to 6 lines, each starting with "• ". Null if unavailable/invalid. */
export async function summarizeOperations(facts: OperationsFacts): Promise<string | null> {
  if (!aiAvailable()) return null;
  const mf = factsForModel(facts);
  const factsJson = JSON.stringify(mf);
  const res = await aiJson<string[]>(`Facts:\n${factsJson}`, {
    system: SUMMARY_SYSTEM,
    maxTokens: 500,
    validate: (x) => {
      const b = (x as { bullets?: unknown })?.bullets;
      if (!Array.isArray(b)) return null;
      const lines = b
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.replace(/^[\s•\-*\d.)]+/, "").trim())
        .filter((s) => s.length > 0 && s.length <= 160)
        .slice(0, 6);
      if (!lines.length) return null;
      if (!numbersAllowed(lines.join(" "), factsJson)) return null;
      return lines;
    },
  });
  return res ? res.map((l) => `• ${l}`).join("\n") : null;
}

/** Rule-based summary with the same shape as summarizeOperations(). */
export function summarizeOperationsBasic(f: OperationsFacts): string {
  const c = f.counts;
  const lines: string[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  if (c.delayed > 0) {
    const worst = f.delayedTrips?.[0];
    const extra = worst
      ? ` - worst: ${worst.vehicleNo}${worst.toPlace ? ` to ${worst.toPlace}` : ""}${worst.delayMinutes != null ? `, ${durationLabel(worst.delayMinutes)} late` : ""}`
      : "";
    lines.push(`${plural(c.delayed, "trip")} delayed${extra}.`);
  }
  if (c.ewayExpired) lines.push(`${plural(c.ewayExpired, "e-way bill")} already expired - extend now.`);
  if (c.ewayExpiringSoon > 0) {
    const e = f.ewayExpiring?.[0];
    const when = e ? istLabel(e.validUntil) : undefined;
    lines.push(
      `${plural(c.ewayExpiringSoon, "e-way bill")} expiring soon${e?.vehicleNo ? ` (${e.vehicleNo}${when ? `, ${when}` : ""})` : ""}.`,
    );
  }
  if (c.stoppedNow > 0) {
    const s = [...(f.stoppages ?? [])].sort((a, b) => b.minutes - a.minutes)[0];
    lines.push(
      `${plural(c.stoppedNow, "truck")} stopped right now${s ? ` - longest ${s.vehicleNo}${s.place ? ` at ${s.place}` : ""}, ${durationLabel(s.minutes)}` : ""}.`,
    );
  }
  lines.push(`${plural(c.inTransit, "truck")} on the road${c.dispatchedToday ? `, ${c.dispatchedToday} dispatched today` : ""}.`);
  if (c.deliveredToday > 0 || c.arrivedToday > 0) {
    const parts: string[] = [];
    if (c.arrivedToday > 0) parts.push(`${c.arrivedToday} arrived`);
    if (c.deliveredToday > 0) parts.push(`${c.deliveredToday} delivered`);
    lines.push(`Today: ${parts.join(", ")}.`);
  }
  for (const n of f.notes ?? []) if (lines.length < 6) lines.push(n);
  if (c.delayed === 0 && c.ewayExpiringSoon === 0 && !c.ewayExpired && c.stoppedNow === 0 && lines.length < 6) {
    lines.push("All good - no delays or e-way bill issues.");
  }
  return lines
    .slice(0, 6)
    .map((l) => `• ${l}`)
    .join("\n");
}

/* ======================================================================
 * 3. Delay explanation
 * ==================================================================== */

export type TripDelayFacts = {
  vehicleNo: string;
  fromPlace?: string;
  toPlace?: string;
  /** Now (ISO); defaults to the current time. */
  now?: string;
  promisedAt?: string;
  etaAt?: string;
  distanceLeftKm?: number;
  /** Recent speeds, oldest first (km/h), e.g. one per 15 min. */
  recentSpeedsKmph?: number[];
  avgSpeedKmph?: number;
  /** Minutes stopped at the current spot, if stopped now. */
  stoppedMinutes?: number;
  stoppedAt?: string;
  /** v5: when the current standing began (ISO). */
  stoppedSince?: string;
  /** Minutes since the last position fix. */
  lastSeenMinutesAgo?: number;
  /** Known context, e.g. "e-way bill expires in 3 h", "toll plaza queue". */
  notes?: string[];
};

function delayFactsForModel(f: TripDelayFacts) {
  const now = f.now ? new Date(f.now) : new Date();
  const late =
    f.promisedAt && f.etaAt ? Math.round((new Date(f.etaAt).getTime() - new Date(f.promisedAt).getTime()) / 60_000) : null;
  const hourIst = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(now),
  );
  const speeds = (f.recentSpeedsKmph ?? []).slice(-8).map((s) => Math.round(s));
  return {
    vehicleNo: f.vehicleNo,
    fromPlace: f.fromPlace,
    toPlace: f.toPlace,
    nowIst: istLabel(now.toISOString()),
    nightTime: hourIst >= 22 || hourIst < 6,
    promisedIst: istLabel(f.promisedAt),
    etaIst: istLabel(f.etaAt),
    lateBy: late != null && late > 0 ? durationLabel(late) : undefined,
    aheadBy: late != null && late < 0 ? durationLabel(-late) : undefined,
    distanceLeftKm: f.distanceLeftKm != null ? Math.round(f.distanceLeftKm) : undefined,
    recentSpeedsKmph: speeds.length ? speeds : undefined,
    avgSpeedKmph: f.avgSpeedKmph != null ? Math.round(f.avgSpeedKmph) : undefined,
    stoppedFor: f.stoppedMinutes ? durationLabel(f.stoppedMinutes) : undefined,
    stoppedAt: f.stoppedAt,
    standingSinceIst: f.stoppedSince ? istLabel(f.stoppedSince) : undefined,
    lastSignal: f.lastSeenMinutesAgo != null ? `${durationLabel(f.lastSeenMinutesAgo)} ago` : undefined,
    notes: (f.notes ?? []).slice(0, 5).map(redact),
  };
}

const DELAY_SYSTEM = `You help an Indian factory owner understand why a truck is late.
Given trip facts, write one or two short sentences: the most likely reason (only from the facts: long stoppage, slow speed, night halt, no GPS signal, distance left) and one practical next step (e.g. call the driver, inform the customer of the new ETA, extend the e-way bill).
Use ONLY the given facts and numbers; never invent places, causes like accidents, or new numbers. Plain simple English; common Hindi words in Latin script are fine.
If stoppedFor is given or recent speeds are near 0, the truck is STANDING: say "standing/stopped for <stoppedFor> (since <standingSinceIst>)". Never write "moving slowly" or "0 km/h" for a standing truck.
Return JSON: {"text": "..."}`;
/** v5: a standing truck described as "moving slowly at 0 km/h" is refused (rule text is used instead). */
const DELAY_BAD = /\b0\s*km\s*\/?\s*h|moving slowly[^.]*\b[0-2]\s*km/i;

/** AI explanation, max 2 sentences. Null if unavailable/invalid. */
export async function explainDelay(f: TripDelayFacts): Promise<string | null> {
  if (!aiAvailable()) return null;
  const mf = delayFactsForModel(f);
  const factsJson = JSON.stringify(mf);
  return aiJson<string>(`Trip facts:\n${factsJson}`, {
    system: DELAY_SYSTEM,
    maxTokens: 200,
    validate: (x) => {
      const t = (x as { text?: unknown })?.text;
      if (typeof t !== "string") return null;
      const s = t.replace(/\s+/g, " ").trim();
      if (s.length < 10 || s.length > 400) return null;
      if (!numbersAllowed(s, factsJson)) return null;
      if (DELAY_BAD.test(s)) return null;
      return s;
    },
  });
}

/** How long one AI delay note is reused for the same trip in the same situation. */
const DELAY_NOTE_TTL_SECONDS = 10 * 60;

/**
 * explainDelay() for a page that refreshes itself.
 *
 * The trip page reloads every 30 s while a trip is open, and a late trip used
 * to ask the model afresh on every reload - two calls a minute for each open
 * tab. That spent the free Gemini quota within minutes (429s in the live logs,
 * 26 Nov 2026) and starved route planning and dispatch reading, which share it.
 *
 * Now one note is kept per trip for ten minutes, keyed on what kind of delay it
 * is - no signal, standing, slow, or just a late ETA - plus night and the
 * hours late. When that changes, the next view asks again straight away; when
 * it does not, the note's numbers can be up to ten minutes old, which is what
 * "a few minutes ago" reads as on this page anyway. Shared across server
 * instances (Next's data cache), so one tab or ten costs the same.
 */
export async function explainDelayCached(tripId: string, f: TripDelayFacts): Promise<string | null> {
  if (!aiAvailable()) return null;
  const mf = delayFactsForModel(f);
  const speeds = mf.recentSpeedsKmph ?? [];
  const recentAvg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : mf.avgSpeedKmph;
  const kind =
    f.lastSeenMinutesAgo != null && f.lastSeenMinutesAgo >= 60
      ? "signal"
      : (f.stoppedMinutes && f.stoppedMinutes >= 10) || (recentAvg != null && recentAvg < 3)
        ? "standing"
        : recentAvg != null && recentAvg < 25
          ? "slow"
          : "late";
  const lateHours =
    f.etaAt && f.promisedAt
      ? Math.floor((new Date(f.etaAt).getTime() - new Date(f.promisedAt).getTime()) / 3_600_000)
      : -1;
  const key = ["live-delay-note", tripId, kind, mf.nightTime ? "night" : "day", String(lateHours)];
  return unstable_cache(() => explainDelay(f), key, { revalidate: DELAY_NOTE_TTL_SECONDS })();
}

/** Rule-based explanation with the same shape as explainDelay(). */
export function explainDelayBasic(f: TripDelayFacts): string {
  const mf = delayFactsForModel(f);
  const speeds = mf.recentSpeedsKmph ?? [];
  const recentAvg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : mf.avgSpeedKmph;
  const dest = mf.toPlace ? ` to ${mf.toPlace}` : "";
  const truck = f.vehicleNo?.trim() || "The truck";
  const since = mf.standingSinceIst ? ` (since ${mf.standingSinceIst})` : "";
  let reason: string;
  let next: string;

  if (f.lastSeenMinutesAgo != null && f.lastSeenMinutesAgo >= 60) {
    reason = `No GPS signal from ${truck} for ${durationLabel(f.lastSeenMinutesAgo)}, so its position is uncertain.`;
    next = "Call the driver to confirm where the truck is.";
  } else if ((f.stoppedMinutes && f.stoppedMinutes >= 10) || (recentAvg != null && recentAvg < 3)) {
    // v5: a speed near 0 is "standing", never "moving slowly at 0 km/h".
    const forText = f.stoppedMinutes ? ` for ${durationLabel(f.stoppedMinutes)}` : "";
    reason = `${truck} is standing${mf.stoppedAt ? ` at ${mf.stoppedAt}` : ""}${forText}${since}${mf.nightTime ? ", likely a night halt" : ""}.`;
    next = mf.nightTime
      ? "Expect it to move in the morning; update the customer if the ETA matters."
      : "Call the driver to check the reason for the halt.";
  } else if (recentAvg != null && recentAvg < 25) {
    reason = `${truck} is moving slowly${dest} (about ${Math.round(recentAvg)} km/h recently), possibly traffic, a ghat section or a toll queue.`;
    next = "Watch the next hour; inform the customer if the ETA keeps slipping.";
  } else if (mf.lateBy) {
    reason = `${truck} is on the move${dest} but the live ETA is ${mf.lateBy} past the planned arrival${mf.distanceLeftKm != null ? ` with ${mf.distanceLeftKm} km left` : ""}.`;
    next = "Share the new ETA with the customer.";
  } else {
    reason = `${truck} looks on track${dest}${mf.distanceLeftKm != null ? `, ${mf.distanceLeftKm} km left` : ""}.`;
    next = "No action needed right now.";
  }
  return `${reason} ${next}`;
}

/* ======================================================================
 * 4. Road ahead (v4, 0083): major cities between here and the destination
 * ==================================================================== */

export type RoutePoint = { name: string; lat: number; lng: number; km: number };
type LL = { lat: number; lng: number };

/** Highway hubs and big cities, enough to describe most Indian truck routes. */
const HUBS: [string, number, number][] = [
  ["Ahmedabad", 23.02, 72.57], ["Rajkot", 22.3, 70.8], ["Morbi", 22.82, 70.84], ["Surendranagar", 22.73, 71.64],
  ["Vadodara", 22.31, 73.19], ["Surat", 21.17, 72.83], ["Bharuch", 21.7, 72.98], ["Vapi", 20.37, 72.9],
  ["Palanpur", 24.17, 72.43], ["Mehsana", 23.6, 72.38], ["Himmatnagar", 23.6, 72.97], ["Gandhidham", 23.08, 70.13],
  ["Jamnagar", 22.47, 70.06], ["Bhavnagar", 21.76, 72.15], ["Godhra", 22.78, 73.62], ["Udaipur", 24.58, 73.71],
  ["Jodhpur", 26.24, 73.02], ["Ajmer", 26.45, 74.64], ["Jaipur", 26.91, 75.79], ["Beawar", 26.1, 74.32],
  ["Bhilwara", 25.35, 74.63], ["Chittorgarh", 24.88, 74.62], ["Kota", 25.18, 75.83], ["Bikaner", 28.02, 73.31],
  ["Delhi", 28.61, 77.21], ["Gurugram", 28.46, 77.03], ["Agra", 27.18, 78.01], ["Mathura", 27.49, 77.67],
  ["Kanpur", 26.45, 80.33], ["Lucknow", 26.85, 80.95], ["Varanasi", 25.32, 82.97], ["Prayagraj", 25.44, 81.85],
  ["Gwalior", 26.22, 78.18], ["Jhansi", 25.45, 78.57], ["Indore", 22.72, 75.86], ["Ujjain", 23.18, 75.78],
  ["Ratlam", 23.33, 75.04], ["Bhopal", 23.26, 77.41], ["Jabalpur", 23.18, 79.95], ["Sagar", 23.84, 78.74],
  ["Dhule", 20.9, 74.77], ["Nashik", 20.0, 73.79], ["Mumbai", 19.08, 72.88], ["Thane", 19.22, 72.98],
  ["Pune", 18.52, 73.86], ["Aurangabad", 19.88, 75.34], ["Nagpur", 21.15, 79.09], ["Amravati", 20.93, 77.75],
  ["Solapur", 17.66, 75.91], ["Kolhapur", 16.7, 74.24], ["Belagavi", 15.85, 74.5], ["Hubballi", 15.36, 75.12],
  ["Bengaluru", 12.97, 77.59], ["Hyderabad", 17.39, 78.49], ["Vijayawada", 16.51, 80.65], ["Chennai", 13.08, 80.27],
  ["Raipur", 21.25, 81.63], ["Ludhiana", 30.9, 75.85], ["Ambala", 30.38, 76.78], ["Chandigarh", 30.73, 76.78],
  ["Panipat", 29.39, 76.97], ["Kolkata", 22.57, 88.36], ["Patna", 25.59, 85.14], ["Goa", 15.5, 73.83],
];

function kmBetween(a: LL, b: LL): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Position along a->b (0..1) and sideways distance (km), on a flat local projection. */
function along(a: LL, b: LL, p: LL): { t: number; offKm: number } {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const bx = (b.lng - a.lng) * k * 111;
  const by = (b.lat - a.lat) * 111;
  const px = (p.lng - a.lng) * k * 111;
  const py = (p.lat - a.lat) * 111;
  const len2 = bx * bx + by * by || 1;
  const t = (px * bx + py * by) / len2;
  const offKm = Math.abs(px * by - py * bx) / Math.sqrt(len2);
  return { t, offKm };
}

function finishRoute(current: LL, dest: LL, picks: { name: string; lat: number; lng: number }[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of picks) {
    const km = Math.round(kmBetween(current, p) * 1.25);
    if (out.some((o) => o.name.toLowerCase() === p.name.toLowerCase())) continue;
    if (kmBetween(current, p) < 25 || kmBetween(dest, p) < 25) continue;
    out.push({ name: p.name.slice(0, 40), lat: Number(p.lat.toFixed(3)), lng: Number(p.lng.toFixed(3)), km });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, 8);
}

/** Rule-based road ahead: hubs near the straight line, in order, at least ~60 km apart. */
export function routeWaypointsBasic(current: LL, dest: LL): RoutePoint[] {
  const total = kmBetween(current, dest);
  if (total < 60) return [];
  const corridor = Math.max(35, total * 0.12);
  const cands = HUBS.map(([name, lat, lng]) => ({ name, lat, lng, ...along(current, dest, { lat, lng }) }))
    .filter((c) => c.t > 0.04 && c.t < 0.96 && c.offKm <= corridor)
    .sort((a, b) => a.t - b.t);
  const picked: typeof cands = [];
  for (const c of cands) {
    const last = picked[picked.length - 1];
    if (last && (c.t - last.t) * total < 60) {
      if (c.offKm < last.offKm) picked[picked.length - 1] = c;
      continue;
    }
    picked.push(c);
  }
  return finishRoute(current, dest, picked);
}

const ROUTE_SYSTEM = `You know Indian truck routes (national highways). Given a truck's current position and its destination, list the major cities or highway towns it will most likely pass through, in order, excluding the start and the destination.
Return JSON: {"cities":[{"name":"Palanpur","lat":24.17,"lng":72.43}]}. At most 8. Only real places with correct coordinates. If the trip is short (< 60 km), return {"cities":[]}.`;

/** AI road ahead (validated to lie near the corridor and in order). Null when no key / invalid. */
export async function routeWaypoints(from: { name?: string | null } & LL, to: { name?: string | null } & LL, current: LL): Promise<RoutePoint[] | null> {
  if (!aiAvailable()) return null;
  const total = kmBetween(current, to);
  if (total < 60) return [];
  const facts = {
    tripFrom: from.name ? redact(from.name).slice(0, 60) : undefined,
    destination: to.name ? redact(to.name).slice(0, 60) : undefined,
    current: { lat: Number(current.lat.toFixed(3)), lng: Number(current.lng.toFixed(3)) },
    destinationPoint: { lat: Number(to.lat.toFixed(3)), lng: Number(to.lng.toFixed(3)) },
  };
  return aiJson<RoutePoint[]>(JSON.stringify(facts), {
    system: ROUTE_SYSTEM,
    maxTokens: 400,
    validate: (x) => {
      const list = (x as { cities?: unknown })?.cities;
      if (!Array.isArray(list) || list.length > 10) return null;
      const ok: { name: string; lat: number; lng: number; t: number }[] = [];
      for (const c of list) {
        const name = typeof c?.name === "string" ? c.name.replace(/[^A-Za-z .-]/g, "").trim() : "";
        const lat = Number(c?.lat);
        const lng = Number(c?.lng);
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6 || lat > 37 || lng < 68 || lng > 98) continue;
        const a = along(current, to, { lat, lng });
        if (a.t < 0 || a.t > 1.02 || a.offKm > Math.max(60, total * 0.3)) continue;
        ok.push({ name, lat, lng, t: a.t });
      }
      ok.sort((a, b) => a.t - b.t);
      return finishRoute(current, to, ok);
    },
  });
}

/* ======================================================================
 * 5. Route plan (v6, 0085): the trip's main stops, From -> To, built once
 * ==================================================================== */

const PLAN_SYSTEM = `You know Indian truck routes (national highways). Given a truck trip's origin and destination, list the main stops a truck would pass, in order: major cities, highway towns and big junctions (bypass towns count), excluding the origin and the destination.
Return JSON: {"stops":[{"name":"Palanpur","lat":24.17,"lng":72.43,"km":145}],"total_km":620}. km = approximate road km from the origin. 4 to 10 stops for long trips, fewer for short ones (none under 60 km). Only real places with correct coordinates.`;

/**
 * AI route plan (whole trip). Validated: inside India, near the corridor, in order, km increasing and
 * plausible against the straight line. Null when no key / invalid; the caller falls back to routeWaypointsBasic.
 */
export async function routePlanAI(from: { name?: string | null } & LL, to: { name?: string | null } & LL): Promise<{ stops: RoutePoint[]; totalKm: number } | null> {
  if (!aiAvailable()) return null;
  const straight = kmBetween(from, to);
  if (straight < 60) return { stops: [], totalKm: Math.round(straight * 1.25) };
  const facts = {
    origin: from.name ? redact(from.name).slice(0, 60) : undefined,
    destination: to.name ? redact(to.name).slice(0, 60) : undefined,
    originPoint: { lat: Number(from.lat.toFixed(3)), lng: Number(from.lng.toFixed(3)) },
    destinationPoint: { lat: Number(to.lat.toFixed(3)), lng: Number(to.lng.toFixed(3)) },
  };
  return aiJson<{ stops: RoutePoint[]; totalKm: number }>(JSON.stringify(facts), {
    system: PLAN_SYSTEM,
    maxTokens: 700,
    validate: (x) => {
      const list = (x as { stops?: unknown })?.stops;
      if (!Array.isArray(list) || list.length > 14) return null;
      const rawTotal = Number((x as { total_km?: unknown })?.total_km);
      const totalKm = Number.isFinite(rawTotal) && rawTotal >= straight && rawTotal <= straight * 1.9 ? Math.round(rawTotal) : Math.round(straight * 1.25);
      const ok: (RoutePoint & { t: number })[] = [];
      for (const c of list) {
        const name = typeof c?.name === "string" ? c.name.replace(/[^A-Za-z .()-]/g, "").trim().slice(0, 40) : "";
        const lat = Number(c?.lat);
        const lng = Number(c?.lng);
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6 || lat > 37 || lng < 68 || lng > 98) continue;
        const a = along(from, to, { lat, lng });
        if (a.t < 0.02 || a.t > 0.98 || a.offKm > Math.max(60, straight * 0.3)) continue;
        const direct = kmBetween(from, { lat, lng });
        if (direct < 20 || kmBetween(to, { lat, lng }) < 20) continue;
        const aiKm = Number(c?.km);
        // Road km: AI's figure when plausible (1.0-1.9 x straight line), else straight x 1.25.
        const km = Number.isFinite(aiKm) && aiKm >= direct && aiKm <= direct * 1.9 + 15 ? Math.round(aiKm) : Math.round(direct * 1.25);
        if (ok.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
        ok.push({ name, lat: Number(lat.toFixed(3)), lng: Number(lng.toFixed(3)), km, t: a.t });
      }
      ok.sort((a, b) => a.t - b.t);
      // km must increase along the way and stay below the total.
      const stops: RoutePoint[] = [];
      for (const s of ok) {
        const prev = stops[stops.length - 1];
        if (prev && s.km <= prev.km + 5) continue;
        if (s.km >= totalKm - 10) continue;
        stops.push({ name: s.name, lat: s.lat, lng: s.lng, km: s.km });
      }
      if (straight > 150 && stops.length < 2) return null;
      return { stops: stops.slice(0, 10), totalKm };
    },
  });
}
