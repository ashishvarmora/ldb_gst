import { createSign } from "node:crypto";

/**
 * An OAuth access token for a Google service account, by the JWT-bearer grant.
 *
 * Shared by the Sheets client and the FCM sender, which use two different
 * service accounts (the Sheets one and the Firebase project's), so the cache is
 * keyed by account and scope. Written against the token endpoint directly for
 * the same reason sheets.ts is: google-auth-library is a large dependency for
 * one signed POST.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type TokenResult = { ok: true; token: string } | { ok: false; error: string };

const cache = new Map<string, { value: string; expiresAt: number }>();

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

export async function getGoogleAccessToken({
  email,
  key,
  scope,
  keyName,
}: {
  email: string;
  key: string;
  scope: string;
  /** The env var the key came from, named in the error when it will not sign. */
  keyName: string;
}): Promise<TokenResult> {
  const cacheKey = `${email} ${scope}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cached.value };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope,
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
      error: `Could not sign the Google token request — check ${keyName}. (${(error as Error).message})`,
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

    cache.set(cacheKey, {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    });
    return { ok: true, token: body.access_token };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
