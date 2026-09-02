import type { UsageDayRow } from "@/components/UsageChart";
import { loadCreditSeries, shiftDate } from "@/lib/analytics";
import { istToday } from "@/lib/format";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Daily call counts, read from the credit ledger.
 *
 * The daily tally table is gone: it recorded the same events as
 * credit_transactions and could disagree with the money. Every chargeable call
 * is a ledger row with a timestamp, so the same chart is built by counting
 * those rows per day instead.
 *
 * The counting itself happens in the database now, through
 * admin_credit_series(). It used to happen here: twenty pages of a thousand
 * ledger rows were walked over PostgREST and folded in JavaScript, which capped
 * silently at twenty thousand rows and said nothing when it bit - so past
 * roughly 650 charged calls a day the chart quietly under-reported against the
 * total printed beside it, for ever. The database has no such ceiling, and it
 * applies the same role filter as every other figure on the console, so an
 * administrator's own test searches no longer land in a chart of customer
 * usage while being left out of the count above it.
 */

/**
 * Every charged call in the last `days` days, one row per day. Pass `userId`
 * for a single account, leave it out for the whole platform.
 */
export async function loadDailyCalls(
  admin: Admin,
  { days = 30, userId }: { days?: number; userId?: string } = {},
): Promise<UsageDayRow[]> {
  const to = istToday();
  const from = shiftDate(to, -(days - 1));

  const rows = await loadCreditSeries(admin, { from, to, bucket: "day" }, userId);
  const byDate = new Map<string, UsageDayRow>();

  for (const row of rows) {
    if (row.reason !== "manual_search" && row.reason !== "auto_check") continue;

    let day = byDate.get(row.bucket);
    if (!day) {
      day = { usage_date: row.bucket, manual_searches: 0, tracking_queries: 0 };
      byDate.set(row.bucket, day);
    }
    // entries, not credits: one row is one call whatever the rate charges for
    // it, and a chart of calls must not move when a price does.
    if (row.reason === "manual_search") day.manual_searches += Number(row.entries) || 0;
    else day.tracking_queries += Number(row.entries) || 0;
  }

  return [...byDate.values()];
}
