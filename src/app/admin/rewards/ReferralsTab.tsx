import Link from "next/link";
import { Clock, Gift, Users, Wallet } from "lucide-react";

import { REWARDS_PATH, type RewardParams } from "./params";
import { saveReferralSettings } from "../credits/actions";
import { CapNote, pageWindow } from "../pager";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormGrid, Input } from "@/components/form";
import { Pager } from "@/components/Pager";
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
import { fmtNumber, fmtRupees, initials } from "@/lib/format";
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

/**
 * How many rewarded referrals are added up for "credits handed out".
 *
 * The other three figures are counted by the database and are exact however
 * large the scheme gets. This one cannot be: aggregate functions are switched
 * off on this project, so a total means reading the rows and summing them here,
 * and one select is capped by the project's max-rows regardless. Only rewarded
 * referrals carry credits, which keeps the read as small as it can be - and
 * when the cap does bite the page says so, because a floor shown as an exact
 * total is worse than a slow page.
 */
const REWARDED_SCANNED = 2000;

export async function ReferralsTab({ params }: { params: RewardParams }) {
  const admin = getSupabaseAdmin();

  const [settings, { count: referrerCount }, { count: invited }, { count: rewarded }, { data: paid }] =
    await Promise.all([
      loadSettings(admin),
      // Only people who have actually invited someone. The view has a row per
      // account, and a table of hundreds of zeroes answers nothing.
      admin
        .from("referral_summary")
        .select("referrer_id", { count: "exact", head: true })
        .gt("invited", 0),
      // Totals across the whole scheme, not just the page listed - a figure
      // that changes when you turn the page answers nothing.
      admin.from("referrals").select("id", { count: "exact", head: true }),
      admin
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "rewarded"),
      admin
        .from("referrals")
        .select("reward_credits")
        .eq("status", "rewarded")
        .limit(REWARDED_SCANNED),
    ]);

  // The referrer count comes first so the page number can be clamped to a page
  // that exists. A range starting past the last row is not an empty page:
  // PostgREST answers it with an error, no rows and no total, which would leave
  // a stale ?ref= showing an empty table and no link back.
  const total = referrerCount ?? 0;
  const { page, from, to } = pageWindow(params.ref, total, REFERRERS_PER_PAGE);

  const { data: summary } = await admin
    .from("referral_summary")
    .select("*")
    .gt("invited", 0)
    .order("credits_earned", { ascending: false })
    .order("invited", { ascending: false })
    // A unique tie-break, so two referrers with the same score cannot swap
    // places between pages and hide one of themselves.
    .order("referrer_id", { ascending: true })
    .range(from, to);

  const rows = (summary ?? []) as ReferralSummary[];
  const rewardRows = (paid ?? []) as Pick<Referral, "reward_credits">[];

  const invitedTotal = invited ?? 0;
  const rewardedTotal = rewarded ?? 0;
  const waiting = Math.max(invitedTotal - rewardedTotal, 0);
  const earned = rewardRows.reduce((sum, row) => sum + Number(row.reward_credits ?? 0), 0);
  const earnedCapped = rewardRows.length >= REWARDED_SCANNED;

  return (
    <>
      <div className="mb-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="People invited"
            value={fmtNumber(invitedTotal)}
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
            value={fmtNumber(rewardedTotal)}
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

        {earnedCapped ? (
          <CapNote>
            Credits handed out was added up over the {fmtNumber(REWARDED_SCANNED)} most recent
            rewarded referrals, so it is a floor rather than the exact figure. The three counts
            beside it are exact.
          </CapNote>
        ) : null}
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

            <FormGrid cols={2}>
              {/* First, because it decides whether anything below it applies at
                  all. Checked against what was actually charged, after any
                  discount - otherwise a deep coupon would be a way to
                  manufacture a qualifying payment out of a few rupees. */}
              <Field
                label="Qualifying payment (₹)"
                name="referral_min_payment"
                hint="What the person invited has to actually pay, after any discount, before the referrer earns anything. 0 means no minimum."
              >
                <Input
                  name="referral_min_payment"
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  step="any"
                  defaultValue={settings.referralMinPayment}
                />
              </Field>
              {/* Two shares of one payment, side by side so an admin sets the
                  scheme as a whole. They answer different questions - the
                  inviter's share is what makes people share the link, the
                  welcome share is what makes the invited person actually pay -
                  and pricing one while blind to the other is how a scheme ends
                  up costing 25% of a first payment without anyone deciding
                  that. */}
              <Field
                label="Inviter's share (%)"
                name="referral_percent"
                hint="Of the first payment, paid to whoever shared the link. Credits, rounded down."
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
                label="New customer's share (%)"
                name="referral_invitee_percent"
                hint="Of the same payment, paid to the person who joined. 0 pays them nothing."
              >
                <Input
                  name="referral_invitee_percent"
                  type="number"
                  required
                  min={0}
                  max={100}
                  step="any"
                  defaultValue={settings.referralInviteePercent}
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
                {settings.referralMinPayment > 0
                  ? ` A first payment under ${fmtRupees(settings.referralMinPayment)} earns nothing and leaves the referral waiting, so a later payment that does clear the floor can still qualify it.`
                  : ""}
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
            title={total > 0 ? "That page is past the end of the list" : "Nobody has invited anyone yet"}
            description={
              total > 0
                ? "Use the page links below to get back."
                : "Each customer gets a link on their own plan page. The first reward lands when someone they invited pays."
            }
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
          </>
        )}

        {/* Outside the branch above: a page with no rows on it is exactly when
            the reader needs the link back to the pages that have some. */}
        <Pager
          className="border-t border-divider px-5 py-3"
          page={page}
          total={total}
          pageSize={REFERRERS_PER_PAGE}
          noun="referrers"
          href={{ path: REWARDS_PATH, params: { section: "referrals" }, pageKey: "ref" }}
        />
      </Panel>
    </>
  );
}
