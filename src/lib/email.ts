import { env } from "@/lib/env";

/**
 * Outbound email, through Resend.
 *
 * Only transactional mail: a password reset, and a welcome note. No SDK - it
 * is one POST, and the package would be a dependency for a single fetch.
 *
 * Never throws. A failed send must not take a Server Action down with it; the
 * caller decides what to tell the person, and the reason goes to the log.
 */

const API = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export type EmailResult = { ok: true; id?: string } | { ok: false; error: string };

export function emailConfigured(): boolean {
  return Boolean(env.resendApiKey && env.emailFrom);
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  if (!emailConfigured()) {
    return { ok: false, error: "Email is not configured on this deployment." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.resendApiKey}`,
      },
      // A plain-text part as well as HTML: some corporate mail clients strip
      // the HTML entirely, and a reset link nobody can see is a support call.
      body: JSON.stringify({ from: env.emailFrom, to: [to], subject, html, text }),
      signal: controller.signal,
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!response.ok) {
      return { ok: false, error: body?.message ?? `Resend returned ${response.status}.` };
    }
    return { ok: true, id: body?.id };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "Email provider timed out." : (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately plain. Transactional mail lands in more inboxes when it looks
 * like a person wrote it than when it looks like a campaign, and there is
 * nothing here that needs a layout.
 */
function shell(brand: string, heading: string, lines: string[], button?: { label: string; url: string }) {
  const paragraphs = lines
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933">${line}</p>`,
    )
    .join("");

  const cta = button
    ? `<p style="margin:24px 0"><a href="${button.url}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#1d4ed8;color:#fff;font:600 15px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-decoration:none">${button.label}</a></p>
       <p style="margin:0 0 14px;font:13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#5b6b7b">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;color:#1d4ed8">${button.url}</span></p>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f9">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e3e8ef;border-radius:12px;padding:28px">
    <p style="margin:0 0 20px;font:600 15px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d4ed8">${brand}</p>
    <h1 style="margin:0 0 16px;font:600 20px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933">${heading}</h1>
    ${paragraphs}${cta}
  </div>
</body></html>`;
}

export function passwordResetEmail(brand: string, url: string) {
  return {
    subject: `Reset your ${brand} password`,
    html: shell(
      brand,
      "Reset your password",
      [
        "Someone asked to reset the password on this account. If that was you, use the button below.",
        "The link works once and expires in an hour.",
      ],
      { label: "Choose a new password", url },
    ),
    text: `Reset your ${brand} password\n\nSomeone asked to reset the password on this account. If that was you, open this link:\n\n${url}\n\nThe link works once and expires in an hour. If it was not you, ignore this email - nothing has changed.`,
  };
}

export function welcomeEmail(brand: string, url: string) {
  return {
    subject: `Welcome to ${brand}`,
    html: shell(
      brand,
      "Your account is ready",
      [
        "You can sign in now. To start watching a truck you will need a plan, which you can choose from your account.",
        "Add a truck, give it an alert, and you will be messaged when it moves.",
      ],
      { label: "Sign in", url },
    ),
    text: `Welcome to ${brand}\n\nYour account is ready - sign in at ${url}\n\nTo start watching a truck you will need a plan, which you can choose from your account. Add a truck, give it an alert, and you will be messaged when it moves.`,
  };
}
