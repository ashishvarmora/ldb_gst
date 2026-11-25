import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * LOW-CREDIT WARNING (owner, 25 Nov 2026). Free channels only: the bell, app
 * push and Telegram - never WhatsApp (it would spend the credits it warns
 * about) and never email.
 *
 * Rule: after a spend, warn once when the balance is above zero but below
 *   max(5 credits, what this account's automatic checks spent in the last 24 h)
 * i.e. "less than about a day of tracking left". Real usage rather than a
 * schedule worked out from alert intervals: it already reflects how many
 * trucks are live, how often they are due and the plan's checks-per-credit.
 * An empty balance is left to the existing "no credits left" notice, which
 * pauses tracking.
 *
 * Once: the warning's own alert_logs row (kind 'low_credits') is the stamp, so
 * no migration. It re-arms when a top-up after that row (a positive ledger
 * row) left the balance at or above the threshold.
 *
 * Never blocks a spend: noteSpend() returns at once and swallows every error.
 * Per instance, a user just checked is not checked again for a while, so a
 * low account's forty trucks do not each re-run the queries.
 */

const MIN_THRESHOLD = 5;
const THRESHOLD_TTL_MS = 60 * 60 * 1000;
const QUIET_MS = 15 * 60 * 1000;

const thresholds = new Map<string, { value: number; at: number }>();
const quietUntil = new Map<string, number>();
const inFlight = new Set<string>();

/** Fire-and-forget: call after a successful charge. `balance` = balance after it, when known. */
export function noteSpend(userId: string, balance?: number | null): void {
  if (!userId) return;
  const quiet = quietUntil.get(userId);
  if (quiet && quiet > Date.now()) return;
  const cached = thresholds.get(userId);
  if (cached && Date.now() - cached.at < THRESHOLD_TTL_MS && typeof balance === "number" && balance >= cached.value) {
    return;
  }
  if (inFlight.has(userId)) return;
  inFlight.add(userId);
  void check(userId, balance)
    .catch((error) => console.error("[low-credit] check failed:", (error as Error).message))
    .finally(() => inFlight.delete(userId));
}

async function threshold(userId: string): Promise<number> {
  const cached = thresholds.get(userId);
  if (cached && Date.now() - cached.at < THRESHOLD_TTL_MS) return cached.value;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await getSupabaseAdmin()
    .from("credit_transactions")
    .select("delta")
    .eq("user_id", userId)
    .eq("reason", "auto_check")
    .gte("created_at", since)
    .limit(5000);
  const day = ((data ?? []) as { delta: number }[]).reduce((sum, row) => sum - Number(row.delta || 0), 0);
  const value = Math.max(MIN_THRESHOLD, Math.ceil(day));
  thresholds.set(userId, { value, at: Date.now() });
  return value;
}

async function check(userId: string, known?: number | null): Promise<void> {
  const admin = getSupabaseAdmin();
  let balance = typeof known === "number" ? known : null;
  if (balance === null) {
    const { data } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle<{ credits: number }>();
    balance = Number(data?.credits ?? NaN);
  }
  if (!Number.isFinite(balance) || balance <= 0) return;

  const floor = await threshold(userId);
  if (balance >= floor) return;

  const { data: last } = await admin
    .from("alert_logs")
    .select("created_at")
    .eq("user_id", userId)
    .eq("kind", "low_credits")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();

  if (last) {
    const { count } = await admin
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("delta", 0)
      .gte("balance_after", floor)
      .gt("created_at", last.created_at);
    if (!count) {
      quietUntil.set(userId, Date.now() + QUIET_MS); // already warned, not re-armed
      return;
    }
  }

  quietUntil.set(userId, Date.now() + QUIET_MS);
  // Dynamic import: tracking.ts imports credits.ts, which calls this file.
  const { sendLowCreditNotice } = await import("@/lib/tracking");
  await sendLowCreditNotice(userId, balance, floor);
}

// Registered for credits.ts, which cannot import this server-only file (see there).
(globalThis as { __rahdariNoteSpend?: typeof noteSpend }).__rahdariNoteSpend = noteSpend;
