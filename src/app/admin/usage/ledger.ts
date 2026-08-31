import type { UsageDayRow } from "@/components/UsageChart";
import { istDaysAgo } from "@/lib/format";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Daily call counts, read from the credit ledger.
 *
 * The daily tally table is gone: it recorded the same events as
 * credit_transactions and could disagree with the money. Every chargeable call
 * is a ledger row with a timestamp, so the same chart is built by counting
 * those rows per day instead.
 */

/** The ledger reasons that are an LDB call. Top-ups and purchases are not. */
const CALL_REASONS = ["manual_search", "auto_check"] as const;

/** PostgREST caps one select at the project's max-rows, so pages are keyset-walked. */
const PAGE = 1000;
const MAX_PAGES = 20;

type LedgerCall = { id: number; reason: string; created_at: string };

/**
 * Fold ledger rows into one row per IST day, in the shape the chart wants.
 * Days with no calls are left out - the chart fills those in itself.
 */
export function foldDailyCalls(rows: LedgerCall[]): UsageDayRow[] {
  const byDate = new Map<string, UsageDayRow>();

  for (const row of rows) {
    const date = new Date(row.created_at).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    let day = byDate.get(date);
    if (!day) {
      day = { usage_date: date, manual_searches: 0, tracking_queries: 0 };
      byDate.set(date, day);
    }
    if (row.reason === "manual_search") day.manual_searches += 1;
    else day.tracking_queries += 1;
  }

  return [...byDate.values()];
}

/**
 * Every charged call in the last `days` days, one row per day. Pass `userId`
 * for a single account, leave it out for the whole platform.
 */
export async function loadDailyCalls(
  admin: Admin,
  { days = 30, userId }: { days?: number; userId?: string } = {},
): Promise<UsageDayRow[]> {
  // A day of margin: the window is counted in IST days but cut in UTC, and the
  // extra rows fall outside the chart's range anyway.
  const since = `${istDaysAgo(days)}T00:00:00Z`;
  const rows: LedgerCall[] = [];
  let after = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = admin
      .from("credit_transactions")
      .select("id, reason, created_at")
      .in("reason", [...CALL_REASONS])
      .gte("created_at", since)
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(PAGE);

    if (userId) query = query.eq("user_id", userId);

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    const batch = data as LedgerCall[];
    rows.push(...batch);
    after = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }

  return foldDailyCalls(rows);
}
