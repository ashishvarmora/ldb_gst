import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Razorpay, kept to the two things this app actually does: open an order, and
 * prove that a payment really happened.
 *
 * No SDK. The REST calls are two fetches, and pulling in a package to make
 * them would add a dependency that also wants to run in the browser.
 *
 * The security rule throughout: nothing the browser sends is trusted. The
 * browser can claim a payment succeeded, so credits are only ever granted
 * after a signature computed with the key secret matches - and the secret
 * never leaves the server.
 */

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15_000;

export type RazorpayResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

function authHeader(): string {
  const pair = `${env.razorpayKeyId}:${env.razorpayKeySecret}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

/** True when both halves of the key pair are present. */
export function razorpayConfigured(): boolean {
  return Boolean(env.razorpayKeyId && env.razorpayKeySecret);
}

/**
 * Opens an order. `amountInr` is in rupees; Razorpay works in paise, so the
 * conversion happens here rather than at every call site.
 */
export async function createOrder({
  amountInr,
  receipt,
  notes,
}: {
  amountInr: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayResult<RazorpayOrder>> {
  if (!razorpayConfigured()) {
    return { ok: false, error: "Online payment is not configured yet." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader() },
      body: JSON.stringify({
        amount: Math.round(amountInr * 100),
        currency: "INR",
        receipt,
        notes: notes ?? {},
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as
      | (RazorpayOrder & { error?: { description?: string } })
      | null;

    if (!response.ok || !body?.id) {
      return {
        ok: false,
        error: body?.error?.description ?? `Razorpay refused the order (HTTP ${response.status}).`,
      };
    }

    return { ok: true, data: body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Razorpay did not respond in time." : (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The captured payment on an order, asked of Razorpay directly.
 *
 * For the cases where nobody told us: the browser reported a failed attempt,
 * the buyer then paid on the same order (or the UPI app answered late), and
 * the webhook for the capture never arrived or arrived before 0060. Razorpay's
 * own answer over an authenticated call is as good as a signed webhook, so the
 * id this returns may be passed straight to settle_payment().
 *
 * ok with null data means "asked, and nothing was captured".
 */
export async function capturedPaymentFor(orderId: string): Promise<RazorpayResult<string | null>> {
  if (!razorpayConfigured()) {
    return { ok: false, error: "Online payment is not configured yet." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API}/orders/${encodeURIComponent(orderId)}/payments`, {
      headers: { Authorization: authHeader() },
      signal: controller.signal,
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as
      | { items?: { id: string; status: string }[]; error?: { description?: string } }
      | null;

    if (!response.ok || !body?.items) {
      return {
        ok: false,
        error: body?.error?.description ?? `Razorpay would not list the order (HTTP ${response.status}).`,
      };
    }

    const captured = body.items.find((payment) => payment.status === "captured");
    return { ok: true, data: captured?.id ?? null };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Razorpay did not respond in time." : (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Constant-time compare, so a wrong signature cannot be found byte by byte. */
function sameSignature(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verifies the handshake the browser hands back after checkout.
 *
 * Razorpay signs `order_id|payment_id` with the key secret. Only someone
 * holding the secret can produce it, which is what makes a browser-reported
 * success trustworthy enough to act on.
 */
export function verifyCheckoutSignature({
  orderId,
  paymentId,
  signature,
}: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!env.razorpayKeySecret || !signature) return false;
  const expected = createHmac("sha256", env.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return sameSignature(expected, signature);
}

/**
 * Verifies a webhook body against the webhook secret.
 *
 * This is the authority on whether money arrived: the browser handshake can be
 * lost if the officer closes the tab, but the webhook is retried by Razorpay
 * until it is acknowledged.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!env.razorpayWebhookSecret || !signature) return false;
  const expected = createHmac("sha256", env.razorpayWebhookSecret)
    .update(rawBody)
    .digest("hex");
  return sameSignature(expected, signature);
}
