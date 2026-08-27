import Link from "next/link";
import { AlertTriangle, Bell, Gauge, Plus, Search, Star, Truck } from "lucide-react";

import { SearchBox } from "@/components/SearchBox";
import { TruckCard } from "@/components/TruckCard";
import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  Panel,
  PanelAction,
  QuotaBar,
  StatCard,
} from "@/components/ui";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { blockedReason, requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, SearchLog, TrackedTruck } from "@/lib/types";

export const metadata = { title: "Dashboard — Truck Watch" };

export default async function PortalHome() {
  const { overview, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: trucks }, { data: alerts }, { data: searches }] = await Promise.all([
    admin
      .from("tracked_trucks")
      .select("*")
      .eq("user_id", overview.id)
      .order("is_watchlist", { ascending: false })
      .order("last_event_at", { ascending: false, nullsFirst: false })
      .limit(6),
    admin
      .from("alert_logs")
      .select("*")
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .limit(6),
    admin
      .from("search_logs")
      .select("*")
      .eq("user_id", overview.id)
      .eq("source", "manual")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const truckList = (trucks ?? []) as TrackedTruck[];
  const alertList = (alerts ?? []) as AlertLog[];
  const searchList = (searches ?? []) as SearchLog[];

  const blocked = blockedReason(overview);
  const slots = truckSlotsLeft(overview);
  const searchesLeft =
    overview.manual_search_limit_per_day === -1
      ? Number.POSITIVE_INFINITY
      : Math.max(overview.manual_search_limit_per_day - overview.manual_searches_today, 0);

  const firstName = (profile.full_name ?? "").split(" ")[0];

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-strong">
          {firstName ? `Good to see you, ${firstName}` : "Truck Watch"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Look up any truck, or open one you are already tracking.
        </p>
      </div>

      {blocked ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">{blocked}</p>
        </div>
      ) : null}

      <Panel className="mb-5">
        <SearchBox
          autoFocus={false}
          hint={
            overview.manual_search_limit_per_day === -1
              ? "Unlimited manual searches on your plan."
              : `${searchesLeft} of ${overview.manual_search_limit_per_day} searches left today. Resets at midnight IST.`
          }
        />
      </Panel>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Tracked trucks"
          value={overview.active_trucks}
          sub={<QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />}
          icon={<Truck size={15} />}
        />
        <StatCard
          label="Searches left today"
          value={searchesLeft === Number.POSITIVE_INFINITY ? "∞" : searchesLeft}
          sub={`${overview.manual_searches_today} used of ${formatLimit(
            overview.manual_search_limit_per_day,
          )}`}
          tone={searchesLeft === 0 ? "bad" : "neutral"}
          icon={<Search size={15} />}
        />
        <StatCard
          label="Auto checks this month"
          value={fmtNumber(overview.tracking_queries_month)}
          sub={
            <QuotaBar
              used={overview.tracking_queries_month}
              limit={overview.tracking_queries_per_month}
            />
          }
          icon={<Gauge size={15} />}
        />
        <StatCard
          label="Alerts today"
          value={overview.alerts_today}
          sub={`Last crossing ${fmtRelative(overview.last_event_at)}`}
          tone={overview.alerts_today > 0 ? "warn" : "neutral"}
          icon={<Bell size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel
            title="My trucks"
            description={
              overview.active_trucks === 0
                ? "Nothing under tracking yet."
                : slots === Number.POSITIVE_INFINITY
                  ? `${overview.active_trucks} under tracking.`
                  : `${overview.active_trucks} under tracking · ${slots} slot${slots === 1 ? "" : "s"} free.`
            }
            actions={
              <PanelAction href="/portal/trucks">View all</PanelAction>
            }
            bodyClassName={truckList.length === 0 ? "p-0" : "p-4"}
          >
            {truckList.length === 0 ? (
              <EmptyState
                title="No trucks under tracking"
                description="Add a truck and the platform checks it in the background, logs every toll crossing and alerts you on Telegram."
                action={
                  <LinkButton href="/portal/trucks" variant="primary">
                    <Plus size={14} />
                    Add your first truck
                  </LinkButton>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {truckList.map((truck) => (
                  <TruckCard key={truck.id} truck={truck} />
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="Recent alerts"
            bodyClassName="p-0"
            actions={
              <PanelAction href="/portal/alerts">All alerts</PanelAction>
            }
          >
            {alertList.length === 0 ? (
              <EmptyState
                title="No alerts yet"
                description="Create a rule and you will be told the moment something matches."
              />
            ) : (
              <ul className="divide-y divide-divider">
                {alertList.map((alert) => (
                  <li key={alert.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-ink">{alert.title}</p>
                      {alert.delivered ? null : <Badge tone="warn">not sent</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-faint">
                      {alert.truck_number ? (
                        <>
                          <Mono>{alert.truck_number}</Mono> ·{" "}
                        </>
                      ) : null}
                      {fmtRelative(alert.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Your recent searches" bodyClassName="p-0">
            {searchList.length === 0 ? (
              <EmptyState title="No searches yet" />
            ) : (
              <ul className="divide-y divide-divider">
                {searchList.map((log) => (
                  <li key={log.id}>
                    <Link
                      href={`/portal/search/${log.truck_number}`}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 transition hover:bg-raised/60"
                    >
                      <span className="min-w-0">
                        <Mono className="block text-ink">{log.truck_number}</Mono>
                        <span className="block text-xs text-faint">
                          {fmtDateTime(log.created_at)}
                        </span>
                      </span>
                      {log.ok ? (
                        <span className="shrink-0 text-xs text-muted">
                          {log.events_found} crossing{log.events_found === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <Badge tone="bad">failed</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {overview.active_trucks > 0 ? (
            <Panel title="Tip">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                <Star size={13} className="mt-0.5 shrink-0 text-warn-500" />
                Mark a truck as <strong className="text-ink">watchlist</strong> and you get an
                alert on every single crossing, not just the ones matching a rule.
              </p>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
