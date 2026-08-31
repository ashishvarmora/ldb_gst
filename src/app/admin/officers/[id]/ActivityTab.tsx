import Link from "next/link";
import { Filter } from "lucide-react";

import type { AccountParams } from "./TabStrip";
import { loadDailyCalls } from "../../usage/ledger";
import { Select } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import { Badge, EmptyState, Mono, Panel, buttonClass } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, SearchLog } from "@/lib/types";

const SEARCHES_PER_PAGE = 20;
const ALERTS_PER_PAGE = 20;

/**
 * What the account actually did: the shape of it over a month, then the two
 * logs behind that shape. Both logs are filtered by outcome rather than only
 * paged, because the question is almost always "what failed" rather than "what
 * happened at 3pm on Tuesday".
 */
export async function ActivityTab({ id, params }: { id: string; params: AccountParams }) {
  const admin = getSupabaseAdmin();

  const source = params.source === "manual" || params.source === "tracking" ? params.source : null;
  const outcome = params.outcome === "ok" || params.outcome === "failed" ? params.outcome : null;
  const delivery =
    params.delivery === "sent" || params.delivery === "failed" || params.delivery === "unread"
      ? params.delivery
      : null;

  const searchPage = pageFromParam(params.spage);
  const alertPage = pageFromParam(params.apage);

  let searchQuery = admin
    .from("search_logs")
    .select("*", { count: "exact" })
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .range((searchPage - 1) * SEARCHES_PER_PAGE, searchPage * SEARCHES_PER_PAGE - 1);
  if (source) searchQuery = searchQuery.eq("source", source);
  if (outcome) searchQuery = searchQuery.eq("ok", outcome === "ok");

  let alertQuery = admin
    .from("alert_logs")
    .select("*", { count: "exact" })
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .range((alertPage - 1) * ALERTS_PER_PAGE, alertPage * ALERTS_PER_PAGE - 1);
  if (delivery === "sent") alertQuery = alertQuery.eq("delivered", true);
  if (delivery === "failed") alertQuery = alertQuery.eq("delivered", false);
  if (delivery === "unread") alertQuery = alertQuery.is("read_at", null);

  const [dailyCalls, { data: searches, count: searchCount }, { data: alerts, count: alertCount }] =
    await Promise.all([
      loadDailyCalls(admin, { days: 30, userId: id }),
      searchQuery,
      alertQuery,
    ]);

  const searchRows = (searches ?? []) as SearchLog[];
  const alertRows = (alerts ?? []) as AlertLog[];
  const series = buildUsageSeries(dailyCalls, 30);

  const base = `/admin/officers/${id}`;

  return (
    <div className="space-y-5">
      <Panel
        title="Usage, last 30 days"
        description="Manual searches and background checks per day, counted from the credit ledger."
      >
        <UsageChart series={series} />
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Searches"
          description="Manual lookups, and background checks that found something or failed."
          bodyClassName="p-0"
        >
          <form
            method="get"
            className="flex flex-wrap items-center gap-2 border-b border-divider px-5 py-3"
          >
            <input type="hidden" name="tab" value="activity" />
            <input type="hidden" name="delivery" value={delivery ?? ""} />
            <Select name="source" defaultValue={source ?? ""} className="w-32 py-1.5 text-xs">
              <option value="">Any kind</option>
              <option value="manual">Manual</option>
              <option value="tracking">Automatic</option>
            </Select>
            <Select name="outcome" defaultValue={outcome ?? ""} className="w-32 py-1.5 text-xs">
              <option value="">Any outcome</option>
              <option value="ok">Worked</option>
              <option value="failed">Failed</option>
            </Select>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              <Filter size={13} />
              Apply
            </button>
          </form>

          {searchRows.length === 0 ? (
            <EmptyState title={source || outcome ? "Nothing matches those filters" : "No calls yet"} />
          ) : (
            <>
              <ul className="divide-y divide-divider">
                {searchRows.map((log) => (
                  <li key={log.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0">
                      <Link
                        href={`/admin/explore?q=${log.truck_number}`}
                        className="transition hover:text-brand-500"
                      >
                        <Mono className="text-ink">{log.truck_number}</Mono>
                      </Link>
                      <span className="block text-xs text-faint">{fmtDateTime(log.created_at)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={log.source === "manual" ? "brand" : "neutral"}>
                        {log.source === "manual" ? "manual" : "automatic"}
                      </Badge>
                      <Badge tone={log.ok ? "good" : "bad"}>
                        {log.ok ? `${log.new_events} new` : (log.error ?? "failed").slice(0, 24)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>

              <Pager
                className="border-t border-divider px-5 py-3"
                page={searchPage}
                total={searchCount ?? searchRows.length}
                pageSize={SEARCHES_PER_PAGE}
                noun="calls"
                href={{
                  path: base,
                  params: { tab: "activity", source, outcome, delivery, apage: alertPage },
                  pageKey: "spage",
                }}
              />
            </>
          )}
        </Panel>

        <Panel
          title="Alerts"
          description="Everything this account was told about."
          bodyClassName="p-0"
          actions={
            <Link
              href={`/admin/alerts/log?officer=${id}`}
              className="text-xs text-brand-400 hover:underline"
            >
              Full log
            </Link>
          }
        >
          <form
            method="get"
            className="flex flex-wrap items-center gap-2 border-b border-divider px-5 py-3"
          >
            <input type="hidden" name="tab" value="activity" />
            <input type="hidden" name="source" value={source ?? ""} />
            <input type="hidden" name="outcome" value={outcome ?? ""} />
            <Select name="delivery" defaultValue={delivery ?? ""} className="w-40 py-1.5 text-xs">
              <option value="">All alerts</option>
              <option value="sent">Delivered</option>
              <option value="failed">Not delivered</option>
              <option value="unread">Unread</option>
            </Select>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              <Filter size={13} />
              Apply
            </button>
          </form>

          {alertRows.length === 0 ? (
            <EmptyState title={delivery ? "Nothing matches that filter" : "No alerts yet"} />
          ) : (
            <>
              <ul className="divide-y divide-divider">
                {alertRows.map((log) => (
                  <li key={log.id} className="px-5 py-2.5">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-ink">{log.title}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {log.read_at ? null : <Badge tone="brand">unread</Badge>}
                        <Badge tone={log.delivered ? "good" : "warn"}>
                          {log.delivered ? "sent" : "not sent"}
                        </Badge>
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-faint">
                      {log.truck_number ? `${log.truck_number} · ` : ""}
                      {fmtDateTime(log.created_at)}
                      {log.delivery_error ? ` · ${log.delivery_error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>

              <Pager
                className="border-t border-divider px-5 py-3"
                page={alertPage}
                total={alertCount ?? alertRows.length}
                pageSize={ALERTS_PER_PAGE}
                noun="alerts"
                href={{
                  path: base,
                  params: { tab: "activity", source, outcome, delivery, spage: searchPage },
                  pageKey: "apage",
                }}
              />
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
