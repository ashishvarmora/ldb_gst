import "server-only";
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
    lastSignal: f.lastSeenMinutesAgo != null ? `${durationLabel(f.lastSeenMinutesAgo)} ago` : undefined,
    notes: (f.notes ?? []).slice(0, 5).map(redact),
  };
}

const DELAY_SYSTEM = `You help an Indian factory owner understand why a truck is late.
Given trip facts, write one or two short sentences: the most likely reason (only from the facts: long stoppage, slow speed, night halt, no GPS signal, distance left) and one practical next step (e.g. call the driver, inform the customer of the new ETA, extend the e-way bill).
Use ONLY the given facts and numbers; never invent places, causes like accidents, or new numbers. Plain simple English; common Hindi words in Latin script are fine.
Return JSON: {"text": "..."}`;

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
      return s;
    },
  });
}

/** Rule-based explanation with the same shape as explainDelay(). */
export function explainDelayBasic(f: TripDelayFacts): string {
  const mf = delayFactsForModel(f);
  const speeds = mf.recentSpeedsKmph ?? [];
  const recentAvg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : mf.avgSpeedKmph;
  const dest = mf.toPlace ? ` to ${mf.toPlace}` : "";
  let reason: string;
  let next: string;

  if (f.lastSeenMinutesAgo != null && f.lastSeenMinutesAgo >= 60) {
    reason = `No GPS signal from ${f.vehicleNo} for ${durationLabel(f.lastSeenMinutesAgo)}, so its position is uncertain.`;
    next = "Call the driver to confirm where the truck is.";
  } else if (f.stoppedMinutes && f.stoppedMinutes >= 30) {
    reason = `${f.vehicleNo} has been stopped${mf.stoppedAt ? ` at ${mf.stoppedAt}` : ""} for ${durationLabel(f.stoppedMinutes)}${mf.nightTime ? ", likely a night halt" : ""}.`;
    next = mf.nightTime
      ? "Expect it to move in the morning; update the customer if the ETA matters."
      : "Call the driver to check the reason for the halt.";
  } else if (recentAvg != null && recentAvg < 25) {
    reason = `${f.vehicleNo} is moving slowly${dest} (about ${Math.round(recentAvg)} km/h recently), possibly traffic, a ghat section or a toll queue.`;
    next = "Watch the next hour; inform the customer if the ETA keeps slipping.";
  } else if (mf.lateBy) {
    reason = `${f.vehicleNo} is on the move${dest} but the ETA is ${mf.lateBy} past the promised time${mf.distanceLeftKm != null ? ` with ${mf.distanceLeftKm} km left` : ""}.`;
    next = "Share the new ETA with the customer.";
  } else {
    reason = `${f.vehicleNo} looks on track${dest}${mf.distanceLeftKm != null ? `, ${mf.distanceLeftKm} km left` : ""}.`;
    next = "No action needed right now.";
  }
  return `${reason} ${next}`;
}
