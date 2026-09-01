import Link from "next/link";

import type { AccountParams } from "./TabStrip";
import { GrantCreditsForm } from "../../credits/GrantCreditsForm";
import { balanceTone } from "../../tables";
import { CreditLedger } from "@/components/CreditLedger";
import { Badge, DescRow, Panel, buttonClass } from "@/components/ui";
import { describeRate, formatCredits, loadCreditRates } from "@/lib/credits";
import { fmtNumber } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

/**
 * The money side of one account: what is left, how to move it, where it went,
 * and what was paid for it.
 *
 * This is where a customer's credit history lives, and the only place it lives -
 * the Plans & credits section leads with one row per customer and links here
 * rather than interleaving everybody's movements into one list. Both tables come
 * from the shared components in ../../tables, so the same money is never
 * formatted two ways.
 */
export async function CreditsTab({
  id,
  overview,
  params,
}: {
  id: string;
  overview: OfficerOverview;
  params: AccountParams;
}) {
  const admin = getSupabaseAdmin();

  const [rates, settings] = await Promise.all([loadCreditRates(admin), loadSettings(admin)]);

  const balance = Number(overview.credits ?? 0);
  const base = `/admin/officers/${id}`;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {/*
          The same ledger the customer sees, for this account. It used to be a
          second implementation over credit_activity - a view that rolled the
          truck away - so the admin and the officer could look at one day and
          read different stories. One component now; only the id differs.
        */}
        {/* The ledger the customer sees, for this account. Money paid is a
            different question and lives on its own Payments tab now. */}
        <CreditLedger
          userId={id}
          basePath={base}
          query={params}
          keep={{ tab: "credits" }}
          title="Credits and activity"
        />
      </div>

      <div className="space-y-5">
        <Panel
          title="Balance"
          description="One balance pays for every search and every background check."
          actions={<Badge tone={balanceTone(balance)}>{formatCredits(balance)} left</Badge>}
        >
          <p className="mb-4 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-strong">
              {formatCredits(balance)}
            </span>
            <span className="text-sm text-muted">credits</span>
          </p>

          <GrantCreditsForm userId={id} />

          <dl className="mt-4 border-t border-divider pt-3">
            <DescRow label="Spent today">{formatCredits(overview.credits_spent_today)}</DescRow>
            <DescRow label="Spent this month">
              {formatCredits(overview.credits_spent_month)}
            </DescRow>
            <DescRow label="Bought so far">{formatCredits(overview.credits_purchased)}</DescRow>
            <DescRow label="Plan includes">
              {overview.included_credits === null
                ? "--"
                : `${formatCredits(overview.included_credits)} per term`}
            </DescRow>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            {settings.razorpayEnabled
              ? "They can also top up themselves, as long as their plan is live."
              : "They cannot buy credits themselves yet — switch on payments in Settings when you have Razorpay keys."}
          </p>
        </Panel>

        <Panel
          title="What their actions cost"
          description="Set for everyone, under Plans & credits."
          actions={
            <Link
              href="/admin/plans?tab=rules"
              className="text-xs text-brand-400 hover:underline"
            >
              Change
            </Link>
          }
        >
          {rates.length === 0 ? (
            <p className="text-sm text-muted">No rates are set yet.</p>
          ) : (
            <ul className="space-y-2">
              {rates.map((rate) => (
                <li key={rate.action} className="border-b border-divider pb-2 last:border-0 last:pb-0">
                  <p className="text-sm text-ink">{rate.label}</p>
                  <p className="text-xs text-brand-500">{describeRate(rate)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
