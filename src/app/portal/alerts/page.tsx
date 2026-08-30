import { AlertTriangle, Bell } from "lucide-react";

import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  StatCard,
} from "@/components/ui";
import { ALERT_KIND_LABEL } from "@/lib/alerts";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertKind, AlertLog } from "@/lib/types";

export const metadata = { title: "Alerts — Truck Watch" };

/**
 * Read-only. The two alerts are switched on one truck at a time, on that
 * truck's own page, so there is nothing to configure here - this is the record
 * of what was sent and whether it arrived.
 */
export default async function AlertsPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: logs }, { data: telegram }] = await Promise.all([
    admin
      .from("alert_logs")
      .select("*")
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .limit(60),
    admin
      .from("telegram_configs")
      .select("chat_id, is_enabled")
      .eq("user_id", overview.id)
      .maybeSingle(),
  ]);

  const alertList = (logs ?? []) as AlertLog[];
  const undelivered = alertList.filter((alert) => !alert.delivered).length;

  const telegramReady = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="You switch alerts on for each truck under My trucks. This page is the record of what was sent, and whether it reached you."
        actions={
          <LinkButton href="/portal/trucks">
            <Bell size={14} />
            Set up alerts
          </LinkButton>
        }
      />

      {!overview.alerts_enabled ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">
            Alerts are not enabled on your plan, so you cannot switch them on for a truck. Ask your
            administrator to turn them on.
          </p>
        </div>
      ) : !telegramReady ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <p className="flex items-start gap-2.5 text-sm text-warn-500">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            Telegram is not connected, so alerts will be recorded but not delivered.
          </p>
          <LinkButton href="/portal/settings" size="sm" variant="secondary">
            Connect Telegram
          </LinkButton>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Alerts today" value={overview.alerts_today} tone="brand" />
        <StatCard label="Alerts shown" value={alertList.length} sub="newest 60" />
        <StatCard
          label="Not delivered"
          value={undelivered}
          tone={undelivered > 0 ? "warn" : "neutral"}
          sub={undelivered > 0 ? "Usually a Telegram setup issue" : "All delivered"}
        />
      </div>

      <Panel
        title="Alert history"
        description="What actually fired, and whether it reached you."
        bodyClassName="p-0"
      >
        {alertList.length === 0 ? (
          <EmptyState
            title="Nothing has fired yet"
            description="Alerts appear here once you switch one on for a truck and it next reports in."
            action={<LinkButton href="/portal/trucks">Go to my trucks</LinkButton>}
          />
        ) : (
          <ul className="divide-y divide-divider">
            {alertList.map((alert) => {
              // History outlives the alerts themselves: rows written before the
              // rework carry retired kinds like "approaching_city", which have
              // no label. Show those as they were stored rather than blank.
              const kind =
                alert.kind && alert.kind in ALERT_KIND_LABEL
                  ? ALERT_KIND_LABEL[alert.kind as AlertKind]
                  : alert.kind;

              return (
                <li key={alert.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-ink">{alert.title}</p>
                    {alert.delivered ? (
                      <Badge tone="good">sent</Badge>
                    ) : (
                      <Badge tone="warn">not sent</Badge>
                    )}
                  </div>
                  {alert.message ? (
                    <p className="mt-0.5 text-xs text-muted">{alert.message}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-faint">
                    {alert.truck_number ? (
                      <>
                        <Mono>{alert.truck_number}</Mono> ·{" "}
                      </>
                    ) : null}
                    {kind ? <>{kind} · </> : null}
                    {fmtDateTime(alert.created_at)} · {fmtRelative(alert.created_at)}
                  </p>
                  {alert.delivery_error ? (
                    <p className="mt-1 text-[11px] text-bad-500">{alert.delivery_error}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
