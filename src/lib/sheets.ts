import { env } from "@/lib/env";
import { getGoogleAccessToken, type TokenResult } from "@/lib/google-auth";

/**
 * Minimal Google Sheets client using one platform service account.
 *
 * Each account may share its own sheet with the service account as Editor, and
 * the admin's sheet is the fallback for anyone who has not - so no customer
 * credential is ever handled. Written against the REST API directly: the
 * googleapis package is ~10 MB for the three calls actually made here.
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
const TIMEOUT_MS = 15_000;

export type SheetResult = { ok: true } | { ok: false; error: string };

/**
 * The sheet is the long-term copy of everything the database does not keep.
 *
 * One tab per table, because that is what makes it readable afterwards: a
 * single sheet holding crossings, searches and money would need a filter
 * before it could answer anything. The keys are the table names, so the
 * retention rules and these tabs cannot drift apart.
 */
export const SHEET_TABS: Record<string, string> = {
  truck_events: "Toll Crossings",
  search_logs: "Search Activity",
  alert_logs: "Alerts Sent",
  audit_logs: "Account Activity",
  credit_transactions: "Credit Movements",
  payments: "Payments",
  coupon_redemptions: "Coupon Claims",
};

/**
 * Header row per tab. A tab with no header here still works - it is created
 * and appended to - but a reader would have to guess the columns, so every
 * entity that is exported should have one.
 */
export const TAB_HEADERS: Record<string, string[]> = {
  [SHEET_TABS.truck_events]: [
    "Crossed At (IST)", "Truck", "Toll Plaza", "Latitude", "Longitude",
    "Direction", "Event", "SeqNo", "Recorded At (IST)",
  ],
  [SHEET_TABS.search_logs]: [
    "At (IST)", "Truck", "Kind", "Worked", "Crossings Found", "New",
    "Took (ms)", "Problem",
  ],
  [SHEET_TABS.alert_logs]: [
    "At (IST)", "Truck", "Alert", "Title", "Message", "Delivered", "Problem",
  ],
  [SHEET_TABS.audit_logs]: [
    "At (IST)", "Who", "Role", "Action", "Thing", "Which", "Detail",
  ],
  [SHEET_TABS.credit_transactions]: [
    "At (IST)", "Change", "Balance After", "Reason", "Truck", "Note",
  ],
  [SHEET_TABS.payments]: [
    "At (IST)", "Kind", "Charged (Rs)", "Discount (Rs)", "Credits", "Status",
    "Order", "Paid At (IST)",
  ],
  [SHEET_TABS.coupon_redemptions]: [
    "At (IST)", "Status", "Order Value (Rs)", "Discount (Rs)", "Settled At (IST)",
  ],
};

/* -------------------------------------------------------------------------- */
/* auth                                                                        */
/* -------------------------------------------------------------------------- */

function getAccessToken(): Promise<TokenResult> {
  const email = env.googleServiceAccountEmail;
  const key = env.googleServiceAccountKey;
  if (!email || !key) {
    return Promise.resolve({ ok: false, error: "Google service account is not configured." });
  }
  return getGoogleAccessToken({
    email,
    key,
    scope: SCOPE,
    keyName: "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  });
}

/* -------------------------------------------------------------------------- */
/* low-level calls                                                             */
/* -------------------------------------------------------------------------- */

async function call(
  token: string,
  path: string,
  init: RequestInit,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; status?: string } }
      | null;

    if (!response.ok) {
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      return {
        ok: false,
        error:
          response.status === 403
            ? `Google refused access. Share the sheet as Editor with ${env.googleServiceAccountEmail}.`
            : response.status === 404
              ? "Sheet not found. Check the URL."
              : message,
      };
    }

    return { ok: true, body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "Google Sheets timed out." : (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Creates any missing tab and writes its header row. Safe to call every time. */
async function ensureTabs(
  token: string,
  spreadsheetId: string,
  wanted: string[],
): Promise<SheetResult> {
  const meta = await call(token, `/${spreadsheetId}?fields=sheets.properties.title`, {
    method: "GET",
  });
  if (!meta.ok) return meta;

  const existing = new Set(
    (
      ((meta.body as { sheets?: { properties?: { title?: string } }[] }).sheets ?? [])
        .map((sheet) => sheet.properties?.title)
        .filter(Boolean) as string[]
    ).map((title) => title),
  );

  const missing = wanted.filter((title) => !existing.has(title));
  if (missing.length === 0) return { ok: true };

  const created = await call(token, `/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    }),
  });
  if (!created.ok) return created;

  for (const title of missing) {
    const header = TAB_HEADERS[title];
    if (!header) continue;
    const written = await call(
      token,
      `/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ values: [header] }) },
    );
    if (!written.ok) return written;
  }

  return { ok: true };
}

async function append(
  token: string,
  spreadsheetId: string,
  tab: string,
  rows: (string | number | null)[][],
): Promise<SheetResult> {
  if (rows.length === 0) return { ok: true };
  const result = await call(
    token,
    `/${spreadsheetId}/values/${encodeURIComponent(`${tab}!A1`)}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
  return result.ok ? { ok: true } : result;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                  */
/* -------------------------------------------------------------------------- */

export type SheetRows = (string | number | null)[][];

/**
 * Keyed by TABLE name, not tab name - the caller works in tables and this
 * module owns what each one is called in the sheet.
 */
export type SheetPayload = Record<string, SheetRows>;

/**
 * One round trip per non-empty section. Never throws: a broken sheet must not
 * stop tracking or alerting, so callers log the error and carry on.
 */
export async function syncToSheet(
  spreadsheetId: string,
  payload: SheetPayload,
): Promise<SheetResult> {
  const wanted = Object.entries(payload).filter(([, rows]) => rows.length > 0);
  if (wanted.length === 0) return { ok: true };

  const auth = await getAccessToken();
  if (!auth.ok) return auth;

  // Every tab is created up front in one round trip, rather than one call per
  // tab as rows are appended.
  const tabs = await ensureTabs(
    auth.token,
    spreadsheetId,
    wanted.map(([entity]) => SHEET_TABS[entity] ?? entity),
  );
  if (!tabs.ok) return tabs;

  for (const [entity, rows] of wanted) {
    const result = await append(auth.token, spreadsheetId, SHEET_TABS[entity] ?? entity, rows);
    // Stop on the first failure. Carrying on would delete rows for the tabs
    // that happened to succeed while the caller thinks the whole export failed.
    if (!result.ok) return result;
  }

  return { ok: true };
}

export function spreadsheetIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const text = url.trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{25,}$/.test(text) ? text : null;
}
