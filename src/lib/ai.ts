import "server-only";
import { env } from "@/lib/env";

/**
 * Small provider-agnostic LLM layer on FREE tiers (Google AI Studio Gemini,
 * Groq). Entirely optional: with no key set, aiAvailable() is false and every
 * call returns null, so callers fall back to their rule-based path.
 *
 * Never throws. A failure logs one short console.error line (no prompt text,
 * no key) and returns null.
 *
 * PRIVACY: callers must pass user text through redact() before it reaches a
 * prompt. Phone numbers and emails never go to a third-party model.
 */

export type AiProvider = "gemini" | "groq";

export type AiTextOptions = {
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** 0..1, default 0.2 (we want factual, not creative). */
  temperature?: number;
};

export type AiJsonOptions<T> = {
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
  /** Return the typed value, or null if the parsed JSON is not acceptable. */
  validate: (x: unknown) => T | null;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_TOKENS = 800;
const MAX_PROMPT_CHARS = 24_000;

/**
 * Every configured key, in the order tried: Gemini keys, then Groq keys.
 * GEMINI_API_KEY / GROQ_API_KEY may each hold several keys separated by
 * commas; a key that fails (429, timeout, error) hands the call to the next.
 */
type AiKey = { provider: AiProvider; key: string };
function splitKeys(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((k) => k.trim()).filter(Boolean);
}
function aiKeys(): AiKey[] {
  return [
    ...splitKeys(env.geminiApiKey).map((key) => ({ provider: "gemini" as const, key })),
    ...splitKeys(env.groqApiKey).map((key) => ({ provider: "groq" as const, key })),
  ];
}
/** A key that just answered 429 rests for a minute; the others carry on. */
const keyCooldown = new Map<string, number>();

/** Which provider would be tried first. */
export function aiProvider(): AiProvider | null {
  return aiKeys()[0]?.provider ?? null;
}

export function aiAvailable(): boolean {
  return aiProvider() !== null;
}

/* ---------------- redaction ---------------- */

/**
 * Masks Indian mobile numbers (with or without +91 / 0 / spaces / dashes)
 * and emails. Vehicle numbers, 12-digit e-way bill numbers (also when printed
 * as "1234 5678 9012") and GSTINs are left intact on purpose:
 * they are business identifiers the extractor needs.
 */
export function redact(text: string): string {
  if (!text) return text;
  return (
    text
      // emails
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      // Indian mobiles: optional "+91", "91 "/"91-", or "0" prefix, then 6-9
      // and 9 more digits, allowing single spaces or dashes between groups.
      // A bare 12-digit run "91XXXXXXXXXX" is NOT treated as a phone, because
      // that is also the shape of an e-way bill number.
      .replace(
        /(?<![\dA-Za-z])(?:\+91[\s-]?|91[\s-]|0)?[6-9](?:[\s-]?\d){9}(?![\d])/g,
        "[phone]",
      )
  );
}

/* ---------------- rate guard ---------------- */

/*
 * Per-instance only (serverless instances do not share it). It exists to stop
 * one runaway loop from burning the whole free daily quota, not to be exact.
 * Free tiers are ~10-30 requests/minute; stay under that.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;
const recentCalls: number[] = [];
let cooldownUntil = 0;

function takeRateSlot(): boolean {
  const now = Date.now();
  if (now < cooldownUntil) return false;
  while (recentCalls.length && now - recentCalls[0] > RATE_WINDOW_MS) recentCalls.shift();
  if (recentCalls.length >= RATE_MAX_PER_WINDOW) return false;
  recentCalls.push(now);
  return true;
}

/* ---------------- helpers ---------------- */

/** Strips ```json ... ``` fences and surrounding chatter. */
export function stripCodeFences(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json|JSON|txt|text)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  return t;
}

/** Parses JSON from model output, tolerating fences and leading/trailing text. */
export function parseJsonLoose(text: string): unknown {
  const t = stripCodeFences(text);
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  const end = t.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function logFail(provider: AiProvider, what: string) {
  console.error(`[ai] ${provider} ${what}`);
}

type CallArgs = {
  prompt: string;
  system?: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  json: boolean;
};

async function callGemini(a: CallArgs, apiKey: string): Promise<string | null> {
  const model = env.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: a.prompt }] }],
    generationConfig: {
      temperature: a.temperature,
      maxOutputTokens: a.maxTokens,
      ...(a.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (a.system) body.systemInstruction = { parts: [{ text: a.system }] };

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // header rather than ?key= so the key never lands in a logged URL
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
    a.timeoutMs,
  );
  if (!res) return failNull("gemini", "timeout/network");
  if (!res.ok) {
    if (res.status === 429) keyCooldown.set(apiKey, Date.now() + 60_000);
    return failNull("gemini", `http ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  } | null;
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("").trim();
  if (!text) return failNull("gemini", `empty (${data?.candidates?.[0]?.finishReason ?? "no candidate"})`);
  return text;
}

async function callGroq(a: CallArgs, apiKey: string): Promise<string | null> {
  const messages: { role: string; content: string }[] = [];
  if (a.system) messages.push({ role: "system", content: a.system });
  messages.push({ role: "user", content: a.prompt });
  const res = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.groqModel,
        messages,
        temperature: a.temperature,
        max_tokens: a.maxTokens,
        ...(a.json ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    a.timeoutMs,
  );
  if (!res) return failNull("groq", "timeout/network");
  if (!res.ok) {
    if (res.status === 429) keyCooldown.set(apiKey, Date.now() + 60_000);
    return failNull("groq", `http ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) return failNull("groq", "empty");
  return text;
}

function failNull(provider: AiProvider, what: string): null {
  logFail(provider, what);
  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function run(a: CallArgs): Promise<string | null> {
  const provider = aiProvider();
  if (!provider) return null;
  if (!takeRateSlot()) {
    logFail(provider, "rate guard: skipped");
    return null;
  }
  const prompt = a.prompt.length > MAX_PROMPT_CHARS ? a.prompt.slice(0, MAX_PROMPT_CHARS) : a.prompt;
  const args = { ...a, prompt };
  const now = Date.now();
  for (const { provider: p, key } of aiKeys()) {
    if ((keyCooldown.get(key) ?? 0) > now) continue;
    try {
      const out = p === "gemini" ? await callGemini(args, key) : await callGroq(args, key);
      if (out) return out;
    } catch (e) {
      logFail(p, `error ${(e as Error)?.name ?? "unknown"}`);
    }
  }
  return null;
}

/* ---------------- public API ---------------- */

/** Plain text completion. Null when AI is off or the call fails. */
export async function aiText(prompt: string, opts: AiTextOptions = {}): Promise<string | null> {
  const out = await run({
    prompt,
    system: opts.system,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? 0.2,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    json: false,
  });
  if (out == null) return null;
  const t = stripCodeFences(out);
  return t || null;
}

/**
 * JSON completion. The model is asked for a JSON object (native JSON mode on
 * both providers); output is parsed loosely and passed through validate().
 * Null when AI is off, the call fails, or validation rejects it.
 */
export async function aiJson<T>(prompt: string, opts: AiJsonOptions<T>): Promise<T | null> {
  const provider = aiProvider();
  const system = [opts.system, "Respond with a single JSON object only. No prose, no markdown."]
    .filter(Boolean)
    .join("\n");
  const out = await run({
    prompt,
    system,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? 0,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    json: true,
  });
  if (out == null) return null;
  const parsed = parseJsonLoose(out);
  if (parsed == null) {
    if (provider) logFail(provider, "unparseable json");
    return null;
  }
  try {
    const v = opts.validate(parsed);
    if (v == null && provider) logFail(provider, "json failed validation");
    return v;
  } catch {
    if (provider) logFail(provider, "validator threw");
    return null;
  }
}
