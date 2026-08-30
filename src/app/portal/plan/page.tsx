import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Database,
  FolderOpen,
  Truck,
  Wallet,
  XCircle,
} from "lucide-react";

import {
  Badge,
  DescRow,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  QuotaBar,
  StatCard,
  cx,
} from "@/components/ui";
import { CREDIT_REASON_LABEL, describeRate, formatCredits, loadCreditRates } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtRupees, istToday } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditTransaction } from "@/lib/types";

export const metadata = { title: "My plan — Truck Watch" };

/**
 * What the account may reach, and what it has left to spend.
 *
 * Everything chargeable comes out of one credit balance now, so the page is
 * built around that balance and its ledger rather than a row of allowances an
 * officer had to hold in their head.
 */
export default async function PlanPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: ledger }, rates, { count: caseCount }, settings] = await Promise.all([
    admin
      .from("credit_transactions")
      .select("*")
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .limit(30),
    loadCreditRates(admin),
    admin
      .from("truck_groups")
      .select("id", { count: "exact", head: true })
      .eq("user_id", overview.id),
    loadSettings(admin),
  ]);

  const history = (ledger ?? []) as CreditTransaction[];

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
        subtitle="What your account is allowed to do, what it has left to spend, and where the credits went. Your administrator sets all of this."
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

      {/* ------------------------------- balance ------------------------- */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits left"
          value={formatCredits(overview.credits)}
          sub="pays for everything"
          tone={overview.credits <= 0 ? "bad" : "brand"}
          icon={<Wallet size={14} />}
        />
        <StatCard
          label="Included with plan"
          value={formatCredits(overview.included_credits ?? 0)}
          sub="added by your administrator"
        />
        <StatCard label="Spent today" value={formatCredits(overview.credits_spent_today)} />
        <StatCard label="Spent this month" value={formatCredits(overview.credits_spent_month)} />
      </div>

      {!settings.razorpayEnabled ? (
        <p className="mb-5 rounded-xl border border-line bg-panel px-4 py-3 text-sm leading-relaxed text-muted">
          Buying credits online is not set up yet — ask your administrator to add credits to your
          account.
        </p>
      ) : null}

      {/* ------------------------------- the plan ------------------------ */}
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
          <DescRow label="Price">
            {overview.price_per_month ? `${fmtRupees(overview.price_per_month)} a month` : "--"}
          </DescRow>
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ----------------------------- ledger -------------------------- */}
        <div className="lg:col-span-2">
          <Panel
            title="Credit history"
            description="Your last 30 credit movements, newest first."
            bodyClassName="p-0"
          >
            {history.length === 0 ? (
              <EmptyState
                title="Nothing spent yet"
                description="Searches and automatic checks show up here as soon as they run."
              />
            ) : (
              <ul className="divide-y divide-divider">
                {history.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-start justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">
                        {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                      </span>
                      <span className="block text-xs text-faint">
                        {fmtDateTime(row.created_at)}
                        {row.truck_number ? (
                          <>
                            {" · "}
                            <Mono className="text-muted">{row.truck_number}</Mono>
                          </>
                        ) : null}
                      </span>
                      {row.note ? (
                        <span className="mt-0.5 block text-xs text-muted">{row.note}</span>
                      ) : null}
                    </span>

                    <span className="shrink-0 text-right">
                      <span
                        className={cx(
                          "block text-sm font-medium tabular-nums",
                          row.delta < 0 ? "text-bad-500" : "text-good-500",
                        )}
                      >
                        {row.delta < 0 ? "−" : "+"}
                        {formatCredits(Math.abs(row.delta))}
                      </span>
                      <span className="block text-xs tabular-nums text-faint">
                        {formatCredits(row.balance_after)} left
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* ----------------------------- rates and limits ---------------- */}
        <div className="space-y-5">
          <Panel title="What each action costs">
            {rates.length === 0 ? (
              <p className="text-sm text-muted">
                No rates are set yet. Ask your administrator what an action costs.
              </p>
            ) : (
              <ul className="space-y-3">
                {rates.map((rate) => (
                  <li key={rate.action}>
                    <p className="text-sm font-medium text-ink">{rate.label}</p>
                    <p className="mt-0.5 text-sm text-brand-500">{describeRate(rate)}</p>
                    {rate.description ? (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">
                        {rate.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="What your plan allows">
            <div className="space-y-3">
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                  <Truck size={12} />
                  Tracked trucks
                </p>
                <QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                  <FolderOpen size={12} />
                  Case folders
                </p>
                <QuotaBar used={caseCount ?? 0} limit={overview.max_truck_groups} />
              </div>
            </div>

            <dl className="mt-4 border-t border-divider pt-3">
              <DescRow label="History kept">
                <span className="inline-flex items-center gap-1.5">
                  <Database size={12} className="text-faint" />
                  {overview.data_retention_days === -1
                    ? "indefinitely"
                    : `${formatLimit(overview.data_retention_days)} days`}
                </span>
              </DescRow>
            </dl>

            <ul className="mt-3 space-y-2.5 border-t border-divider pt-3">
              <Feature on={overview.alerts_enabled} label="Truck alerts, set per truck" />
              <Feature on={overview.telegram_enabled} label="Alerts delivered on Telegram" />
              <Feature
                on={overview.google_sheet_enabled}
                label="Google Sheet log of every crossing"
              />
            </ul>

            <div className="mt-4">
              <LinkButton href="/portal/settings" size="sm" variant="secondary">
                Settings
              </LinkButton>
            </div>
          </Panel>
        </div>
      </div>
    </>
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
