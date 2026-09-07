import { methodLabel } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { env } from "@/lib/env";
import { fmtDate, fmtRupees } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Outbound email, through Resend.
 *
 * Transactional mail to a customer - a password reset, a welcome note, a
 * verification code - and, at the bottom of this file, the internal
 * notifications that tell an administrator a customer or a payment has
 * arrived. No SDK: it is one POST, and the package would be a dependency for a
 * single fetch.
 *
 * Never throws. A failed send must not take a Server Action down with it; the
 * caller decides what to tell the person, and the reason goes to the log.
 */

/**
 * Only the admin client's type, so this module stays a transport plus
 * templates and never drags the service-role client into anything that imports
 * it. The same trick settings.ts uses, for the same reason.
 */
type Admin = ReturnType<typeof getSupabaseAdmin>;

const API = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export type EmailResult = { ok: true; id?: string } | { ok: false; error: string };

export function emailConfigured(): boolean {
  return Boolean(env.resendApiKey && env.emailFrom);
}

/**
 * Resend's shared sandbox sender. It needs no DNS, so it is what a new account
 * reaches for and what deployments end up shipping with - but Resend only
 * delivers from it to the address that owns the Resend account. Every other
 * recipient is refused with a 403, which means a password reset sent from here
 * reaches nobody who needs one.
 */
const SANDBOX_DOMAIN = "resend.dev";

/** The address out of "Name <a@b.com>", or the string as given. */
function senderAddress(from: string): string {
  return from.match(/<([^>]*)>/)?.[1]?.trim() ?? from.trim();
}

/**
 * Why this deployment cannot mail a stranger, or null when it can.
 *
 * Deliberately not folded into emailConfigured(): the key and the from address
 * can both be set, every send can come back 200 for the operator testing it
 * with their own address, and every customer can still hear nothing. That gap
 * is the whole reason a broken reset flow looks like a working one.
 */
export function emailSenderProblem(): string | null {
  if (!env.resendApiKey) return "RESEND_API_KEY is not set, so no email can be sent at all.";
  if (!env.emailFrom) return "EMAIL_FROM is not set, so no email can be sent at all.";

  const address = senderAddress(env.emailFrom);
  const domain = address.split("@")[1]?.toLowerCase() ?? "";

  if (!domain) {
    return `EMAIL_FROM does not contain an email address (it reads "${env.emailFrom}").`;
  }
  if (domain === SANDBOX_DOMAIN || domain.endsWith(`.${SANDBOX_DOMAIN}`)) {
    return `EMAIL_FROM is ${address}, which is Resend's sandbox sender. Resend only delivers from it to the address that owns the Resend account, so nobody else can receive a password reset. Verify a domain at resend.com/domains and set EMAIL_FROM to an address on it.`;
  }
  return null;
}

/** Whether a reset link can actually reach a customer, not just the operator. */
export function canEmailCustomers(): boolean {
  return emailSenderProblem() === null;
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
      const detail = body?.message ?? body?.name ?? "no reason given";
      return { ok: false, error: `Resend returned ${response.status}: ${detail}` };
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

/**
 * The six-digit code that proves a mailbox before a free trial is granted.
 *
 * No link and no button, deliberately, unlike every other email here. A code
 * typed back into the page it was asked from cannot be turned into a
 * one-click action by a forwarded email, and it means the person reading the
 * mailbox and the person at the keyboard have to be the same.
 *
 * The code is in the subject line as well as the body: on a phone that is one
 * glance at a notification rather than opening the mail app, and the trial is
 * abandoned by anybody made to work for it.
 */
export function verifyEmailCode(brand: string, code: string, minutes: number) {
  return {
    subject: `${code} is your ${brand} verification code`,
    html: shell(brand, "Verify your email address", [
      `Your code is <strong style="font-size:22px;letter-spacing:3px">${code}</strong>`,
      `It expires in ${minutes} minutes and can be used once.`,
      "If you did not ask for this, ignore it - nothing has changed and no trial has started.",
    ]),
    text:
      `Verify your ${brand} email address

` +
      `Your code is ${code}

` +
      `It expires in ${minutes} minutes and can be used once. ` +
      `If you did not ask for this, ignore it - nothing has changed and no trial has started.`,
  };
}

/* -------------------------------------------------------------------------- */
/* telling an administrator                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The three things the owner asked to hear about: "new customer signup / buy a
 * plan / topup credit". One switch each in app_settings, beside the address
 * itself - 0046 says why the address alone was not enough.
 *
 * A combined plan-plus-top-up payment is ONE event, not two. It is one order,
 * one payment row and one settlement, so it counts as "plan" and the mail
 * mentions the credits that rode along. Splitting it would send two mails for
 * one purchase, and let half of it be silenced by the other switch.
 */
export type AdminEvent = "signup" | "plan" | "topup";

/**
 * HTML-escaped, because everything interpolated below was typed by a customer.
 *
 * A full name, an email address and a payment note all come from whoever signed
 * up, and one of them containing "<" is enough to swallow the rest of the mail
 * inside a broken tag. This is the message that carries the takings to the
 * owner's inbox, so it is the one place a mangled body reads as the money
 * having gone wrong.
 */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Where to announce `event`, or null when nothing should be sent.
 *
 * Four ways to get null, and only the last is a fault:
 *   - no address set, which is how a fresh deployment ships;
 *   - this event switched off;
 *   - the deployment cannot mail anyone but its own operator, so a send would
 *     come back 403 and only fill the log;
 *   - the settings read failed.
 *
 * Deliberately the first thing every notifier does, and deliberately cheap:
 * readSettingRows() is memoised for the request, so with notifications off the
 * whole feature costs one small query that another part of the same request has
 * usually already paid for.
 */
async function notifyTarget(
  admin: Admin,
  event: AdminEvent,
): Promise<{ to: string; brand: string } | null> {
  const settings = await loadSettings(admin);

  const to = settings.adminNotifyEmail.trim();
  if (!to) return null;

  const wanted =
    event === "signup"
      ? settings.adminNotifySignup
      : event === "plan"
        ? settings.adminNotifyPlan
        : settings.adminNotifyTopup;
  if (!wanted) return null;

  /*
   * Resend's sandbox sender only delivers to the address that owns the Resend
   * account, so on a deployment still using it every one of these would be a
   * 403 and a log line. Checked here rather than discovered later, because a
   * silently-missing notification is exactly what an operator concludes was
   * never built - and the Health panel on /admin/settings already names this
   * problem in words, a tab away from this address.
   */
  if (!canEmailCustomers()) return null;

  return { to, brand: settings.brandName };
}

/** The account, in the admin console. One tap from the mail to the customer. */
function accountUrl(userId: string): string {
  return `${env.siteUrl}/admin/officers/${userId}`;
}

/**
 * Labelled lines, for a mail that is a list of facts rather than prose.
 *
 * Read on a phone, in a notification shade, by somebody who wants to know what
 * arrived and from whom without opening anything else. So: short labels, the
 * value in bold, nothing to skim. A blank value drops its whole line rather
 * than printing "Note: --", which is how the optional facts disappear.
 */
function facts(rows: [string, string][]): string[] {
  return rows
    .filter(([, value]) => value !== "")
    .map(
      ([label, value]) =>
        `<span style="color:#5b6b7b">${esc(label)}:</span> <strong>${value}</strong>`,
    );
}

/** A phone an admin can ring straight from the mail. Blank when we hold none. */
function telLink(phone: string | null | undefined): string {
  if (!phone) return "";
  return `<a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}" style="color:#1d4ed8">${esc(phone)}</a>`;
}

/* -------------------------------------------------------------------------- */

/**
 * A new customer registered.
 *
 * Never throws and never reports a failure back: the account already exists by
 * the time this runs, and somebody who has just registered must not be shown an
 * error - let alone have the registration fail - because a notification could
 * not be sent. Every reason it did not send is a log line.
 */
export async function notifyAdminOfSignup(
  admin: Admin,
  customer: {
    userId: string;
    name: string | null;
    email: string;
    phone: string | null;
    /** The free tier, when one was granted. 0 leaves the line out. */
    freeCredits?: number;
    /** True when they arrived through somebody's invite link. */
    referred?: boolean;
  },
): Promise<void> {
  try {
    const target = await notifyTarget(admin, "signup");
    if (!target) return;

    const named = customer.name?.trim() ?? "";
    const who = named || customer.email;
    const url = accountUrl(customer.userId);
    const free =
      customer.freeCredits && customer.freeCredits > 0
        ? formatCredits(customer.freeCredits)
        : "";

    const sent = await sendEmail({
      to: target.to,
      subject: `New ${target.brand} customer: ${who}`,
      html: shell(
        target.brand,
        "A new customer signed up",
        [
          ...facts([
            ["Name", esc(named || "not given")],
            ["Email", esc(customer.email)],
            ["Mobile", telLink(customer.phone) || "not given"],
            ["Free credits", free],
            ["Invited by", customer.referred ? "someone's referral link" : ""],
          ]),
          "They have no plan yet, so nothing is being tracked for them until they buy one.",
        ],
        { label: "Open the account", url },
      ),
      text:
        `A new ${target.brand} customer signed up.\n\n` +
        `Name: ${named || "not given"}\n` +
        `Email: ${customer.email}\n` +
        `Mobile: ${customer.phone ?? "not given"}\n` +
        (free ? `Free credits: ${free}\n` : "") +
        (customer.referred ? "Invited by: someone's referral link\n" : "") +
        "\nThey have no plan yet, so nothing is being tracked for them until they buy one.\n\n" +
        url,
    });

    if (!sent.ok) console.error("admin notify (signup) not sent:", sent.error);
  } catch (error) {
    // The catch IS this function's contract. A settings read that times out
    // must not reach the caller, because the caller is a sign-up that has
    // already created the account.
    console.error("admin notify (signup) crashed:", error);
  }
}

/**
 * Money arrived, and what it bought has been handed over.
 *
 * CALLED ON THE SETTLEMENT, NOT ON THE DOOR. Three code paths settle a payment
 * - the Razorpay webhook, the browser handshake in checkout-actions.ts, and
 * record_offline_payment() from the finance console - and every one of them
 * goes through settle_payment(), which moves the row from 'created' to 'paid'
 * in a single UPDATE and so answers granted:true to exactly one caller. Every
 * call site therefore does the same one thing: notify only when it was handed
 * granted:true.
 *
 * That is what makes a double send impossible without a flag or a lock to get
 * wrong: the database's own once-only transition IS the deduplication. The
 * webhook and the browser race on every online payment, and the loser is told
 * granted:false and sends nothing. It is equally what makes a miss impossible,
 * because whichever of the two wins that race is the one that notifies.
 *
 * Takes only the payment id and reads the rest itself, so a call site is one
 * line and cannot get its contents subtly different from the next call site's.
 *
 * AWAITED by all three callers rather than left detached. On a serverless
 * platform work that outlives the response is killed mid-flight, so
 * fire-and-forget would mean a notification that arrives from a warm instance
 * and silently does not from a cold one. It costs a customer up to a second on
 * the confirmation screen; with notifications off it costs one memoised query.
 */
export async function notifyAdminOfPayment(admin: Admin, paymentId: string): Promise<void> {
  try {
    const { data: payment } = await admin
      .from("payments")
      .select(
        "user_id, kind, amount_inr, discount_inr, credits, topup_credits, method, plan_id, recorded_by, note",
      )
      .eq("id", paymentId)
      .maybeSingle<{
        user_id: string;
        kind: string;
        amount_inr: number;
        discount_inr: number;
        credits: number;
        topup_credits: number;
        method: string;
        plan_id: string | null;
        recorded_by: string | null;
        note: string | null;
      }>();

    if (!payment) {
      console.error(`admin notify (payment): no payment row for ${paymentId}`);
      return;
    }

    /*
     * A plan sale and a plan-plus-credits sale are both the "plan" event; a
     * bare top-up is the "topup" one. Read off the row rather than passed in,
     * so which switch applies is decided by what was actually bought and not by
     * which call site noticed.
     */
    const isPlan = payment.kind === "plan";
    const target = await notifyTarget(admin, isPlan ? "plan" : "topup");
    if (!target) return;

    /* The buyer and - on a hand-entered receipt - the administrator who typed
       it, in one read. Two selects against two rows of the same table would be
       a second trans-Pacific round trip for a notification. */
    const ids = [payment.user_id, ...(payment.recorded_by ? [payment.recorded_by] : [])];
    const { data: people } = await admin
      .from("profiles")
      .select("id, full_name, email, phone, credits, plan_expires_on")
      .in("id", ids);

    const rows = (people ?? []) as {
      id: string;
      full_name: string | null;
      email: string;
      phone: string | null;
      credits: number;
      plan_expires_on: string | null;
    }[];

    const buyer = rows.find((row) => row.id === payment.user_id) ?? null;
    const recorder = payment.recorded_by
      ? (rows.find((row) => row.id === payment.recorded_by) ?? null)
      : null;

    let planName = "";
    if (isPlan && payment.plan_id) {
      const { data: plan } = await admin
        .from("plans")
        .select("name")
        .eq("id", payment.plan_id)
        .maybeSingle<{ name: string }>();
      planName = plan?.name ?? "";
    }

    const who = buyer?.full_name?.trim() || buyer?.email || "a customer";
    const amount = fmtRupees(Number(payment.amount_inr));
    const discount = Number(payment.discount_inr) || 0;
    const topup = Number(payment.topup_credits) || 0;
    const credits = Number(payment.credits) || 0;

    /* What the money bought, in one phrase, because the subject line is the
       whole message on a locked phone - so it carries the figure and the name
       rather than the word "payment". */
    const bought = isPlan
      ? `${planName || "a plan"}${topup > 0 ? ` + ${formatCredits(topup)} credits` : ""}`
      : `${formatCredits(credits)} credits`;

    /* An offline receipt says so, and says who typed it. Without that an owner
       cannot tell a self-service purchase from a colleague writing down cash
       that crossed a desk - which is most of what makes these worth reading
       rather than just counting. */
    const arrivalText =
      payment.method === "razorpay"
        ? "Paid online through Razorpay"
        : `Recorded by hand as ${methodLabel(payment.method).toLowerCase()}${
            recorder ? ` by ${recorder.full_name?.trim() || recorder.email}` : ""
          }`;

    const url = accountUrl(payment.user_id);
    const paidLine = amount + (discount > 0 ? ` (${fmtRupees(discount)} off with a code)` : "");
    const expiry = isPlan && buyer?.plan_expires_on ? fmtDate(buyer.plan_expires_on) : "";
    const balance = buyer ? formatCredits(Number(buyer.credits)) : "";

    const sent = await sendEmail({
      to: target.to,
      subject: `${amount} · ${bought} · ${who}`,
      html: shell(
        target.brand,
        isPlan ? "A plan was bought" : "Credits were topped up",
        [
          ...facts([
            ["Customer", esc(buyer?.full_name?.trim() || "not given")],
            ["Email", esc(buyer?.email)],
            ["Mobile", telLink(buyer?.phone) || "not given"],
            ["Paid", esc(paidLine)],
            [isPlan ? "Plan" : "Bought", esc(bought)],
            ["Plan runs until", esc(expiry)],
            ["Their balance now", esc(balance)],
            ["Note", esc(payment.note ?? "")],
          ]),
          `${esc(arrivalText)}.`,
        ],
        { label: "Open the account", url },
      ),
      text:
        `${isPlan ? "A plan was bought" : "Credits were topped up"} on ${target.brand}.\n\n` +
        `Customer: ${buyer?.full_name?.trim() || "not given"}\n` +
        `Email: ${buyer?.email ?? "unknown"}\n` +
        `Mobile: ${buyer?.phone ?? "not given"}\n` +
        `Paid: ${paidLine}\n` +
        `${isPlan ? "Plan" : "Bought"}: ${bought}\n` +
        (expiry ? `Plan runs until: ${expiry}\n` : "") +
        (balance ? `Their balance now: ${balance}\n` : "") +
        (payment.note ? `Note: ${payment.note}\n` : "") +
        `\n${arrivalText}.\n\n${url}`,
    });

    if (!sent.ok) console.error("admin notify (payment) not sent:", sent.error);
  } catch (error) {
    /*
     * The non-negotiable one. Everything above runs AFTER settle_payment() has
     * assigned the plan and written the credits, so a throw escaping here would
     * turn a finished purchase into an error on the customer's screen - or, in
     * the webhook, into a 500 that makes Razorpay retry a settlement that has
     * already happened.
     */
    console.error("admin notify (payment) crashed:", error);
  }
}
