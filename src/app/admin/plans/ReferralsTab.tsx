import Link from "next/link";
import { Clock, Gift, Users, Wallet } from "lucide-react";

import { BASE_PATH, type SectionParams } from "./TabStrip";
import { saveReferralSettings } from "../credits/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormGrid, Input } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import {
  Avatar,
  Badge,
  EmptyState,
  Mono,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, initials } from "@/lib/format";
import { describeReferralReward } from "@/lib/referrals";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Referral, ReferralSummary } from "@/lib/types";

/**
 * Referrals: the terms, and who has actually earned anything.
 *
 * The one rule worth reading twice - a referral is worth nothing until the
 * person invited makes their FIRST PAYMENT. Sign-ups cost nothing to
 * manufacture, so paying for them would be paying for noise. Everything on this
 * tab keeps waiting and paid visibly apart for that reason.
 *
 * Nothing here grants credits. reward_referral() does that from inside
 * settle_payment, so there is exactly one path from "money arrived" to
 * "everyone owed was paid", and a webhook delivered twice pays once.
 */

const REFERRERS_PER_PAGE = 25;

export async function ReferralsTab({ params }: { params: SectionParams }) {
  const page = pageFromParam(params.ref);
  const admin = getSupabaseAdmin();

  const [settings, { data: summary, count }, { data: all }] = await Promise.all([
    loadSettings(admin),
    // Only people who have actually invited someone. The view has a row per
    // account, and a table of hundreds of zeroes answers nothing.
    admin
      .from("referral_summary")
      .select("*", { count: "exact" })
      .gt("invited", 0)
      .order("credits_earned", { ascending: false })
      .order("invited", { ascending: false })
      .range((page - 1) * REFERRERS_PER_PAGE, page * REFERRERS_PER_PAGE - 1),
    // Totals across the whole scheme, not just the page listed - the same
    // approach the payments totals take, for the same reason.
    admin.from("referrals").select("status, reward_credits").limit(2000),
  ]);

  const rows = (summary ?? []) as ReferralSummary[];
  const referrals = (all ?? []) as Pick<Referral, "status" | "reward_credits">[];

  const rewarded = referrals.filter((row) => row.status === "rewarded");
  const waiting = referrals.length - rewarded.length;
  const earned = rewarded.reduce((sum, row) => sum + Number(row.reward_credits ?? 0), 0);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="People invited"
          value={fmtNumber(referrals.length)}
          sub="Signed up through someone's link"
          icon={<Users size={15} />}
        />
        <StatCard
          label="Waiting on a first payment"
          value={fmtNumber(waiting)}
          sub={waiting > 0 ? "Earning nobody anything yet" : "Nothing outstanding"}
          tone={waiting > 0 ? "warn" : "neutral"}
          icon={<Clock size={15} />}
        />
        <StatCard
          label="Paid, and rewarded"
          value={fmtNumber(rewarded.length)}
          sub="Made their first payment"
          tone="brand"
          icon={<Gift size={15} />}
        />
        <StatCard
          label="Credits handed out"
          value={formatCredits(earned)}
          sub="To referrers, through the ledger"
          icon={<Wallet size={15} />}
        />
      </div>

      <Panel
        className="mb-6"
        title="What a referral is worth"
        description="Settings only. The reward itself is worked out when a payment settles, so changing these never moves a balance on its own."
      >
        <ActionForm action={saveReferralSettings} closeOnSuccess={false}>
          <div className="space-y-4">
            <Checkbox
              name="referral_enabled"
              label="Referrals earn credits"
              hint="Off keeps every link and every record, but nothing new is rewarded."
              defaultChecked={settings.referralEnabled}
            />

            <FormGrid cols={3}>
              <Field
                label="Share of the first payment (%)"
                name="referral_percent"
                hint="Paid to the referrer as credits, rounded down."
              >
                <Input
                  name="referral_percent"
                  type="number"
                  required
                  min={0}
                  max={100}
                  step="any"
                  defaultValue={settings.referralPercent}
                />
              </Field>
              <Field
                label="Milestone at"
                name="referral_milestone_count"
                hint="Referrals who have paid. 0 switches the milestone off."
              >
                <Input
                  name="referral_milestone_count"
                  type="number"
                  required
                  min={0}
                  max={1000}
                  step="1"
                  defaultValue={settings.referralMilestoneCount}
                />
              </Field>
              <Field
                label="Milestone bonus (credits)"
                name="referral_milestone_bonus"
                hint="Paid once, the moment that count is reached."
              >
                <Input
                  name="referral_milestone_bonus"
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  step="any"
                  defaultValue={settings.referralMilestoneBonus}
                />
              </Field>
            </FormGrid>

            <p className="rounded-lg border border-brand-500/35 bg-brand-500/8 px-3 py-2.5 text-sm text-ink">
              <span className="font-medium">
                {settings.referralEnabled
                  ? describeReferralReward(
                      settings.referralPercent,
                      settings.referralMilestoneCount,
                      settings.referralMilestoneBonus,
                    )
                  : "Referrals are switched off, so nothing new is rewarded."}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Nothing is earned at sign-up. A referral stays waiting — visible to both sides,
                worth nothing — until the person invited pays for the first time.
              </span>
            </p>

            <div className="flex justify-end">
              <SubmitButton size="sm">Save referral terms</SubmitButton>
            </div>
          </div>
        </ActionForm>
      </Panel>

      <Panel
        title="Who is referring"
        description="Everyone who has invited at least one person, best earners first. Records only — rewards are granted when a payment settles."
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody has invited anyone yet"
            description="Each customer gets a link on their own plan page. The first reward lands when someone they invited pays."
          />
        ) : (
          <>
            <TableWrap>
              <Thead>
                <th className="th">Referrer</th>
                <th className="th">Their code</th>
                <th className="th text-right">Invited</th>
                <th className="th text-right">Waiting to pay</th>
                <th className="th text-right">Paid</th>
                <th className="th text-right">Credits earned</th>
              </Thead>
              <Tbody>
                {rows.map((row) => (
                  <Tr key={row.referrer_id}>
                    <td className="td">
                      <Link
                        href={`/admin/officers/${row.referrer_id}`}
                        className="group flex items-center gap-2.5"
                      >
                        <Avatar size="sm" text={initials(row.full_name, row.email)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                            {row.full_name ?? row.email}
                          </span>
                          <span className="block truncate text-xs text-faint">{row.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      <Mono className="text-xs text-muted">{row.referral_code ?? "--"}</Mono>
                    </td>
                    <td className="td text-right text-sm tabular-nums text-ink">
                      {fmtNumber(row.invited)}
                    </td>
                    {/* Waiting and paid are never one column. The difference
                        between them is the whole scheme. */}
                    <td className="td text-right">
                      {Number(row.waiting) > 0 ? (
                        <Badge tone="warn">{fmtNumber(row.waiting)} not paid yet</Badge>
                      ) : (
                        <span className="text-sm tabular-nums text-faint">0</span>
                      )}
                    </td>
                    <td className="td text-right">
                      {Number(row.paid) > 0 ? (
                        <Badge tone="good">{fmtNumber(row.paid)} paid</Badge>
                      ) : (
                        <span className="text-sm tabular-nums text-faint">0</span>
                      )}
                    </td>
                    <td className="td text-right text-sm font-medium tabular-nums text-brand-500">
                      {formatCredits(row.credits_earned)}
                    </td>
                  </Tr>
                ))}
              </Tbody>
            </TableWrap>

            <Pager
              className="border-t border-divider px-5 py-3"
              page={page}
              total={count ?? rows.length}
              pageSize={REFERRERS_PER_PAGE}
              noun="referrers"
              href={{ path: BASE_PATH, params: { tab: "referrals" }, pageKey: "ref" }}
            />
          </>
        )}
      </Panel>
    </>
  );
}
