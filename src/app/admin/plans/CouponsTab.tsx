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
import { BASE_PATH, type SectionParams } from "./TabStrip";
import {
  createCoupon,
  deleteCoupon,
  saveCoupon,
  setCouponActive,
} from "../credits/actions";
import { pageWindow } from "../pager";
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
  PanelAction,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import {
  couponInactiveReason,
  describeClaims,
  describeCoupon,
  loadCoupons,
  normaliseCode,
} from "@/lib/coupons";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CouponRedemption, CouponUsage } from "@/lib/types";

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
const REDEMPTIONS_PER_PAGE = 25;

export async function CouponsTab({ params }: { params: SectionParams }) {
  const admin = getSupabaseAdmin();
  const [coupons, settings] = await Promise.all([loadCoupons(admin), loadSettings(admin)]);

  // Clamped to what exists, so deleting the last code on page 3 lands on the
  // last page there is rather than on an empty table.
  const page = pageFromParam(params.cp, pageCount(coupons.length, COUPONS_PER_PAGE));
  const redPage = pageFromParam(params.red);

  // Totals across every code, not just the page listed - the same approach the
  // History tab takes to payments, and for the same reason: a figure that
  // changes when you turn the page answers nothing.
  const live = coupons.filter((coupon) => couponInactiveReason(coupon) === null).length;
  const used = coupons.reduce((sum, coupon) => sum + Number(coupon.used ?? 0), 0);
  const holding = coupons.reduce((sum, coupon) => sum + Number(coupon.holding ?? 0), 0);
  const given = coupons.reduce((sum, coupon) => sum + Number(coupon.discount_given ?? 0), 0);
  const listTotal = coupons.reduce((sum, coupon) => sum + Number(coupon.list_total ?? 0), 0);

  // The code is in the URL rather than its id, so a link to "who used SAVE20"
  // reads as what it is. It is already in memory, so resolving it costs nothing.
  const wanted = normaliseCode(params.code);
  const selected = wanted ? (coupons.find((coupon) => coupon.code === wanted) ?? null) : null;

  const rows = pageSlice(coupons, page, COUPONS_PER_PAGE);

  // Every pager carries the whole query string, so turning one page never drops
  // the open code or the other list's page number.
  const pagerParams = { tab: "coupons", code: selected?.code ?? null, cp: page, red: redPage };

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
          sub="Payments that actually settled at a discount"
          icon={<TicketCheck size={15} />}
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
          label="Discount given"
          value={fmtRupees(given)}
          sub={
            listTotal > 0
              ? `Off ${fmtRupees(listTotal)} of list prices`
              : "Nothing has been discounted yet"
          }
          icon={<IndianRupee size={15} />}
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
                <th className="th text-right">Discount given</th>
                <th className="th">Status</th>
                <th className="th text-right">Manage</th>
              </Thead>
              <Tbody>
                {rows.map((coupon) => (
                  <CouponRow
                    key={coupon.id}
                    coupon={coupon}
                    open={selected?.id === coupon.id}
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
              href={{ path: BASE_PATH, params: pagerParams, pageKey: "cp" }}
            />
          </>
        )}
      </Panel>

      {selected ? (
        <RedemptionsPanel coupon={selected} pageParam={params.red} couponsPage={page} />
      ) : coupons.length > 0 ? (
        <Panel title="Who used a code" bodyClassName="p-0">
          <EmptyState
            title="No code chosen"
            description="Pick one above and every claim on it is listed here, against the account that made it — what the order was worth, what came off, and whether the money ever arrived."
          />
        </Panel>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* one row of the code list                                                    */
/* -------------------------------------------------------------------------- */

function CouponRow({
  coupon,
  open,
  couponsPage,
}: {
  coupon: CouponUsage;
  /** True when this is the code whose redemptions are listed below. */
  open: boolean;
  couponsPage: number;
}) {
  const reason = couponInactiveReason(coupon);
  const exhausted = coupon.claims_left === 0;

  return (
    <Tr className={open ? "bg-brand-500/8" : undefined}>
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

      <td className="td text-right text-sm font-medium tabular-nums text-ink">
        {Number(coupon.discount_given) > 0 ? (
          <>
            {fmtRupees(Number(coupon.discount_given))}
            <span className="mt-0.5 block text-xs font-normal text-faint">
              off {fmtRupees(Number(coupon.list_total))}
            </span>
          </>
        ) : (
          <span className="text-faint">--</span>
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
          <LinkButton
            href={`${BASE_PATH}?tab=coupons&code=${encodeURIComponent(coupon.code)}${
              couponsPage > 1 ? `&cp=${couponsPage}` : ""
            }`}
            variant="ghost"
            size="sm"
          >
            <Users size={13} />
            {open ? "Listed below" : "Who used it"}
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
      `Its ${coupon.used} redemption${coupon.used === 1 ? "" : "s"} are deleted with it, so the record of ${fmtRupees(Number(coupon.discount_given))} already discounted is lost. The payments themselves keep their amounts.`,
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
/* who used one code                                                           */
/* -------------------------------------------------------------------------- */

const REDEMPTION_TONE = { applied: "good", reserved: "warn", released: "neutral" } as const;
const REDEMPTION_LABEL = {
  applied: "Used",
  reserved: "Held",
  released: "Handed back",
} as const;

async function RedemptionsPanel({
  coupon,
  pageParam,
  couponsPage,
}: {
  coupon: CouponUsage;
  /** The raw ?red=, clamped here once this code's claims have been counted. */
  pageParam: string | undefined;
  couponsPage: number;
}) {
  const admin = getSupabaseAdmin();

  // Counted before a page of claims is asked for, the same way the code list
  // above is clamped: PostgREST answers a range that starts past the last claim
  // with an error and no total, so a stale ?red= would show an empty panel with
  // nothing to click back to.
  const { count } = await admin
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", coupon.id);

  const total = count ?? 0;
  const { page, from, to } = pageWindow(pageParam, total, REDEMPTIONS_PER_PAGE);

  const { data } = await admin
    .from("coupon_redemptions")
    .select("*")
    .eq("coupon_id", coupon.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  const rows = (data ?? []) as CouponRedemption[];
  const nameOf = await namesFor(admin, rows.map((row) => row.user_id));

  return (
    <Panel
      title={`Who used ${coupon.code}`}
      description="Every claim on this code, newest first — including the ones that were held and handed back, because an abandoned checkout is worth seeing."
      actions={<PanelAction href={`${BASE_PATH}?tab=coupons`}>Clear</PanelAction>}
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <EmptyState
          title={
            total > 0
              ? "That page is past the end of the claims"
              : `Nobody has claimed ${coupon.code}`
          }
          description={
            total > 0
              ? "Use the page links below to get back."
              : "A row appears here the moment a checkout opens with this code, before any money arrives."
          }
        />
      ) : (
        <>
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Account</th>
              <th className="th text-right">Order before discount</th>
              <th className="th text-right">Came off</th>
              <th className="th">Status</th>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <td className="td whitespace-nowrap">
                    <span className="block text-sm text-ink">{fmtRelative(row.created_at)}</span>
                    <span className="block text-xs text-faint">{fmtDateTime(row.created_at)}</span>
                  </td>
                  <td className="td text-sm">
                    <Link
                      href={`/admin/officers/${row.user_id}`}
                      className="transition hover:text-brand-400"
                    >
                      {nameOf.get(row.user_id) ?? "--"}
                    </Link>
                  </td>
                  <td className="td text-right text-sm tabular-nums text-muted">
                    {fmtRupees(Number(row.amount_inr))}
                  </td>
                  <td className="td text-right text-sm font-medium tabular-nums text-brand-500">
                    {fmtRupees(Number(row.discount_inr))}
                  </td>
                  <td className="td">
                    <Badge tone={REDEMPTION_TONE[row.status]}>{REDEMPTION_LABEL[row.status]}</Badge>
                    {/* A held claim is the one an admin will ask about, so it
                        says what it is waiting for rather than only when it
                        started. */}
                    <span className="mt-0.5 block text-xs text-faint">
                      {row.status === "reserved"
                        ? "waiting on payment"
                        : row.settled_at
                          ? fmtRelative(row.settled_at)
                          : ""}
                    </span>
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        </>
      )}

      {/* Outside the branch above: a page with no claims on it is exactly when
          the reader needs the link back to the pages that have some. */}
      <Pager
        className="border-t border-divider px-5 py-3"
        page={page}
        total={total}
        pageSize={REDEMPTIONS_PER_PAGE}
        noun="claims"
        href={{
          path: BASE_PATH,
          params: { tab: "coupons", code: coupon.code, cp: couponsPage },
          pageKey: "red",
        }}
      />
    </Panel>
  );
}

/**
 * Names for the accounts on this page, by id.
 *
 * A lookup rather than an embedded join: the join would have to name the
 * foreign key, and a wrong name there fails as an empty table rather than as an
 * error. The History tab builds the same map for the same reason.
 */
async function namesFor(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();

  const { data } = await admin.from("profiles").select("id, email, full_name").in("id", ids);
  const people = (data ?? []) as { id: string; email: string; full_name: string | null }[];
  return new Map(people.map((person) => [person.id, person.full_name ?? person.email]));
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
