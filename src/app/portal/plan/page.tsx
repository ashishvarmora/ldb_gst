import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  FolderOpen,
  Gauge,
  Search,
  Sheet,
  Truck,
  XCircle,
} from "lucide-react";

import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  Badge,
  DescRow,
  LinkButton,
  PageHeader,
  Panel,
  QuotaBar,
  cx,
} from "@/components/ui";
import { fmtDate, fmtNumber, fmtRelative, istDaysAgo, istToday } from "@/lib/format";
import { intervalLabel, monthlyCallsAt } from "@/lib/intervals";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TrackedTruck, UsageCounter } from "@/lib/types";

export const metadata = { title: "My plan — Truck Watch" };

/**
 * Everything an officer might want to know about what they are allowed to do:
 * what the plan includes, when it started, when it runs out, and how much of
 * each allowance is left. All of it is set by their administrator.
 */
export default async function PlanPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: usage }, { data: trucks }, { count: ruleCount }, { count: caseCount }] =
    await Promise.all([
      admin
        .from("usage_counters")
        .select("*")
        .eq("user_id", overview.id)
        .gte("usage_date", istDaysAgo(29)),
      admin
        .from("tracked_trucks")
        .select("*")
        .eq("user_id", overview.id)
        .eq("is_active", true),
      admin
        .from("alert_rules")
        .select("id", { count: "exact", head: true })
        .eq("user_id", overview.id),
      admin
        .from("truck_groups")
        .select("id", { count: "exact", head: true })
        .eq("user_id", overview.id),
    ]);

  const series = buildUsageSeries((usage ?? []) as UsageCounter[], 30);
  const active = (trucks ?? []) as TrackedTruck[];

  // What the current truck list will actually consume this month.
  const projected = active.reduce(
    (sum, truck) => sum + monthlyCallsAt(truck.polling_interval_minutes),
    0,
  );
  const overCommitted =
    overview.tracking_queries_per_month !== -1 && projected > overview.tracking_queries_per_month;

  const today = istToday();
  const expiresOn = overview.plan_expires_on;
  const daysLeft = expiresOn
    ? Math.ceil((new Date(`${expiresOn}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000)
    : null;
  const expired = expiresOn !== null && expiresOn < today;

  if (!overview.plan_name) {
    return (
      <>
        <PageHeader title="My plan" />
        <Panel>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad-500" />
            <div>
              <p className="text-sm font-medium text-ink">No plan is assigned to your account</p>
              <p className="mt-1 text-sm text-muted">
                Searching and tracking are switched off until your administrator assigns one. Nothing
                you have saved is lost.
              </p>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My plan"
        subtitle="What your account is allowed to do, and how much of it you have used. Your administrator sets all of this."
      />

      {expired ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-bad-500/40 bg-bad-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad-500" />
          <p className="text-sm text-bad-500">
            Your plan expired on {fmtDate(expiresOn)}. Searching and tracking are refused until your
            administrator renews it.
          </p>
        </div>
      ) : daysLeft !== null && daysLeft <= 14 ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <CalendarDays size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">
            Your plan ends in {daysLeft} day{daysLeft === 1 ? "" : "s"}, on {fmtDate(expiresOn)}.
            Mention it to your administrator if you need it extended.
          </p>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      <Panel className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-strong">{overview.plan_name}</h2>
              <Badge tone={expired ? "bad" : "good"}>{expired ? "Expired" : "Active"}</Badge>
              {overview.has_overrides ? <Badge tone="brand">customised for you</Badge> : null}
            </div>
            {overview.plan_description ? (
              <p className="mt-1.5 max-w-xl text-sm text-muted">{overview.plan_description}</p>
            ) : null}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-8 border-t border-divider pt-3 sm:grid-cols-2">
          <DescRow label="Started">
            {overview.plan_assigned_at ? fmtDate(overview.plan_assigned_at) : "--"}
          </DescRow>
          <DescRow label="Ends">
            {expiresOn ? (
              <span className={cx(expired && "text-bad-500")}>{fmtDate(expiresOn)}</span>
            ) : (
              <span className="text-good-500">No end date</span>
            )}
          </DescRow>
          <DescRow label="Running for">
            {overview.plan_assigned_at ? fmtRelative(overview.plan_assigned_at).replace(" ago", "") : "--"}
          </DescRow>
          <DescRow label="Days remaining">
            {daysLeft === null ? "unlimited" : expired ? "0" : `${daysLeft}`}
          </DescRow>
        </dl>

        {overview.has_overrides ? (
          <p className="mt-3 rounded-lg border border-brand-500/25 bg-brand-500/[0.06] px-3 py-2 text-xs leading-relaxed text-muted">
            Your administrator has adjusted some limits specifically for you, so the numbers below
            may differ from the standard {overview.plan_name} plan.
          </p>
        ) : null}
      </Panel>

      {/* ------------------------------- allowances ---------------------- */}
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
        Your allowances right now
      </h2>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AllowanceCard
          icon={<Search size={15} />}
          title="Manual searches"
          period="per day, resets at midnight IST"
          used={overview.manual_searches_today}
          limit={overview.manual_search_limit_per_day}
          note="Every time you search a number yourself, or press Check again."
        />
        <AllowanceCard
          icon={<Gauge size={15} />}
          title="Automatic checks"
          period="per month, resets on the 1st"
          used={overview.tracking_queries_month}
          limit={overview.tracking_queries_per_month}
          note="Background checking of your tracked trucks. A separate pool from searches."
        />
        <AllowanceCard
          icon={<Truck size={15} />}
          title="Tracked trucks"
          period="at any one time"
          used={overview.active_trucks}
          limit={overview.truck_limit}
          note="Pausing a truck frees its slot immediately."
        />
        <AllowanceCard
          icon={<Bell size={15} />}
          title="Alert rules"
          period="total"
          used={ruleCount ?? 0}
          limit={overview.max_alert_rules}
          hideBar
          note="Rules apply to every truck you track."
        />
        <AllowanceCard
          icon={<FolderOpen size={15} />}
          title="Case folders"
          period="total"
          used={caseCount ?? 0}
          limit={overview.max_truck_groups}
          hideBar
          note="Group the vehicles in one investigation."
        />
        <AllowanceCard
          icon={<Clock size={15} />}
          title="Fastest checking"
          period="per truck"
          custom={intervalLabel(overview.min_polling_interval_minutes)}
          note="You may pick this or anything slower, never faster."
        />
      </div>

      {/* ------------------------------- what it includes ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="What this plan includes" className="lg:col-span-2">
          <ul className="space-y-2.5">
            <Feature on label="Search any registration number" />
            <Feature on label="Background tracking with a route timeline for every truck" />
            <Feature on label="Records view with filtering and CSV export" />
            <Feature
              on={overview.alert_rules_enabled}
              label={`Alert rules — ${formatLimit(overview.max_alert_rules)} allowed`}
            />
            <Feature
              on={overview.telegram_enabled}
              label="Telegram alerts sent to your phone"
            />
            <Feature
              on={overview.google_sheet_enabled}
              label="Google Sheet sync — a permanent copy of every crossing"
            />
            <Feature
              on={overview.max_truck_groups !== 0}
              label={`Case folders — ${formatLimit(overview.max_truck_groups)} allowed`}
            />
          </ul>
        </Panel>

        <Panel title="History kept in the app">
          <div className="flex items-start gap-2.5">
            <Database size={16} className="mt-0.5 shrink-0 text-brand-500" />
            <div>
              <p className="text-sm text-ink">
                {overview.data_retention_days === -1
                  ? "Kept indefinitely"
                  : `${overview.data_retention_days} days`}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Older crossings are cleared from the app automatically. You mainly need recent
                movement, and keeping less makes everything faster.
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2.5 border-t border-divider pt-3">
            <Sheet
              size={16}
              className={cx(
                "mt-0.5 shrink-0",
                overview.sheet_connected ? "text-good-500" : "text-warn-500",
              )}
            />
            <div>
              <p className="text-sm text-ink">
                {overview.sheet_connected ? "Google Sheet connected" : "No Google Sheet"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {overview.sheet_connected ? (
                  <>
                    Your sheet keeps <strong className="text-ink">everything</strong>, so clearing
                    old records from the app loses nothing. Last synced{" "}
                    {fmtRelative(overview.sheet_last_synced_at)}.
                  </>
                ) : (
                  <span className="text-warn-500">
                    Without a sheet the app is your only copy, so old records are not cleared —
                    but nothing is backed up either. Connect one in Settings.
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="mt-3">
            <LinkButton href="/portal/settings" size="sm" variant="secondary">
              Settings
            </LinkButton>
          </div>
        </Panel>
      </div>

      {/* ------------------------------- projection ---------------------- */}
      {active.length > 0 ? (
        <Panel
          className="mb-5"
          title="What your current trucks will use"
          description="Based on the interval set on each truck right now."
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className="text-2xl font-semibold tabular-nums text-strong">
              ~{fmtNumber(projected)}
            </p>
            <p className="text-sm text-muted">
              automatic checks a month, against your allowance of{" "}
              {formatLimit(overview.tracking_queries_per_month)}
            </p>
          </div>
          {overCommitted ? (
            <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-500">
              That is more than your monthly allowance, so checking will stop part-way through the
              month. Set a slower interval on the trucks that do not need minute-by-minute detail —
              going from 10 minutes to 30 cuts a truck&apos;s cost by two thirds.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">
              Comfortably inside your allowance. Each truck at{" "}
              {intervalLabel(active[0]?.polling_interval_minutes ?? 30)} costs about{" "}
              {fmtNumber(monthlyCallsAt(active[0]?.polling_interval_minutes ?? 30))} checks a month.
            </p>
          )}
        </Panel>
      ) : null}

      <Panel title="Your usage, last 30 days">
        <UsageChart series={series} />
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function AllowanceCard({
  icon,
  title,
  period,
  used,
  limit,
  custom,
  note,
  hideBar,
}: {
  icon: React.ReactNode;
  title: string;
  period: string;
  used?: number;
  limit?: number;
  custom?: string;
  note: string;
  hideBar?: boolean;
}) {
  const blocked = limit === 0;

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <span className="text-brand-500">{icon}</span>
            {title}
          </p>
          <p className="mt-0.5 text-[11px] text-faint">{period}</p>
        </div>
        {blocked ? <Badge tone="bad">not included</Badge> : null}
      </div>

      <p className="mt-3 text-xl font-semibold tabular-nums text-strong">
        {custom ?? (limit === -1 ? "Unlimited" : `${fmtNumber(used ?? 0)} / ${fmtNumber(limit ?? 0)}`)}
      </p>

      {!hideBar && !custom && limit !== undefined ? (
        <div className="mt-2">
          <QuotaBar used={used ?? 0} limit={limit} />
        </div>
      ) : null}

      <p className="mt-2 text-xs leading-relaxed text-muted">{note}</p>
    </div>
  );
}

function Feature({ on, label }: { on?: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {on ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good-500" />
      ) : (
        <XCircle size={16} className="mt-0.5 shrink-0 text-faint" />
      )}
      <span className={on ? "text-ink" : "text-faint line-through"}>{label}</span>
    </li>
  );
}
