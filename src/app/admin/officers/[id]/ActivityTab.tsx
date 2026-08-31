import { Filter } from "lucide-react";

import type { AccountParams } from "./TabStrip";
import { loadDailyCalls } from "../../usage/ledger";
import { pageRange } from "../../pager";
import { SearchLogTable } from "../../tables";
import { Select } from "@/components/form";
import { Pager, ShowMore, pageFromParam } from "@/components/Pager";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import { Badge, EmptyState, Panel, PanelAction, buttonClass } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, SearchLog } from "@/lib/types";

const SEARCHES_PER_PAGE = 20;

/**
 * How many alerts are worth showing here. The delivery log owns the full,
 * filterable list for every account - this is a glance at the newest few with a
 * link into it, rather than a second copy of that page's filters and pager.
 */
const ALERTS_PREVIEW = 8;

/**
 * What the account actually did: the shape of it over a month, then the calls
 * behind that shape.
 *
 * The call table is the shared one from ../../tables, the same component the
 * platform-wide usage report renders - it just leaves out the customer column,
 * because the customer is the page title here.
 */
export async function ActivityTab({ id, params }: { id: string; params: AccountParams }) {
  const admin = getSupabaseAdmin();

  const source = params.source === "manual" || params.source === "tracking" ? params.source : null;
  const outcome = params.outcome === "ok" || params.outcome === "failed" ? params.outcome : null;

  const searchPage = pageFromParam(params.spage);
  const { from, to } = pageRange(searchPage, SEARCHES_PER_PAGE);

  let searchQuery = admin
    .from("search_logs")
    .select("*", { count: "exact" })
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (source) searchQuery = searchQuery.eq("source", source);
  if (outcome) searchQuery = searchQuery.eq("ok", outcome === "ok");

  const [dailyCalls, { data: searches, count: searchCount }, { data: alerts, count: alertCount }] =
    await Promise.all([
      loadDailyCalls(admin, { days: 30, userId: id }),
      searchQuery,
      admin
        .from("alert_logs")
        .select("*", { count: "exact" })
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(ALERTS_PREVIEW),
    ]);

  const searchRows = (searches ?? []) as SearchLog[];
  const alertRows = (alerts ?? []) as AlertLog[];
  const series = buildUsageSeries(dailyCalls, 30);
  const alertTotal = alertCount ?? alertRows.length;

  const base = `/admin/officers/${id}`;
  const fullAlertLog = `/admin/alerts/log?officer=${id}`;

  return (
    <div className="space-y-5">
      <Panel
        title="Usage, last 30 days"
        description="Manual searches and background checks per day, counted from the credit ledger."
      >
        <UsageChart series={series} />
      </Panel>

      <Panel
        title="Searches and background checks"
        description="Every call made for this account, newest first. Filtered by outcome rather than only paged, because the question is almost always what failed."
        bodyClassName="p-0"
      >
        <form
          method="get"
          className="flex flex-wrap items-center gap-2 border-b border-divider px-5 py-3"
        >
          <input type="hidden" name="tab" value="activity" />
          <Select name="source" defaultValue={source ?? ""} className="w-36 py-1.5 text-xs">
            <option value="">Any kind</option>
            <option value="manual">Manual</option>
            <option value="tracking">Automatic</option>
          </Select>
          <Select name="outcome" defaultValue={outcome ?? ""} className="w-36 py-1.5 text-xs">
            <option value="">Any outcome</option>
            <option value="ok">Worked</option>
            <option value="failed">Failed</option>
          </Select>
          <button type="submit" className={buttonClass("secondary", "sm")}>
            <Filter size={13} />
            Apply
          </button>
        </form>

        <SearchLogTable
          rows={searchRows}
          emptyTitle={
            (searchCount ?? 0) > 0
              ? "That page is past the end of the log"
              : source || outcome
                ? "Nothing matches those filters"
                : "No calls yet"
          }
          emptyDescription={
            (searchCount ?? 0) > 0
              ? "Use the page links below to get back."
              : source || outcome
                ? "Clear the filters to see everything."
                : undefined
          }
        />

        {(searchCount ?? 0) > 0 ? (
          <Pager
            className="border-t border-divider px-5 py-3"
            page={searchPage}
            total={searchCount ?? searchRows.length}
            pageSize={SEARCHES_PER_PAGE}
            noun="calls"
            href={{
              path: base,
              params: { tab: "activity", source, outcome },
              pageKey: "spage",
            }}
          />
        ) : null}
      </Panel>

      <Panel
        title="Latest alerts"
        description="The newest few this account was told about. The delivery log has all of them, with the delivered and unread filters."
        bodyClassName="p-0"
        actions={<PanelAction href={fullAlertLog}>Full delivery log</PanelAction>}
      >
        {alertRows.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            description="An alert is sent when a truck they watch crosses a plaza, or when a rule they set fires."
          />
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

            {alertTotal > alertRows.length ? (
              <div className="border-t border-divider px-3 py-2">
                <ShowMore href={fullAlertLog} remaining={alertTotal - alertRows.length} noun="more" />
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
