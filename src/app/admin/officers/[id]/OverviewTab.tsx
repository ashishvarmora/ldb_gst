import Link from "next/link";
import { Bell, Search as SearchIcon, Truck } from "lucide-react";

import { DescRow, LinkButton, Panel } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { LimitOverrides, OfficerOverview } from "@/lib/types";

/**
 * Everything about the account that is read rather than changed. The forms that
 * alter any of it live one tab along, under Settings, so this page can be
 * skimmed without the risk of nudging a value on the way past.
 */
export async function OverviewTab({
  id,
  overview,
}: {
  id: string;
  overview: OfficerOverview;
}) {
  const admin = getSupabaseAdmin();

  const { data: overrides } = await admin
    .from("user_limit_overrides")
    .select("*")
    .eq("user_id", id)
    .maybeSingle<LimitOverrides>();

  const place = [overview.district, overview.state].filter(Boolean).join(", ");

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Panel
          title="Contact details"
          description="Everything you hold about this customer. Change it under Settings."
          bodyClassName="px-5 py-2"
          actions={
            <LinkButton href={`/admin/officers/${id}?tab=settings`} variant="ghost" size="sm">
              Edit
            </LinkButton>
          }
        >
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <dl>
              <DescRow label="Name">{overview.full_name ?? "--"}</DescRow>
              <DescRow label="Email">
                <a href={`mailto:${overview.email}`} className="hover:text-brand-500">
                  {overview.email}
                </a>
              </DescRow>
              <DescRow label="Phone">
                {overview.phone ? (
                  <a href={`tel:${overview.phone}`} className="hover:text-brand-500">
                    {overview.phone}
                  </a>
                ) : (
                  "--"
                )}
              </DescRow>
              <DescRow label="Job title">{overview.designation ?? "--"}</DescRow>
            </dl>
            <dl>
              <DescRow label="Company">{overview.office ?? "--"}</DescRow>
              <DescRow label="Place">{place || "--"}</DescRow>
              <DescRow label="Signed up">{fmtDate(overview.created_at)}</DescRow>
              <DescRow label="Last seen">{fmtRelative(overview.last_active_at)}</DescRow>
            </dl>
          </div>
          {overview.notes ? (
            <p className="mt-2 border-t border-divider pt-3 pb-2 text-sm whitespace-pre-line text-muted">
              <span className="mb-1 block text-xs tracking-wide text-faint uppercase">
                Internal notes
              </span>
              {overview.notes}
            </p>
          ) : null}
        </Panel>

        <Panel
          title="What this account has done"
          description="Counted from the credit ledger, so it agrees with the money."
          bodyClassName="px-5 py-2"
        >
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <dl>
              <DescRow label="Searches this month">
                {fmtNumber(overview.manual_searches_month)}
              </DescRow>
              <DescRow label="Automatic checks this month">
                {fmtNumber(overview.tracking_queries_month)}
              </DescRow>
              <DescRow label="Crossings recorded">{fmtNumber(overview.total_events)}</DescRow>
            </dl>
            <dl>
              <DescRow label="Alerts switched on">{fmtNumber(overview.active_alerts)}</DescRow>
              <DescRow label="Alerts unread">{fmtNumber(overview.alerts_unread)}</DescRow>
              <DescRow label="Last crossing">{fmtDateTime(overview.last_event_at)}</DescRow>
            </dl>
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel
          title="Plan"
          description="Changed under Settings. Renewals and top-ups do not happen by themselves."
        >
          <p className="text-lg font-semibold text-strong">{overview.plan_name ?? "No plan"}</p>
          {overview.plan_description ? (
            <p className="mt-0.5 text-xs text-muted">{overview.plan_description}</p>
          ) : null}
          <dl className="mt-3 border-t border-divider pt-2">
            <DescRow label="Price">
              {overview.price_per_month ? `Rs ${overview.price_per_month} a month` : "--"}
            </DescRow>
            <DescRow label="Started">{fmtDateTime(overview.plan_assigned_at)}</DescRow>
            <DescRow label="Ends">
              {overview.plan_expires_on ? fmtDate(overview.plan_expires_on) : "no end date"}
            </DescRow>
            <DescRow label="Credits included">
              {overview.included_credits === null
                ? "--"
                : formatCredits(overview.included_credits)}
            </DescRow>
          </dl>
        </Panel>

        <Panel
          title="Truck limit"
          description={
            overrides
              ? "This account has a limit of its own, set by you."
              : "Inherited from the plan."
          }
        >
          <dl>
            <DescRow label="Effective">{formatLimit(overview.truck_limit)}</DescRow>
            <DescRow label="In use">{fmtNumber(overview.active_trucks)}</DescRow>
            {overrides?.reason ? <DescRow label="Why">{overrides.reason}</DescRow> : null}
          </dl>
        </Panel>

        <Panel title="Elsewhere in the console" bodyClassName="p-0">
          <ul className="divide-y divide-divider text-sm">
            <li>
              <Link
                href={`/admin/trucks?officer=${id}`}
                className="flex items-center gap-2.5 px-5 py-3 text-ink transition hover:bg-raised/60"
              >
                <Truck size={14} className="text-faint" />
                Their trucks in the fleet view
              </Link>
            </li>
            <li>
              <Link
                href={`/admin/explore?q=${encodeURIComponent(overview.email)}`}
                className="flex items-center gap-2.5 px-5 py-3 text-ink transition hover:bg-raised/60"
              >
                <SearchIcon size={14} className="text-faint" />
                Cross-reference their trucks with other customers
              </Link>
            </li>
            <li>
              <Link
                href={`/admin/alerts/log?officer=${id}`}
                className="flex items-center gap-2.5 px-5 py-3 text-ink transition hover:bg-raised/60"
              >
                <Bell size={14} className="text-faint" />
                Every alert sent to this account
              </Link>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
