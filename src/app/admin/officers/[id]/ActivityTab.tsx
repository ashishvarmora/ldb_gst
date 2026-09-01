import { Bell, Coins, Search } from "lucide-react";

import type { AccountParams } from "./TabStrip";
import { loadDailyCalls } from "../../usage/ledger";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import { LinkCard, Panel } from "@/components/ui";
import { fmtNumber } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * What this account has been doing.
 *
 * It used to hold a filtered search-log table with its own source and outcome
 * dropdowns and its own pager, plus a preview of the newest alerts - a third
 * implementation of two lists that already had homes. The filters here and the
 * filters on the delivery log did the same job and neither knew about the
 * other, so an answer found on one screen had to be found again on the other.
 *
 * What is left is the part only this page can give: the shape of a month, for
 * one account. The lists themselves are one tap away, already filtered to this
 * account, on the screen that owns them - and every count below is read at the
 * same moment so the number on the card and the list behind it agree.
 */
export async function ActivityTab({ id, params }: { id: string; params: AccountParams }) {
  const admin = getSupabaseAdmin();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [dailyCalls, searches, manual, alerts, undelivered, credits] = await Promise.all([
    loadDailyCalls(admin, { days: 30, userId: id }),
    admin
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .gte("created_at", monthAgo),
    admin
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .eq("source", "manual")
      .gte("created_at", monthAgo),
    admin
      .from("alert_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .gte("created_at", monthAgo),
    admin
      .from("alert_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .eq("delivered", false)
      .gte("created_at", monthAgo),
    admin
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .gte("created_at", monthAgo),
  ]);

  const series = buildUsageSeries(dailyCalls, 30);
  const totalCalls = searches.count ?? 0;
  const manualCalls = manual.count ?? 0;
  const logs = `/admin/logs?officer=${id}`;

  return (
    <div className="space-y-5">
      <Panel
        title="Usage, last 30 days"
        description="Lookups per day for this account — manual searches and background checks together."
      >
        <UsageChart series={series} />
      </Panel>

      {/* Three ways in, each already narrowed to this account. The counts are
          what make a link worth following rather than a guess. */}
      <div className="space-y-2">
        <LinkCard
          href={`${logs}&type=searches`}
          icon={<Search size={16} />}
          title="Searches and background checks"
          description={
            totalCalls === 0
              ? "Nothing in the last 30 days."
              : `${fmtNumber(manualCalls)} manual, ${fmtNumber(totalCalls - manualCalls)} automatic. Filter by truck or day.`
          }
          value={fmtNumber(totalCalls)}
        />

        <LinkCard
          href={`${logs}&type=alerts${(undelivered.count ?? 0) > 0 ? "&status=failed" : ""}`}
          icon={<Bell size={16} />}
          title="Alerts sent"
          description={
            (undelivered.count ?? 0) > 0
              ? `${fmtNumber(undelivered.count ?? 0)} could not be delivered — opens filtered to those.`
              : "Everything sent in the last 30 days was delivered."
          }
          value={fmtNumber(alerts.count ?? 0)}
          tone={(undelivered.count ?? 0) > 0 ? "warn" : "neutral"}
        />

        <LinkCard
          href={`/admin/officers/${id}?tab=credits`}
          icon={<Coins size={16} />}
          title="Credits and activity"
          description="Per truck per day, per day, or charge by charge — the same ledger the customer sees."
          value={fmtNumber(credits.count ?? 0)}
        />
      </div>
    </div>
  );
}
