import { createSign } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Minimal Google Sheets client using one platform service account.
 *
 * Officers share their own sheet with the service-account email as Editor, so we
 * never handle an officer credential. Written against the REST API directly:
 * the googleapis package is ~10 MB for the three calls we actually make.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
const TIMEOUT_MS = 15_000;

export type SheetResult = { ok: true } | { ok: false; error: string };

/**
 * The sheet is the long-term copy of where trucks have been, kept for after
 * retention trims the database. It holds crossings and nothing else - alerts,
 * searches and usage all live in the app, where they can be filtered, and
 * mirroring them here only made the sheet harder to read as a location log.
 */
export const SHEET_TABS = {
  events: "Truck Events",
} as const;

const TAB_HEADERS: Record<string, string[]> = {
  [SHEET_TABS.events]: [
    "Event Time (IST)",
    "Truck",
    "Location",
    "Latitude",
    "Longitude",
    "Direction",
    "Event",
    "SeqNo",
    "Logged At (IST)",
  ],
};

/* -------------------------------------------------------------------------- */
/* auth                                                                        */
/* -------------------------------------------------------------------------- */

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Env vars usually carry the PEM with literal backslash-n sequences. */
function normalisePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

async function getAccessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedToken.value };
  }

  const email = env.googleServiceAccountEmail;
  const key = env.googleServiceAccountKey;
  if (!email || !key) {
    return { ok: false, error: "Google service account is not configured." };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  let assertion: string;
  try {
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${claims}`)
      .sign(normalisePrivateKey(key));
    assertion = `${header}.${claims}.${base64url(signature)}`;
  } catch (error) {
    return {
      ok: false,
      error: `Could not sign the Google token request — check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY. (${(error as Error).message})`,
    };
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error_description?: string }
      | null;

    if (!response.ok || !body?.access_token) {
      return {
        ok: false,
        error: body?.error_description ?? `Google token endpoint returned HTTP ${response.status}.`,
      };
    }

    cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return { ok: true, token: body.access_token };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
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

export type SheetPayload = {
  events?: (string | number | null)[][];
};

/**
 * One round trip per non-empty section. Never throws: a broken sheet must not
 * stop tracking or alerting, so callers log the error and carry on.
 */
export async function syncToSheet(
  spreadsheetId: string,
  payload: SheetPayload,
): Promise<SheetResult> {
  const auth = await getAccessToken();
  if (!auth.ok) return auth;

  if (!payload.events?.length) return { ok: true };

  const tabs = await ensureTabs(auth.token, spreadsheetId, [SHEET_TABS.events]);
  if (!tabs.ok) return tabs;

  return append(auth.token, spreadsheetId, SHEET_TABS.events, payload.events);
}

/** Used by the "test connection" button on the officer settings page. */
export async function testSheetAccess(spreadsheetId: string): Promise<SheetResult> {
  const auth = await getAccessToken();
  if (!auth.ok) return auth;
  const tabs = await ensureTabs(auth.token, spreadsheetId, Object.values(SHEET_TABS));
  return tabs;
}

/** Pull a spreadsheet id out of a pasted URL, or accept a bare id. */
export function spreadsheetIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const text = url.trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{25,}$/.test(text) ? text : null;
}
