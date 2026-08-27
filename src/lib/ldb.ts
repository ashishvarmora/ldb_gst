/**
 * Client for the LDB (Logistics Data Bank) truck search endpoint.
 *
 * Same request the public portal makes, and the same response shape the original
 * Apps Script walked:
 *   responseBody.groupEvents[].containerGroupingList[]
 *     -> { seqNo, eventTime, locName, locLat, locLong, laneDirection, eventName }
 *
 * seqNo is the natural unique key for a toll crossing. It is longer than a safe
 * JS integer, so it is kept as text everywhere.
 */

export type LdbEvent = {
  seqNo: string;
  eventTimeRaw: string | null;
  /** ISO string, or null when the portal sent something unparseable. */
  eventTime: string | null;
  locName: string | null;
  lat: number | null;
  lng: number | null;
  direction: string | null;
  eventName: string | null;
};

export type LdbResult =
  | { ok: true; events: LdbEvent[]; httpStatus: number; ms: number }
  | { ok: false; error: string; httpStatus: number | null; ms: number };

const TIMEOUT_MS = 15_000;

/**
 * The portal reports event times in IST with no offset ("2026-07-16 19:54:51").
 * Reading that as UTC would shift every crossing by 5.5 hours.
 */
export function parseIstTimestamp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss ?? "00"}+05:30`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // Fall back to whatever the platform can parse, e.g. an already-offset string.
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

type RawEvent = {
  seqNo?: unknown;
  eventTime?: unknown;
  locName?: unknown;
  locLat?: unknown;
  locLong?: unknown;
  laneDirection?: unknown;
  eventName?: unknown;
};

/** Pull the flat event list out of the portal's nested envelope. */
export function parseLdbResponse(payload: unknown): LdbEvent[] {
  const body = (payload as { responseBody?: { groupEvents?: unknown } } | null)?.responseBody;
  const groups = Array.isArray(body?.groupEvents) ? body.groupEvents : [];
  const events: LdbEvent[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const list = (group as { containerGroupingList?: unknown })?.containerGroupingList;
    if (!Array.isArray(list)) continue;

    for (const item of list as RawEvent[]) {
      const seqNo = clean(item?.seqNo);
      if (!seqNo || seen.has(seqNo)) continue;
      seen.add(seqNo);

      const eventTimeRaw = clean(item?.eventTime);
      events.push({
        seqNo,
        eventTimeRaw,
        eventTime: parseIstTimestamp(eventTimeRaw),
        locName: clean(item?.locName),
        lat: toNumber(item?.locLat),
        lng: toNumber(item?.locLong),
        direction: clean(item?.laneDirection),
        eventName: clean(item?.eventName),
      });
    }
  }

  // Newest crossing first.
  events.sort((a, b) => (b.eventTime ?? "").localeCompare(a.eventTime ?? ""));
  return events;
}

export async function fetchTruckEvents(
  truckNumber: string,
  apiUrl: string,
): Promise<LdbResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: "https://ldb.co.in",
        Referer: `https://ldb.co.in/ldb/trucksearchlog/42/${truckNumber}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      body: JSON.stringify({ vehiclenumber: truckNumber }),
      signal: controller.signal,
      cache: "no-store",
    });

    const ms = Date.now() - started;

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        ms,
        error:
          response.status === 403 || response.status === 429
            ? "Portal is rate-limiting. Try a slower polling interval."
            : `Portal returned HTTP ${response.status}.`,
      };
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        ok: false,
        httpStatus: response.status,
        ms,
        error: "Portal did not return JSON (it may be showing a captcha page).",
      };
    }

    return { ok: true, events: parseLdbResponse(payload), httpStatus: response.status, ms };
  } catch (error) {
    const ms = Date.now() - started;
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      httpStatus: null,
      ms,
      error: aborted
        ? `Portal did not respond within ${TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : "Unknown network error.",
    };
  }
}
