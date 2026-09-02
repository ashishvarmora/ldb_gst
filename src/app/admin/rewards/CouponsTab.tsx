import Link from "next/link";
import {
  Hourglass,
  IndianRupee,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Ticket,
  TicketCheck,
  Trash2,
  Users,
} from "lucide-react";

import { CouponFields } from "./CouponFields";
import { REWARDS_PATH, type RewardParams } from "./params";
import {
  createCoupon,
  deleteCoupon,
  saveCoupon,
  setCouponActive,
} from "../credits/actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { FormActions } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Pager, pageCount, pageFromParam, pageSlice } from "@/components/Pager";
import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import {
  couponInactiveReason,
  describeClaims,
  describeCoupon,
  loadCoupons,
} from "@/lib/coupons";
import { fmtDate, fmtNumber, fmtRupees } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CouponUsage } from "@/lib/types";

/**
 * Discount codes: what exists, what it does, and what it has cost.
 *
 * Two ideas on this tab have to stay apart, because an admin who conflates them
 * reads the numbers wrong. A claim is USED when a payment settled and the money
 * came in short. A claim is HELD when a checkout has opened and nothing has
 * arrived yet - it counts against the limit, because otherwise two people would
 * spend the last use of a single-use code at the same instant, but nobody has
 * paid and nothing has been given away. "4 of 5 claimed" with an empty payments
 * list is not a bug, and this tab has to say so before it is reported as one.
 *
 * There is no customer-facing list anywhere, by design: RLS keeps the table to
 * super admins, and a code is checked one at a time through validate_coupon.
 * A code only exists for someone once it has been handed to them.
 */

const COUPONS_PER_PAGE = 25;

export async function CouponsTab({ params }: { params: RewardParams }) {
  const admin = getSupabaseAdmin();
  const [coupons, settings] = await Promise.all([loadCoupons(admin), loadSettings(admin)]);

  // Clamped to what exists, so deleting the last code on page 3 lands on the
  // last page there is rather than on an empty table.
  const page = pageFromParam(params.cp, pageCount(coupons.length, COUPONS_PER_PAGE));

  // Totals across every code, not just the page listed - the same approach the
  // History tab takes to payments, and for the same reason: a figure that
  // changes when you turn the page answers nothing.
  const live = coupons.filter((coupon) => couponInactiveReason(coupon) === null).length;
  const used = coupons.reduce((sum, coupon) => sum + Number(coupon.used ?? 0), 0);
  const holding = coupons.reduce((sum, coupon) => sum + Number(coupon.holding ?? 0), 0);
  const given = coupons.reduce((sum, coupon) => sum + Number(coupon.discount_given ?? 0), 0);
  const listTotal = coupons.reduce((sum, coupon) => sum + Number(coupon.list_total ?? 0), 0);

  /*
   * Credits handed out by bonus codes, which none of the rupee figures above
   * can see.
   *
   * discount_given sums coupon_redemptions.discount_inr, and a credit_bonus
   * code writes nothing there - it grants credits and takes nothing off any
   * price. So a screen whose only payout figure was "discount given" reported
   * Rs 0 for a code that had handed over 500 credits. Read from the coupon's
   * own value, the way redeem_coupon() computes it, and only for claims that
   * actually settled.
   */
  const creditsGiven = coupons.reduce(
    (sum, coupon) =>
      coupon.kind === "credit_bonus"
        ? sum + Number(coupon.value ?? 0) * Number(coupon.used ?? 0)
        : sum,
    0,
  );

  const rows = pageSlice(coupons, page, COUPONS_PER_PAGE);

  // The pager carries the section, so turning a page does not fall back to the
  // first tab.
  const pagerParams = { section: "coupons", cp: page };

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Codes live now"
          value={fmtNumber(live)}
          sub={
            coupons.length === 0
              ? "No codes made yet"
              : coupons.length === live
                ? "Every code you have made"
                : `${fmtNumber(coupons.length - live)} switched off, expired or not started`
          }
          tone={live > 0 ? "brand" : "neutral"}
          icon={<Ticket size={15} />}
        />
        <StatCard
          label="Claims used"
          value={fmtNumber(used)}
          sub="Claims that actually settled — a discount, or a credit grant"
        />
        <StatCard
          label="Claims held"
          value={fmtNumber(holding)}
          sub={
            holding > 0
              ? "Checkouts still in flight. Counted against the limit, but nothing paid yet."
              : "No checkout is sitting on a claim"
          }
          tone={holding > 0 ? "warn" : "neutral"}
          icon={<Hourglass size={15} />}
        />
        <StatCard
          /* Both payouts, because a bonus code's whole value is invisible in
             rupees and a discount code's is invisible in credits. Whichever
             is nought is said to be nought rather than left out, so the card
             never looks like the only kind of code you have. */
          label="Handed out"
          value={creditsGiven > 0 ? formatCredits(creditsGiven) : fmtRupees(given)}
          sub={
            creditsGiven > 0 && given > 0
              ? `credits, plus ${fmtRupees(given)} off ${fmtRupees(listTotal)} of list prices`
              : creditsGiven > 0
                ? "free credits from bonus codes; no discount codes claimed yet"
                : `off ${fmtRupees(listTotal)} of list prices`
          }
        />
      </div>

      {/* A code is only worth something if there is a checkout to type it into.
          Same warning the credit rules tab carries, for the same reason. */}
      {settings.razorpayEnabled ? null : (
        <p className="mb-4 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="text-warn-500">Online payment is switched off.</span> Codes can be
          written and edited here, but nothing can be bought, so none of them can be claimed. Turn
          it on in{" "}
          <Link href="/admin/settings" className="text-brand-400 hover:underline">
            settings
          </Link>
          .
        </p>
      )}

      <div className="mb-4 flex justify-end">
        <NewCouponButton />
      </div>

      <Panel
        className="mb-6"
        title="Every code"
        description="Live codes first, newest first within that. Held means a claim an unpaid checkout is sitting on: it counts against the limit until the money arrives, and is handed back if it has not within 30 minutes."
        bodyClassName="p-0"
      >
        {coupons.length === 0 ? (
          <EmptyState
            title="No discount codes yet"
            description="A code takes money off what somebody pays. It never takes credits off what they get — those are worked out from the price before the discount."
            action={<NewCouponButton />}
          />
        ) : (
          <>
            <TableWrap>
              <Thead>
                <th className="th">Code</th>
                <th className="th">What it does</th>
                <th className="th">Claims</th>
                <th className="th text-right">Handed out</th>
                <th className="th">Status</th>
                <th className="th text-right">Manage</th>
              </Thead>
              <Tbody>
                {rows.map((coupon) => (
                  <CouponRow
                    key={coupon.id}
                    coupon={coupon}
                    couponsPage={page}
                  />
                ))}
              </Tbody>
            </TableWrap>

            <Pager
              className="border-t border-divider px-5 py-3"
              page={page}
              total={coupons.length}
              pageSize={COUPONS_PER_PAGE}
              noun="codes"
              href={{ path: REWARDS_PATH, params: pagerParams, pageKey: "cp" }}
            />
          </>
        )}
      </Panel>

    </>
  );
}

/* -------------------------------------------------------------------------- */
/* one row of the code list                                                    */
/* -------------------------------------------------------------------------- */

function CouponRow({
  coupon,
  couponsPage,
}: {
  coupon: CouponUsage;
  couponsPage: number;
}) {
  const reason = couponInactiveReason(coupon);
  const exhausted = coupon.claims_left === 0;

  return (
    <Tr>
      <td className="td whitespace-nowrap">
        <Mono className="font-semibold text-ink">{coupon.code}</Mono>
        {coupon.description ? (
          <span className="mt-0.5 block max-w-52 truncate text-xs text-faint">
            {coupon.description}
          </span>
        ) : null}
      </td>

      <td className="td">
        <span className="block max-w-xs text-sm text-ink">{describeCoupon(coupon)}</span>
        <span className="mt-0.5 block text-xs text-faint">{limitsLine(coupon)}</span>
      </td>

      <td className="td whitespace-nowrap">
        <span className="block text-sm text-ink">{describeClaims(coupon)}</span>
        {/* Held is never folded into claimed. An admin reading "4 of 5
            claimed" with nothing in the payments list is looking at holds, and
            the difference has to be on the row rather than in a footnote. */}
        {coupon.holding > 0 ? (
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="warn">
              <Hourglass size={11} />
              {fmtNumber(coupon.holding)} held
            </Badge>
            <span className="text-xs text-faint">
              {coupon.claims_left === null
                ? "unpaid checkout"
                : `${fmtNumber(coupon.claims_left)} left`}
            </span>
          </span>
        ) : exhausted ? (
          <span className="mt-0.5 block text-xs text-warn-500">Nothing left to claim</span>
        ) : null}
      </td>

      {/* The payout, in whichever unit this code actually pays in.
          A bonus code writes nothing to discount_inr, so reading only that
          showed TOPUP500 - which had handed over 500 credits - as a dash. */}
      <td className="td text-right text-sm font-medium tabular-nums text-ink">
        {coupon.kind === "credit_bonus" ? (
          Number(coupon.used) > 0 ? (
            <>
              {formatCredits(Number(coupon.value) * Number(coupon.used))}
              <span className="mt-0.5 block text-xs font-normal text-faint">credits</span>
            </>
          ) : (
            <span className="text-faint">nothing yet</span>
          )
        ) : Number(coupon.discount_given) > 0 ? (
          <>
            {fmtRupees(Number(coupon.discount_given))}
            <span className="mt-0.5 block text-xs font-normal text-faint">
              off {fmtRupees(Number(coupon.list_total))}
            </span>
          </>
        ) : (
          <span className="text-faint">nothing yet</span>
        )}
      </td>

      <td className="td">
        {reason === null ? (
          <Badge tone="good">Live</Badge>
        ) : (
          <Badge tone={reason === "Not started yet" ? "warn" : "neutral"}>{reason}</Badge>
        )}
        {exhausted && reason === null ? (
          <span className="mt-1 block">
            <Badge tone="warn">Fully claimed</Badge>
          </span>
        ) : null}
      </td>

      <td className="td">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* Straight to the claims report, filtered to this code.
              This used to open a panel at the foot of this page, which was a
              second and worse copy of that report: it spoke only in rupees, so
              a credit_bonus code - whose entire payout is credits - showed a
              row of zeroes. One report now, and it is the one that can say what
              was actually handed over. */}
          <LinkButton
            href={`${REWARDS_PATH}?${new URLSearchParams({
              section: "coupon-claims",
              code: coupon.code,
              group: "none",
            })}`}
            variant="ghost"
            size="sm"
          >
            <Users size={13} />
            Who used it
          </LinkButton>

          <Modal
            triggerLabel="Edit"
            triggerIcon={<Pencil size={13} />}
            triggerVariant="secondary"
            triggerSize="sm"
            title={`Edit ${coupon.code}`}
            description="Changes apply to the next order. Discounts already given keep the amount they were given at."
          >
            <ActionForm action={saveCoupon}>
              <input type="hidden" name="coupon_id" value={coupon.id} />
              <CouponFields coupon={coupon} />
              <FormActions>
                <SubmitButton>Save code</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>

          <InlineActionForm
            action={setCouponActive}
            hidden={{ coupon_id: coupon.id, is_active: coupon.is_active ? "false" : "true" }}
          >
            <SubmitButton variant="ghost" size="sm">
              {coupon.is_active ? <Power size={13} /> : <RotateCcw size={13} />}
              {coupon.is_active ? "Switch off" : "Switch on"}
            </SubmitButton>
          </InlineActionForm>

          <InlineActionForm action={deleteCoupon} hidden={{ coupon_id: coupon.id }}>
            <ConfirmSubmitButton message={deleteWarning(coupon)}>
              <Trash2 size={13} />
              Delete
            </ConfirmSubmitButton>
          </InlineActionForm>
        </div>
      </td>
    </Tr>
  );
}

/** "once per person · 1 Sep 2026 to 30 Sep 2026" - the rules describeCoupon leaves out. */
function limitsLine(coupon: CouponUsage): string {
  const parts: string[] = [
    coupon.max_per_user === 1
      ? "once per person"
      : `${fmtNumber(coupon.max_per_user)} times per person`,
  ];

  if (coupon.starts_at && coupon.expires_at) {
    parts.push(`${fmtDate(coupon.starts_at)} to ${fmtDate(coupon.expires_at)}`);
  } else if (coupon.starts_at) {
    parts.push(`from ${fmtDate(coupon.starts_at)}`);
  } else if (coupon.expires_at) {
    parts.push(`until ${fmtDate(coupon.expires_at)}`);
  }

  return parts.join(" · ");
}

/**
 * What deleting actually costs, said before it happens.
 *
 * Redemptions cascade off the coupon, so the count of discounts already given
 * goes with it. Switching off is nearly always what the admin wants - it stops
 * the code dead and keeps the history - so the confirm ends by saying so.
 */
function deleteWarning(coupon: CouponUsage): string {
  const parts = [`Delete the code ${coupon.code}?`];

  if (coupon.used > 0) {
    parts.push(
      coupon.kind === "credit_bonus"
        ? `Its ${coupon.used} claim${coupon.used === 1 ? "" : "s"} are deleted with it, so the record of ${formatCredits(Number(coupon.value) * Number(coupon.used))} credits already granted is lost. The credits themselves stay in the accounts that got them.`
        : `Its ${coupon.used} redemption${coupon.used === 1 ? "" : "s"} are deleted with it, so the record of ${fmtRupees(Number(coupon.discount_given))} already discounted is lost. The payments themselves keep their amounts.`,
    );
  }
  if (coupon.holding > 0) {
    parts.push(
      `${coupon.holding} checkout${coupon.holding === 1 ? " is" : "s are"} holding a claim on it right now.`,
    );
  }

  parts.push("Switching it off instead stops anyone using it and keeps the history.");
  return parts.join(" ");
}


/* -------------------------------------------------------------------------- */

function NewCouponButton() {
  return (
    <Modal
      triggerLabel="New code"
      triggerIcon={<Plus size={15} />}
      title="Create a discount code"
      description="The worked example inside shows what the code does to a real order. Everything here can be changed later."
    >
      <ActionForm action={createCoupon}>
        <CouponFields />
        <FormActions>
          <SubmitButton pendingLabel="Creating...">Create code</SubmitButton>
        </FormActions>
      </ActionForm>
    </Modal>
  );
}
