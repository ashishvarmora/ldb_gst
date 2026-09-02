import Link from "next/link";
import {
  Coins,
  Hourglass,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Ticket,
  Trash2,
  Users,
  Wallet,
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
import { queryString } from "@/components/report";
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
  cx,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import {
  COUPON_FAMILIES,
  couponFamily,
  couponFamilyLabel,
  couponInactiveReason,
  couponPayout,
  describeClaims,
  describeCoupon,
  describeHolds,
  loadCoupons,
  parseCouponFamily,
  type CouponRow,
} from "@/lib/coupons";
import { fmtDate, fmtNumber, fmtRupees } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The codes themselves: what exists, what each one does, and what it has cost.
 *
 * TWO SORTS OF CODE, kept visibly apart, because the owner's word for what
 * happens when they are not is "messy" and he is describing a real cost. A
 * discount code takes rupees off a payment; a free credit code hands over
 * credits and changes no price. They are paid in different units, so a screen
 * that assumes rupees reports a 500-credit giveaway as Rs 0 - which is exactly
 * what this tab did until the payout figure learned to ask the code which unit
 * it pays in. The classification lives in lib/coupons, once, and both this tab
 * and the claims report read it from there.
 *
 * THREE IDEAS ABOUT CLAIMS that have to stay apart, because an admin who
 * conflates them reads the numbers wrong:
 *
 *   settled    a payment came in short, or credits were handed over. The only
 *              thing that has cost anything.
 *   at a       a checkout is open and nothing has arrived. It counts against
 *   checkout   the limit, because otherwise two people would spend the last use
 *              of a single-use code at the same instant.
 *   abandoned  a checkout nobody came back to. Since 0033 it counts against
 *              NOTHING, and the next code anybody types hands it back.
 *
 * That last row is the fix to what was reported. A closed tab used to sit here
 * as "1 held, 4 left" of a five-claim code until the next person anywhere on
 * the platform happened to type a code - so the codes list told the owner a
 * claim had been taken that never was, and it kept telling him.
 *
 * There is no customer-facing list anywhere, by design: RLS keeps the table to
 * super admins, and a code is checked one at a time through validate_coupon.
 * A code only exists for someone once it has been handed to them.
 */

const COUPONS_PER_PAGE = 25;

export async function CouponsTab({ params }: { params: RewardParams }) {
  const admin = getSupabaseAdmin();
  const [all, settings] = await Promise.all([loadCoupons(admin), loadSettings(admin)]);

  const family = parseCouponFamily(params.kind);
  const coupons = family ? all.filter((coupon) => couponFamily(coupon.kind) === family) : all;

  // Clamped to what exists, so deleting the last code on page 3 lands on the
  // last page there is rather than on an empty table.
  const page = pageFromParam(params.cp, pageCount(coupons.length, COUPONS_PER_PAGE));

  // Totals across every code in the current classification, not just the page
  // listed - the same approach the History tab takes to payments, and for the
  // same reason: a figure that changes when you turn the page answers nothing.
  const live = coupons.filter((coupon) => couponInactiveReason(coupon) === null).length;
  const used = coupons.reduce((sum, coupon) => sum + Number(coupon.used ?? 0), 0);
  const holding = coupons.reduce((sum, coupon) => sum + Number(coupon.holding ?? 0), 0);
  const abandoned = coupons.reduce((sum, coupon) => sum + Number(coupon.abandoned ?? 0), 0);
  const given = coupons.reduce((sum, coupon) => sum + Number(coupon.discount_given ?? 0), 0);
  const listTotal = coupons.reduce((sum, coupon) => sum + Number(coupon.list_total ?? 0), 0);
  /* Read from the view rather than worked out here as value x used. It was
     computed in two places on this screen - the card and the delete warning -
     and two copies of one sum is two chances to be wrong about what a giveaway
     cost. 0033 moved it to coupon_usage.credits_given. */
  const creditsGiven = coupons.reduce(
    (sum, coupon) => sum + Number(coupon.credits_given ?? 0),
    0,
  );

  const rows = pageSlice(coupons, page, COUPONS_PER_PAGE);

  // The pager carries the section and the classification, so turning a page
  // does not fall back to the first tab or quietly widen the filter.
  const pagerParams = { section: "coupons", kind: params.kind, cp: page };

  const familyHref = (key: string | undefined) =>
    `${REWARDS_PATH}?${queryString({ section: "coupons", kind: key })}`;

  return (
    <>
      {/*
       * Two payouts on two cards rather than one card that switches unit.
       *
       * The old single "Handed out" card printed credits when there were any
       * and rupees otherwise, so the figure on it changed meaning depending on
       * which sorts of code happened to have been claimed - and there is no
       * label that makes that safe to read at a glance.
       */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={family ? "Of these, live now" : "Codes live now"}
          value={fmtNumber(live)}
          sub={
            coupons.length === 0
              ? "No codes made yet"
              : coupons.length === live
                ? `Every one of your ${fmtNumber(coupons.length)} codes`
                : `${fmtNumber(coupons.length - live)} switched off, expired or not started`
          }
          tone={live > 0 ? "brand" : "neutral"}
          icon={<Ticket size={15} />}
        />
        <StatCard
          label="Claims settled"
          value={fmtNumber(used)}
          sub={
            holding > 0 || abandoned > 0
              ? [
                  holding > 0 ? `${fmtNumber(holding)} at a checkout` : null,
                  abandoned > 0 ? `${fmtNumber(abandoned)} abandoned, counting for nothing` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Nothing is sitting on an unpaid claim"
          }
          tone={holding > 0 ? "warn" : "neutral"}
          icon={<Hourglass size={15} />}
        />
        <StatCard
          label="Taken off prices"
          value={fmtRupees(given)}
          sub={
            given > 0
              ? `off ${fmtRupees(listTotal)} of list prices`
              : "No discount code has been claimed yet"
          }
          icon={<Wallet size={15} />}
        />
        <StatCard
          label="Credits given away"
          value={formatCredits(creditsGiven)}
          sub={
            creditsGiven > 0
              ? "free credits from bonus codes"
              : "No credit code has been claimed yet"
          }
          icon={<Coins size={15} />}
        />
      </div>

      {/* A code is only worth something if there is a checkout to type it into.
          Same warning the credit rules tab carries, for the same reason. Only
          the discount half is affected: a credit code is claimed without any
          payment at all, which is the distinction this tab exists to keep. */}
      {settings.razorpayEnabled ? null : (
        <p className="mb-4 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="text-warn-500">Online payment is switched off.</span> Discount codes can
          be written and edited here, but nothing can be bought, so none of them can be claimed.
          Free credit codes still work — they need no payment. Turn it on in{" "}
          <Link href="/admin/settings" className="text-brand-400 hover:underline">
            settings
          </Link>
          .
        </p>
      )}

      {/*
       * The classification and the New code button on ONE row from sm up.
       *
       * They were a lone right-aligned button on a line of its own, which on a
       * 1280 screen is 958px of panel spent on one 96px control. The filter is
       * links rather than a select: it is the only control here, it costs no
       * JavaScript, and a classified list stays a link somebody can send.
       */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Which sort of code"
          className="flex flex-wrap items-center gap-1.5"
        >
          {[{ key: undefined, label: "All codes", hint: null }, ...COUPON_FAMILIES].map(
            (option) => {
              const on = (option.key ?? undefined) === family;
              return (
                <Link
                  key={option.key ?? "all"}
                  href={familyHref(option.key)}
                  aria-current={on ? "true" : undefined}
                  title={option.hint ?? undefined}
                  className={cx(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium whitespace-nowrap transition",
                    on
                      ? "border-brand-500 bg-brand-500/10 text-brand-500"
                      : "border-line text-muted hover:bg-sunken hover:text-ink",
                  )}
                >
                  {option.key === "credit" ? <Coins size={13} /> : null}
                  {option.key === "discount" ? <Wallet size={13} /> : null}
                  {option.label}
                  <span className="tabular-nums opacity-70">
                    {fmtNumber(
                      option.key
                        ? all.filter((coupon) => couponFamily(coupon.kind) === option.key).length
                        : all.length,
                    )}
                  </span>
                </Link>
              );
            },
          )}
        </div>

        <NewCouponButton />
      </div>

      <Panel
        className="mb-6"
        title={
          family
            ? (COUPON_FAMILIES.find((option) => option.key === family)?.label ?? "Every code")
            : "Every code"
        }
        description={
          family === "credit"
            ? "Claimed on their own, under “Have a credit code?”, with nothing bought. A credit code is refused at a checkout: it is not a discount and never was."
            : family === "discount"
              ? "Typed at a checkout, where they reduce what is paid. They never reduce the credits received — those come from the price before the discount."
              : "Live codes first, newest first within that. A claim is held from the moment a checkout opens, so one code cannot be spent twice at once — but a checkout the customer walked away from is handed back and counts for nothing, and never blocks that customer's own next try."
        }
        bodyClassName="p-0"
      >
        {coupons.length === 0 ? (
          <EmptyState
            title={family === "credit" ? "No free credit codes yet" : "No discount codes yet"}
            description={
              family === "credit"
                ? "A credit code hands over credits with nothing bought. It takes no money off any price, so it is claimed on the customer's own plan page rather than at a checkout."
                : "A code takes money off what somebody pays. It never takes credits off what they get — those are worked out from the price before the discount."
            }
            action={
              family ? (
                <Link href={familyHref(undefined)}>Show every code</Link>
              ) : (
                <NewCouponButton />
              )
            }
          />
        ) : (
          <>
            <TableWrap>
              {/* whitespace-nowrap, the way DataTable writes its own headers.
                  Without it "What it does" stacked into three lines inside a
                  narrow column on a phone and dragged every row down with it. */}
              <Thead>
                <th className="th whitespace-nowrap">Code</th>
                <th className="th whitespace-nowrap">What it does</th>
                <th className="th whitespace-nowrap">Claims</th>
                <th className="th whitespace-nowrap text-right">Handed out</th>
                <th className="th whitespace-nowrap">Status</th>
                <th className="th whitespace-nowrap text-right">Manage</th>
              </Thead>
              <Tbody>
                {rows.map((coupon) => (
                  <CodeRow key={coupon.id} coupon={coupon} />
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

function CodeRow({ coupon }: { coupon: CouponRow }) {
  const reason = couponInactiveReason(coupon);
  const exhausted = coupon.claims_left === 0;
  const payout = couponPayout(coupon);
  const holds = describeHolds(coupon);
  const credit = couponFamily(coupon.kind) === "credit";

  return (
    <Tr>
      <td className="td whitespace-nowrap">
        <Mono className="font-semibold text-ink">{coupon.code}</Mono>
        {/* The family on every row, not only when it is filtered to. The
            "Handed out" cell four columns along reads in rupees or in credits
            depending on this, and a reader should not have to remember which
            code was which to know which unit they are looking at. */}
        <span className="mt-1 block">
          <Badge tone={credit ? "brand" : "neutral"}>
            {credit ? <Coins size={11} /> : <Wallet size={11} />}
            {couponFamilyLabel(coupon.kind)}
          </Badge>
        </span>
      </td>

      {/* No width cap from lg up. It was max-w-xs at every width, so on a 1280
          screen "50% off, credit top-ups only" wrapped to three lines inside
          153px while the Manage column beside it held 361px it did not need. */}
      <td className="td">
        <span className="block max-w-xs text-sm text-ink lg:max-w-none">
          {describeCoupon(coupon)}
        </span>
        <span className="mt-0.5 block text-xs text-faint">{limitsLine(coupon)}</span>
      </td>

      <td className="td">
        <span className="block text-sm whitespace-nowrap text-ink">{describeClaims(coupon)}</span>
        {/*
         * Holds are never folded into claimed, and a live hold is never folded
         * into an abandoned one. An admin reading "4 of 5 claimed" with nothing
         * in the payments list is looking at holds, and the difference has to
         * be on the row rather than in a footnote.
         */}
        {holds ? (
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {coupon.holding > 0 ? (
              <Badge tone="warn">
                <Hourglass size={11} />
                {fmtNumber(coupon.holding)} at a checkout
              </Badge>
            ) : null}
            {coupon.abandoned > 0 ? (
              <Badge tone="neutral">{fmtNumber(coupon.abandoned)} abandoned</Badge>
            ) : null}
            {coupon.claims_left !== null ? (
              <span className="text-xs whitespace-nowrap text-faint">
                {fmtNumber(coupon.claims_left)} left
              </span>
            ) : null}
          </span>
        ) : exhausted ? (
          <span className="mt-0.5 block text-xs text-warn-500">Nothing left to claim</span>
        ) : coupon.accounts > 0 ? (
          <span className="mt-0.5 block text-xs whitespace-nowrap text-faint">
            {fmtNumber(coupon.accounts)} account{coupon.accounts === 1 ? "" : "s"}
          </span>
        ) : null}
      </td>

      {/* The payout, in whichever unit this code actually pays in. A bonus code
          writes nothing to discount_inr, so reading only that showed TOPUP500 -
          which had handed over 500 credits - as a dash. */}
      <td className="td text-right text-sm font-medium tabular-nums text-ink">
        {payout.amount > 0 ? (
          <>
            {payout.text}
            {payout.against ? (
              <span className="mt-0.5 block text-xs font-normal whitespace-nowrap text-faint">
                {payout.against}
              </span>
            ) : null}
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
        {/*
         * flex-nowrap, and the two rare controls carry their icon alone.
         *
         * Four labelled buttons need about 420px. They had 361 and wrapped onto
         * a second line, which is what made every row 103px tall on a desktop
         * screen - and the width they were taking came out of the column that
         * says what the code actually does. The two that stay labelled are the
         * two anybody clicks; switching off and deleting keep a spoken label
         * and a tooltip, so nothing is lost to a screen reader or to a hover.
         */}
        <div className="flex flex-nowrap items-center justify-end gap-1.5">
          {/* Straight to the claims report, filtered to this code and to its
              own family, so a credit code lands on a screen already reading in
              credits. This used to open a panel at the foot of this page, which
              was a second and worse copy of that report: it spoke only in
              rupees, so a credit_bonus code showed a row of zeroes. */}
          <LinkButton
            href={`${REWARDS_PATH}?${queryString({
              section: "coupon-claims",
              code: coupon.code,
              kind: couponFamily(coupon.kind),
              group: "none",
              range: "all",
            })}`}
            variant="ghost"
            size="sm"
            className="shrink-0"
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
            className="shrink-0"
          >
            <SubmitButton variant="ghost" size="sm">
              {coupon.is_active ? <Power size={13} /> : <RotateCcw size={13} />}
              <span className="sr-only">
                {coupon.is_active ? `Switch off ${coupon.code}` : `Switch on ${coupon.code}`}
              </span>
            </SubmitButton>
          </InlineActionForm>

          <InlineActionForm
            action={deleteCoupon}
            hidden={{ coupon_id: coupon.id }}
            className="shrink-0"
          >
            <ConfirmSubmitButton message={deleteWarning(coupon)}>
              <Trash2 size={13} />
              <span className="sr-only">Delete {coupon.code}</span>
            </ConfirmSubmitButton>
          </InlineActionForm>
        </div>
      </td>
    </Tr>
  );
}

/** "once per person · 1 Sep 2026 to 30 Sep 2026" - the rules describeCoupon leaves out. */
function limitsLine(coupon: CouponRow): string {
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
function deleteWarning(coupon: CouponRow): string {
  const parts = [`Delete the code ${coupon.code}?`];
  const payout = couponPayout(coupon);

  if (coupon.used > 0) {
    parts.push(
      payout.credits
        ? `Its ${coupon.used} claim${coupon.used === 1 ? "" : "s"} are deleted with it, so the record of ${payout.text} credits already granted is lost. The credits themselves stay in the accounts that got them.`
        : `Its ${coupon.used} redemption${coupon.used === 1 ? "" : "s"} are deleted with it, so the record of ${payout.text} already discounted is lost. The payments themselves keep their amounts.`,
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
      title="Create a code"
      description="Pick which sort it is first — a discount off a payment, or free credits claimed on their own. The worked example inside shows what it does to a real order."
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
