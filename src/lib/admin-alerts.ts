import { adminRecipients } from "@/lib/chat";
import { formatCredits } from "@/lib/credits";
import { sendPushToUser, type PushPayload } from "@/lib/push";
import { loadSettings } from "@/lib/settings";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Phone notifications about the business, for the admins and for the buyer.
 *
 * The email notifications in email.ts go to ONE internal address and only when
 * mail can leave this deployment. These go to every active super admin's own
 * phones - whatever they switched on under Settings -> Notifications on this
 * phone, in a browser or in the Android app - and need nothing but the push
 * keys. Each event has its own switch on /admin/settings (adminPush* in
 * app_settings), absent meaning on.
 *
 * Same contract as every notifier here: never throws, never reports a failure
 * back, and is awaited by its caller - a serverless function kills work that
 * outlives the response, so a detached send is one that silently does not
 * happen on a cold instance.
 */

export type AdminPushEvent =
  | "signup"
  | "payment_started"
  | "payment_success"
  | "payment_failed"
  | "chat";

async function wanted(admin: Admin, event: AdminPushEvent): Promise<boolean> {
  const settings = await loadSettings(admin);
  switch (event) {
    case "signup":
      return settings.adminPushSignup;
    case "payment_started":
      return settings.adminPushPaymentStarted;
    case "payment_success":
      return settings.adminPushPayment;
    case "payment_failed":
      return settings.adminPushPaymentFailed;
    case "chat":
      return settings.adminPushChat;
  }
}

/** One notification to every admin's devices, if this event is switched on. */
export async function pushAdmins(
  admin: Admin,
  event: AdminPushEvent,
  payload: PushPayload,
): Promise<void> {
  try {
    if (!(await wanted(admin, event))) return;
    const desk = await adminRecipients(admin);
    await Promise.allSettled(desk.map((id) => sendPushToUser(id, payload)));
  } catch (error) {
    console.error(`[admin-push] ${event} crashed:`, (error as Error).message);
  }
}

function rupees(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

type PaymentFacts = {
  user_id: string;
  kind: string;
  status: string;
  amount_inr: number;
  credits: number;
  topup_credits: number;
  failure_reason: string | null;
  plan_id: string | null;
  who: string;
  bought: string;
};

/** The payment, its buyer's name and what it bought, in one phrase each. */
async function paymentFacts(
  admin: Admin,
  where: { id: string } | { orderId: string },
): Promise<PaymentFacts | null> {
  let query = admin
    .from("payments")
    .select("user_id, kind, status, amount_inr, credits, topup_credits, failure_reason, plan_id");
  query = "id" in where ? query.eq("id", where.id) : query.eq("razorpay_order_id", where.orderId);
  const { data: payment } = await query.maybeSingle<Omit<PaymentFacts, "who" | "bought">>();
  if (!payment) return null;

  const [{ data: buyer }, { data: plan }] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", payment.user_id)
      .maybeSingle<{ full_name: string | null; email: string }>(),
    payment.plan_id
      ? admin.from("plans").select("name").eq("id", payment.plan_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);

  const topup = Number(payment.topup_credits) || 0;
  const bought =
    payment.kind === "plan"
      ? `${plan?.name ?? "a plan"}${topup > 0 ? ` + ${formatCredits(topup)} credits` : ""}`
      : `${formatCredits(Number(payment.credits) || 0)} credits`;

  return {
    ...payment,
    who: buyer?.full_name?.trim() || buyer?.email || "A customer",
    bought,
  };
}

/** A checkout window was opened. A lead, not money. */
export async function notifyPaymentStarted(admin: Admin, paymentId: string): Promise<void> {
  try {
    const facts = await paymentFacts(admin, { id: paymentId });
    if (!facts) return;
    await pushAdmins(admin, "payment_started", {
      title: `${facts.who} is paying`,
      body: `${facts.bought} · ${rupees(facts.amount_inr)}. Checkout opened.`,
      tag: `pay-${paymentId}`,
      url: `/admin/officers/${facts.user_id}`,
    });
  } catch (error) {
    console.error("[admin-push] payment started crashed:", (error as Error).message);
  }
}

/**
 * Money arrived and was handed over. Called from notifyAdminOfPayment, which
 * every settlement path already calls exactly once - see the note there - so
 * this inherits its once-only guarantee.
 *
 * The buyer is told too: on a phone that has left the checkout screen, this is
 * the only sign the payment went through.
 */
export async function notifyPaymentSettled(admin: Admin, paymentId: string): Promise<void> {
  try {
    const facts = await paymentFacts(admin, { id: paymentId });
    if (!facts) return;

    await Promise.allSettled([
      pushAdmins(admin, "payment_success", {
        title: `Paid: ${rupees(facts.amount_inr)} from ${facts.who}`,
        body: facts.kind === "plan" ? `Plan bought — ${facts.bought}` : `Top-up — ${facts.bought}`,
        tag: `pay-${paymentId}`,
        url: `/admin/officers/${facts.user_id}`,
      }),
      sendPushToUser(facts.user_id, {
        title: "Payment received",
        body:
          facts.kind === "plan"
            ? `${facts.bought} is active. Thank you!`
            : `${facts.bought} added to your balance.`,
        tag: `pay-${paymentId}`,
        url: "/portal/payments",
      }),
    ]);
  } catch (error) {
    console.error("[admin-push] payment settled crashed:", (error as Error).message);
  }
}

/**
 * A payment was closed as failed. Only call when THIS caller closed the row
 * (the update returned it), so a replayed event cannot notify twice.
 *
 * `tellBuyer` is for the webhook: the buyer may have left. The browser path
 * leaves it off, because the buyer is looking at the failure already.
 */
export async function notifyPaymentFailed(
  admin: Admin,
  paymentId: string,
  { tellBuyer }: { tellBuyer: boolean },
): Promise<void> {
  try {
    const facts = await paymentFacts(admin, { id: paymentId });
    if (!facts) return;
    const reason = facts.failure_reason?.slice(0, 140) || "Payment failed.";

    await Promise.allSettled([
      pushAdmins(admin, "payment_failed", {
        title: `Payment failed: ${facts.who}`,
        body: `${facts.bought} · ${rupees(facts.amount_inr)}. ${reason}`,
        tag: `pay-${paymentId}`,
        url: `/admin/officers/${facts.user_id}`,
      }),
      tellBuyer
        ? sendPushToUser(facts.user_id, {
            title: "Payment did not go through",
            body: `${facts.bought}: ${reason} You can try again.`,
            tag: `pay-${paymentId}`,
            url: "/portal/plan",
          })
        : Promise.resolve(),
    ]);
  } catch (error) {
    console.error("[admin-push] payment failed crashed:", (error as Error).message);
  }
}
