import { CREDIT_ACTIONS, costOf, formatCredits, spendCredits } from "@/lib/credits";
import { loadSettings } from "@/lib/settings";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * WHATSAPP COSTS CREDITS (owner, 24 Nov 2026; 0076).
 *
 * Every WhatsApp message sent to a customer - truck alerts and the notices that
 * go on WhatsApp - draws the 'whatsapp_alert' credit rate from their balance
 * (default 0.2 credit). The admin switches it on and off in Admin -> Settings
 * (whatsapp_charge_enabled) and sets the amount on the rate itself.
 * Free: the admin daily summary, the customer's own "Send test", and the
 * "no credits left" notice (the one message an empty balance cannot pay for).
 *
 * HOW IT IS CHARGED - never for an unsent message, never twice:
 *   1. before sending: is charging on, and does the AVAILABLE balance
 *      (credits minus held credits, as spend_credits sees it) cover one
 *      message? If not, WhatsApp is skipped for that alert (push and Telegram
 *      still go) and the skip is logged;
 *   2. send;
 *   3. only if Meta accepted it: spend_credits('whatsapp_alert') - one
 *      ledger row per accepted message. A failed send writes nothing, so
 *      there is no refund to make.
 * If the balance drops between 1 and 3 (another check spent it), spend_credits
 * refuses and that one message goes free. That is the only gap and it errs in
 * the customer's favour.
 */

/** Credits one message costs right now, or null when nothing is charged. */
export async function whatsappMessageCost(admin: Admin): Promise<number | null> {
  try {
    const settings = await loadSettings(admin);
    if (!settings.whatsappChargeEnabled) return null;
    const { data, error } = await admin
      .from("credit_rates")
      .select("units_per_credit")
      .eq("action", CREDIT_ACTIONS.whatsappAlert)
      .maybeSingle<{ units_per_credit: number }>();
    // No rate row (0076 not applied) or unreadable: send free, as before.
    if (error || !data) return null;
    const units = Number(data.units_per_credit);
    if (!(units > 0)) return null;
    const cost = costOf(units);
    return cost > 0 ? cost : null;
  } catch {
    return null;
  }
}

/** "Each WhatsApp alert uses 0.2 credit." */
export function whatsappCostLine(cost: number): string {
  return `Each WhatsApp alert uses ${formatCredits(cost)} credit${cost === 1 ? "" : "s"}.`;
}

/**
 * Step 1: can this account pay for one message? Reads the same available
 * balance spend_credits() uses (credits minus active holds). Errs towards
 * sending when the balance cannot be read - step 3 still refuses an
 * overdraft, so the worst case is one free message.
 */
export async function canPayForWhatsApp(
  admin: Admin,
  userId: string,
  cost: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const [{ data: profile, error }, held] = await Promise.all([
      admin.from("profiles").select("credits, status").eq("id", userId).maybeSingle<{ credits: number; status: string }>(),
      admin.rpc("credits_held", { p_user: userId }),
    ]);
    if (error || !profile) return { ok: true };
    if (profile.status !== "active") return { ok: false, reason: "Account is not active" };
    const available = (Number(profile.credits) || 0) - (held.error ? 0 : Number(held.data) || 0);
    if (available < cost) {
      return {
        ok: false,
        reason: `Not enough credits for WhatsApp (needs ${formatCredits(cost)}, balance ${formatCredits(Math.max(available, 0))})`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Step 3: Meta accepted the message - charge it. Never throws. */
export async function chargeSentWhatsApp(admin: Admin, userId: string, truckNumber: string | null): Promise<void> {
  try {
    const verdict = await spendCredits({
      admin,
      userId,
      action: CREDIT_ACTIONS.whatsappAlert,
      truckNumber,
    });
    if (!verdict.allowed) {
      // Sent, but not charged (balance spent meanwhile, or no rate row): free.
      console.warn(`[whatsapp] sent but not charged for ${userId}: ${verdict.reason ?? "refused"}`);
    }
  } catch (error) {
    console.error("[whatsapp] charge failed:", (error as Error).message);
  }
}
