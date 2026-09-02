"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowUp,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  TicketPercent,
  Truck,
  Wallet,
  X,
} from "lucide-react";

import { Field, Input } from "@/components/form";
import { buttonClass, Badge, cx, Panel } from "@/components/ui";
import {
  confirmCheckout,
  previewCoupon,
  startCheckout,
  startPlanCheckout,
  type CheckoutStart,
} from "@/app/portal/plan/checkout-actions";
// Only the pure formatters. The service-role helpers in the same module are
// never referenced here, so nothing privileged is constructed in the browser.
//
// bonusPercent is aliased on the way in: it compares two fixed packs by value,
// and has nothing to do with the credit_percent an open tier carries. Two
// different ideas that would otherwise share a name on the same card.
import {
  bonusPercent as valueAgainstEntryPack,
  creditsForAmount,
  formatCredits,
  rupeesPerCredit,
} from "@/lib/credits";
import { friendlyError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import type { CouponVerdict, CreditPack, Plan } from "@/lib/types";

/**
 * The two things that can be bought, sharing one payment window.
 *
 * A plan is what a new account buys first - it decides how many trucks may be
 * watched and hands over a batch of credits. Credits are the top-up for an
 * account that already has a plan: when the credits run out you buy more of
 * them, not another copy of the plan.
 *
 * Both live in this file so the Razorpay script loader, the start/confirm dance
 * and the discount code box exist once. Splitting them would mean two copies of
 * the one piece of this code that is easy to get subtly wrong.
 */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Terms a plan can be bought for. Mirrors ALLOWED_MONTHS in checkout-actions.ts. */
export const PLAN_MONTHS = [1, 3, 6, 12] as const;

type Handshake = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
};

type CheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  handler: (response: Handshake) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
};

type CheckoutInstance = {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => CheckoutInstance;
  }
}

/** Shared across every card, so two clicks cannot each append a script tag. */
let scriptLoad: Promise<void> | null = null;

/**
 * Razorpay's checkout is roughly 100KB that most visits to this page never
 * need, so it is fetched on the first click rather than at page load.
 */
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptLoad) return scriptLoad;

  const pending = new Promise<void>((resolve, reject) => {
    const failed = () =>
      reject(new Error("The payment window could not be loaded. Check your connection."));

    // A tag from an earlier attempt that is still in flight: wait on it instead
    // of adding a second one.
    const existing = document.querySelector<HTMLScriptElement>(`script[data-razorpay="checkout"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", failed, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.dataset.razorpay = "checkout";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", failed, { once: true });
    document.head.appendChild(script);
  });

  scriptLoad = pending;
  // A failed load must not poison every later attempt with the same rejection.
  pending.catch(() => {
    scriptLoad = null;
  });

  return pending;
}

/* -------------------------------------------------------------------------- */
/* discount codes                                                              */
/* -------------------------------------------------------------------------- */

/** What a code takes off one price. Both figures came back from the server. */
type Cut = { discountInr: number; payableInr: number };

/**
 * Nothing in this file works a discount out.
 *
 * The cap, the minimum spend, the claim limits and which purchases a code is
 * good for all live in the database. A second copy of those rules in the
 * browser would be a second answer, and one of them would disagree with the one
 * that takes the money. So every figure shown comes back from previewCoupon,
 * one price at a time.
 *
 * Prices are their own keys, so two cards at the same price ask once.
 */
const priceKey = (amount: number) => amount.toFixed(2);

/** Rounded the way the server rounds, so both sides ask about one figure. */
const rupees = (amount: number) => Math.round(amount * 100) / 100;

/**
 * Every distinct price on a grid, as one string. Amounts arrive as a fresh array
 * on every render, so the effect below watches this instead - otherwise it would
 * re-ask the server on every keystroke anywhere on the page.
 */
function pricesKey(amounts: number[]): string {
  return Array.from(new Set(amounts.filter((amount) => amount > 0).map(priceKey))).join("|");
}

async function askAbout(
  code: string,
  kind: "credits" | "plan",
  amounts: number[],
): Promise<Record<string, CouponVerdict>> {
  const answers = await Promise.all(
    amounts.map(async (amount) => {
      const fd = new FormData();
      fd.set("coupon_code", code);
      fd.set("kind", kind);
      fd.set("amount_inr", String(amount));
      return [priceKey(amount), await previewCoupon(null, fd)] as const;
    }),
  );
  return Object.fromEntries(answers);
}

/**
 * When a code applies nowhere, the refusal worth showing is the one for the
 * largest price. That is the most favourable case, so a minimum-spend message
 * from there names a threshold the buyer genuinely cannot reach here, rather
 * than one they could clear by picking a bigger pack.
 */
function bestRefusal(verdicts: Record<string, CouponVerdict>): string | null {
  const refusal = Object.entries(verdicts)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([, verdict]) => verdict)
    .find((verdict) => !verdict.ok);
  return refusal?.message ?? null;
}

/**
 * A code, and what it does to each price on screen.
 *
 * Both grids use this, because both sell something a code can apply to and
 * neither should own its own copy of the apply/remove/re-price dance.
 *
 * `listAmounts` is every list price the grid is showing. It has to be re-asked
 * whenever those change - a different pack, a different term, a different figure
 * typed into the open tier - because a minimum spend can stop applying. A code
 * that silently stops counting while the buyer is still looking at the old total
 * is the worst thing this could do to them.
 */
function useCoupon(kind: "credits" | "plan", listAmounts: number[]) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  /** The code the verdicts below belong to. Null means nothing is applied. */
  const [applied, setApplied] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, CouponVerdict>>({});
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Which prices the verdicts above were worked out for. */
  const [pricedFor, setPricedFor] = useState("");

  const amountKey = pricesKey(listAmounts);

  useEffect(() => {
    if (!applied) return;
    // Already answered for exactly these prices - applying a code asks once,
    // and this must not ask a second time for the same figures.
    if (pricedFor === amountKey) return;

    const amounts = amountKey ? amountKey.split("|").map(Number) : [];
    if (amounts.length === 0) return;

    let live = true;
    // A moment's wait: this fires on every keystroke in the open tier's amount
    // box, and each pass is a round trip on somebody's phone.
    const timer = setTimeout(() => {
      setChecking(true);
      void askAbout(applied, kind, amounts)
        .then((next) => {
          if (!live) return;
          setVerdicts(next);
          setPricedFor(amountKey);
          // The code stays applied either way. It has not gone away, it just
          // does nothing at this amount, and each card says so for itself.
          setMessage(
            Object.values(next).some((verdict) => verdict.ok) ? null : bestRefusal(next),
          );
        })
        .catch((error: unknown) => {
          // Only for the unexpected. A refusal is a verdict, and its wording is
          // already written for a customer.
          if (live) setMessage(friendlyError(error));
        })
        .finally(() => {
          if (live) setChecking(false);
        });
    }, 400);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [applied, amountKey, pricedFor, kind]);

  async function apply() {
    const code = typed.trim().toUpperCase();
    if (!code) {
      setMessage("Enter a code.");
      return;
    }

    const amounts = amountKey ? amountKey.split("|").map(Number) : [];
    if (amounts.length === 0) {
      setMessage("Choose what you are buying first, then apply the code.");
      return;
    }

    setChecking(true);
    setMessage(null);

    try {
      const next = await askAbout(code, kind, amounts);
      if (Object.values(next).some((verdict) => verdict.ok)) {
        setApplied(code);
        setVerdicts(next);
        setPricedFor(amountKey);
      } else {
        // It buys nothing anywhere, so the prices stay as they were and the
        // reason is shown exactly as the server worded it.
        setApplied(null);
        setVerdicts({});
        setPricedFor("");
        setMessage(bestRefusal(next));
      }
    } catch (error) {
      setMessage(friendlyError(error));
    } finally {
      setChecking(false);
    }
  }

  /** Back to full price, with the box left open to try another code. */
  function remove() {
    setApplied(null);
    setVerdicts({});
    setPricedFor("");
    setMessage(null);
    setTyped("");
  }

  /**
   * The server refused the code as the order was being opened - the last claim
   * went to someone else, or the amount changed under it. The prices go back to
   * full rather than the buyer being charged one thing while shown another, and
   * what they typed is kept so they can see what was refused.
   */
  function refused(reason: string) {
    setApplied(null);
    setVerdicts({});
    setPricedFor("");
    setOpen(true);
    setMessage(reason);
  }

  function verdictFor(amount: number): CouponVerdict | undefined {
    return applied ? verdicts[priceKey(amount)] : undefined;
  }

  return {
    fieldId: `coupon${uid}`,
    open,
    typed,
    applied,
    checking,
    message,
    reveal: () => setOpen(true),
    setTyped,
    apply,
    remove,
    refused,
    cutFor(amount: number): Cut | null {
      const verdict = verdictFor(amount);
      if (!verdict?.ok) return null;
      return {
        discountInr: Number(verdict.discount_inr),
        payableInr: Number(verdict.payable_inr),
      };
    },
    /** Why the code does nothing at this price, in the server's own words. */
    whyNot(amount: number): string | null {
      const verdict = verdictFor(amount);
      return verdict && !verdict.ok ? verdict.message : null;
    },
    /** Sent with the purchase, so the code survives into the order. */
    formValue: applied ?? "",
  };
}

type CouponBox = ReturnType<typeof useCoupon>;

/**
 * "Have a code?", collapsed. Most people arriving here do not have one, and a
 * code box on the common path only invites a hunt for a code that does not
 * exist. One tap opens it, and it stays open once something is applied.
 */
function CouponField({ coupon, disabled }: { coupon: CouponBox; disabled: boolean }) {
  // Nothing can be bought, so there is nothing to discount.
  if (disabled) return null;

  if (!coupon.open && !coupon.applied) {
    return (
      <button
        type="button"
        onClick={coupon.reveal}
        className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-brand-500 transition hover:bg-sunken"
      >
        <TicketPercent size={14} />
        Have a code?
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-line bg-panel p-3">
      {coupon.applied ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Badge tone="good">
            <TicketPercent size={10} />
            {coupon.applied}
          </Badge>
          <span className="text-xs text-muted">
            {coupon.checking ? "Working out the new total..." : "applied to the prices below"}
          </span>
          <button
            type="button"
            onClick={coupon.remove}
            className={buttonClass("ghost", "sm", "ml-auto")}
          >
            <X size={13} />
            Remove
          </button>
        </div>
      ) : (
        /* Stacked on a phone, side by side once there is room: a code box and
           its button squeezed onto one narrow line are both hard to hit. */
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Discount code" name={coupon.fieldId} className="min-w-0 flex-1">
            <Input
              id={coupon.fieldId}
              type="text"
              value={coupon.typed}
              placeholder="SAVE20"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={coupon.checking}
              onChange={(event) => coupon.setTyped(event.target.value)}
              onKeyDown={(event) => {
                // There is no surrounding form for the phone keyboard's Enter
                // to submit, so it applies the code itself.
                if (event.key === "Enter") {
                  event.preventDefault();
                  void coupon.apply();
                }
              }}
              className="uppercase"
            />
          </Field>
          <button
            type="button"
            onClick={() => void coupon.apply()}
            disabled={coupon.checking || coupon.typed.trim() === ""}
            className={buttonClass("secondary", "md", "w-full sm:w-auto")}
          >
            {coupon.checking ? <Loader2 size={14} className="animate-spin" /> : null}
            {coupon.checking ? "Checking..." : "Apply"}
          </button>
        </div>
      )}

      {coupon.message ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-bad-500">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{coupon.message}</span>
        </p>
      ) : null}

      {coupon.applied ? (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          A code lowers what you pay. The credits you receive are worked out from the full price, so
          they do not change.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A price, and the discounted one above it when a code applies. The struck
 * figure stays small: what is actually payable is the number being decided on.
 */
function Price({
  listInr,
  cut,
  className,
  figureClass,
}: {
  listInr: number;
  cut: Cut | null;
  className?: string;
  figureClass: string;
}) {
  return (
    <div className={className}>
      {cut ? (
        <p className="text-[11px] tabular-nums text-faint line-through">{fmtRupees(listInr)}</p>
      ) : null}
      <p className={cx("tabular-nums", figureClass)}>
        {fmtRupees(cut ? cut.payableInr : listInr)}
      </p>
    </div>
  );
}

/**
 * The line under a price once a code is in play: what came off, or why nothing
 * did. "Same credits" is repeated on every card on purpose - it is the one
 * thing a buyer wants confirmed at the moment they are about to pay less.
 */
function CodeNote({
  cut,
  whyNot,
  keeps = "credits",
}: {
  cut: Cut | null;
  whyNot: string | null;
  /** What the discount does not touch: the credits, or the whole plan. */
  keeps?: string;
}) {
  if (cut) {
    return (
      <p className="mt-0.5 text-[11px] leading-relaxed tabular-nums text-good-500">
        {fmtRupees(cut.discountInr)} off · same {keeps}
      </p>
    );
  }
  if (whyNot) {
    return <p className="mt-0.5 text-[11px] leading-relaxed text-warn-500">{whyNot}</p>;
  }
  return null;
}

/**
 * Start the order, open the payment window, confirm what comes back. The only
 * thing that differs between a pack and a plan is which action opens the order,
 * so that is the only thing the caller passes in.
 */
function useCheckout(brandName: string, onPaid?: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function confirm(handshake: Handshake) {
    const fd = new FormData();
    fd.set("razorpay_order_id", handshake.razorpay_order_id ?? "");
    fd.set("razorpay_payment_id", handshake.razorpay_payment_id ?? "");
    fd.set("razorpay_signature", handshake.razorpay_signature ?? "");

    try {
      const result = await confirmCheckout(null, fd);
      if (result.ok) {
        setNotice(result.message ?? "Payment received.");
        // The claim is spent now, so leaving the code applied would price the
        // next top-up against something the buyer can no longer use.
        onPaid?.();
      } else setError(result.error);
    } catch {
      // The money has very likely arrived - only our confirmation call did not
      // get through. The webhook settles it either way, so do not alarm anyone.
      setNotice("Payment received. Your account will update in a moment.");
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  /** `key` is whichever card was clicked, so only that button shows a spinner. */
  async function pay(
    key: string,
    start: () => Promise<CheckoutStart>,
    onCouponRefused?: (reason: string) => void,
  ) {
    setError(null);
    setNotice(null);
    setBusy(key);

    try {
      const started = await start();
      if (!started.ok) {
        // A refused code is the one failure here the buyer can fix themselves,
        // so its message belongs beside the code box rather than under the grid
        // as a general "could not start payment".
        if (started.couponRefused && onCouponRefused) onCouponRefused(started.error);
        else setError(started.error);
        setBusy(null);
        return;
      }

      await loadCheckoutScript();
      const Checkout = window.Razorpay;
      if (!Checkout) throw new Error("The payment window could not be loaded.");

      const checkout = new Checkout({
        key: started.keyId,
        order_id: started.orderId,
        // The discounted figure, because that is what the order was opened for.
        amount: Math.round(started.amountInr * 100),
        currency: "INR",
        name: brandName,
        description: `${started.itemName} — ${started.itemDetail}${
          started.couponCode ? ` — code ${started.couponCode}` : ""
        }`,
        handler: (handshake) => {
          void confirm(handshake);
        },
        modal: {
          ondismiss: () => {
            // Nothing to undo. The payment row stays 'created', so if money did
            // move the webhook still settles it.
            setBusy(null);
          },
        },
        // Razorpay's window is its own document, so it cannot read our theme
        // variables - this is the same blue as --c-brand-500.
        theme: { color: "#2563eb" },
      });

      checkout.on("payment.failed", () => {
        setBusy(null);
        setError("That payment did not go through. Nothing was charged - you can try again.");
      });

      checkout.open();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(null);
    }
  }

  return { busy, error, notice, pay };
}

/** The two outcomes of a purchase, shown under whichever grid was used. */
function Outcome({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;
  return (
    <p
      className={cx(
        "mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        error
          ? "border-bad-500/40 bg-bad-500/10 text-bad-500"
          : "border-good-500/40 bg-good-500/10 text-good-500",
      )}
    >
      {error ? (
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
      ) : (
        <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
      )}
      <span>{error ?? notice}</span>
    </p>
  );
}

function Locked({ reason }: { reason: string }) {
  return (
    <p className="mb-3 flex items-start gap-2.5 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-sm leading-relaxed text-warn-500">
      <Info size={15} className="mt-0.5 shrink-0" />
      <span>{reason}</span>
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* plans                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A truck limit as a number that compares. -1 is stored for "no limit", and
 * left as it is that sorts below every real limit - which would label the
 * unlimited plan a downgrade from a five-truck one.
 */
function slots(truckLimit: number): number {
  return truckLimit === -1 ? Number.POSITIVE_INFINITY : truckLimit;
}

/**
 * What moving to this plan would do to the truck limit, or null when it would
 * do nothing to it.
 *
 * This is the entire content of "is this an upgrade". A plan decides how many
 * trucks may be watched at once; credits pay for the watching and are bought
 * separately. So the truck limit is the only reason to change plan, and saying
 * it on the card is what stops this grid reading as a second way to buy
 * credits.
 */
function truckChange(plan: Plan, current: Plan): { better: boolean; text: string } | null {
  const mine = slots(current.truck_limit);
  const theirs = slots(plan.truck_limit);

  if (theirs === mine) return null;
  if (theirs === Number.POSITIVE_INFINITY) return { better: true, text: "No truck limit at all" };
  if (mine === Number.POSITIVE_INFINITY) {
    return { better: false, text: `Capped at ${theirs}, where you have no limit now` };
  }
  return theirs > mine
    ? { better: true, text: `${theirs - mine} more trucks than your plan` }
    : { better: false, text: `${mine - theirs} fewer trucks than your plan` };
}

export function BuyPlans({
  plans,
  brandName,
  currentPlanId,
  currentPlan = null,
  disabledReason,
  /** True once a plan is running: the copy becomes about renewing, not starting. */
  renewing = false,
}: {
  plans: Plan[];
  brandName: string;
  currentPlanId: string | null;
  /**
   * The plan row the account is on, when it is still on sale. Only for working
   * out which cards are a bigger truck limit than the one they already have -
   * a grid that cannot tell an upgrade from a sideways move is the thing that
   * made this read as a second copy of the plan chooser.
   *
   * Null when there is no plan, or when the one they are on has been archived
   * and so is not in `plans`. Both fall back to the plain wording.
   */
  currentPlan?: Plan | null;
  disabledReason: string | null;
  renewing?: boolean;
}) {
  const [months, setMonths] = useState<number>(1);
  // Every total a code could apply to on this grid. A free plan has no order to
  // open, so it has no price to discount either.
  const coupon = useCoupon(
    "plan",
    plans
      .filter((plan) => plan.price_per_month > 0)
      .map((plan) => rupees(plan.price_per_month * months)),
  );
  const { busy, error, notice, pay } = useCheckout(brandName, coupon.remove);
  const locked = disabledReason !== null;

  if (plans.length === 0) {
    return (
      <Panel title="Plans">
        <p className="text-sm text-muted">
          No plans are on sale at the moment. Please check back shortly, or contact support.
        </p>
      </Panel>
    );
  }

  return (
    <div>
      {locked ? <Locked reason={disabledReason} /> : null}

      {/* One term for every card: choosing per card would put four controls on
          screen to answer the same question once. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Pay for</span>
        <div className="inline-flex rounded-lg border border-line bg-panel p-1">
          {PLAN_MONTHS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMonths(option)}
              aria-pressed={months === option}
              className={cx(
                "inline-flex min-h-8 items-center rounded-md px-2.5 text-xs font-medium tabular-nums transition",
                months === option
                  ? "bg-brand-500 text-on-brand"
                  : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              {option}m
            </button>
          ))}
        </div>
        {months > 1 ? (
          <span className="text-xs text-muted">Same price a month, fewer renewals.</span>
        ) : null}
      </div>

      <CouponField coupon={coupon} disabled={locked} />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const mine = plan.id === currentPlanId;
          const working = busy === plan.id;
          const total = rupees(plan.price_per_month * months);
          const cut = coupon.cutFor(total);
          // Nothing to charge for means no order to open, so say so on the card
          // rather than letting the click come back with a refusal.
          const buyable = plan.price_per_month > 0;
          // Only worth saying against a plan they are not already on, and only
          // when we know which one that is.
          const change = !mine && currentPlan ? truckChange(plan, currentPlan) : null;

          return (
            <li
              key={plan.id}
              className={cx(
                "flex flex-col rounded-xl border bg-panel p-4 transition",
                mine ? "border-brand-500/60 ring-1 ring-brand-500/20" : "border-line",
                !locked && !mine && "hover:border-line-strong",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-strong">{plan.name}</p>
                {mine ? (
                  <Badge tone="brand">Your plan</Badge>
                ) : change?.better ? (
                  <Badge tone="good">
                    <ArrowUp size={10} />
                    Upgrade
                  </Badge>
                ) : null}
              </div>

              {plan.description ? (
                <p className="mt-1 text-xs leading-relaxed text-muted">{plan.description}</p>
              ) : null}

              <Price
                listInr={total}
                cut={cut}
                className="mt-3"
                figureClass="text-2xl font-semibold text-strong"
              />
              <p className="mt-0.5 text-xs text-muted tabular-nums">
                {months === 1
                  ? "a month"
                  : `for ${months} months · ${fmtRupees(plan.price_per_month)} a month`}
              </p>
              <CodeNote cut={cut} whyNot={coupon.whyNot(total)} keeps="plan" />

              <ul className="mt-3 space-y-1.5 border-t border-divider pt-3 text-sm">
                <Feature icon={<Truck size={13} />}>
                  {plan.truck_limit === -1
                    ? "Unlimited trucks watched at once"
                    : `${plan.truck_limit} truck${plan.truck_limit === 1 ? "" : "s"} watched at once`}
                </Feature>
                <Feature icon={<Wallet size={13} />}>
                  {formatCredits(plan.included_credits)} credits included
                </Feature>
                <Feature icon={<Check size={13} />}>Top up credits any time</Feature>
              </ul>

              {/* The one line that turns a price list into a decision: what
                  this card would change about the account they already have.
                  Deliberately tone-coded rather than worded as a warning - a
                  smaller plan is a legitimate thing to want, it just must not
                  be bought by accident. */}
              {change ? (
                <p
                  className={cx(
                    "mt-2 text-[11px] leading-relaxed",
                    change.better ? "text-good-500" : "text-warn-500",
                  )}
                >
                  {change.text}
                </p>
              ) : null}

              <button
                type="button"
                disabled={locked || !buyable || busy !== null}
                onClick={() =>
                  void pay(
                    plan.id,
                    () => {
                      const fd = new FormData();
                      fd.set("plan_id", plan.id);
                      fd.set("months", String(months));
                      // The code goes with the purchase, so the server holds the
                      // claim and charges the figure the card was showing.
                      fd.set("coupon_code", coupon.formValue);
                      return startPlanCheckout(null, fd);
                    },
                    coupon.refused,
                  )
                }
                className={buttonClass(
                  mine || !renewing ? "primary" : "secondary",
                  "md",
                  "mt-4 w-full",
                )}
              >
                {working ? <Loader2 size={14} className="animate-spin" /> : null}
                {working
                  ? "Opening payment..."
                  : !buyable
                    ? "Contact support"
                    : locked
                      ? "Not available"
                      : mine
                        ? "Renew this plan"
                        : change?.better
                          ? "Upgrade to this"
                          : renewing
                            ? "Switch to this plan"
                            : "Choose this plan"}
              </button>
            </li>
          );
        })}
      </ul>

      <Outcome error={error} notice={notice} />
    </div>
  );
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed text-ink">
      <span className="mt-0.5 shrink-0 text-brand-500">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* credits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The credit shop. Packs are always shown, even when nothing can be bought, so
 * the price of a top-up is knowable before committing to a plan. `disabledReason`
 * is worked out on the server, because most of that decision - the payment
 * toggle and whether the keys exist - is not knowable in the browser.
 *
 * A pack is sold in one of two ways and the card has to say which. A fixed pack
 * is a price and a credit count. An open tier is a minimum and a rate: the
 * buyer types an amount and the credits follow, so showing its price_inr beside
 * its credits column would advertise a number nobody can buy.
 */
export function BuyCredits({
  packs,
  brandName,
  creditsPerRupee,
  disabledReason,
}: {
  packs: CreditPack[];
  brandName: string;
  /** The base rate, so an open tier can price itself as the buyer types. */
  creditsPerRupee: number;
  disabledReason: string | null;
}) {
  // What has been typed into each open tier, keyed by pack. Starts at the
  // minimum, so a card is never showing a refusal before anyone has touched it.
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      packs.filter((pack) => pack.is_open_ended).map((pack) => [pack.id, String(pack.price_inr)]),
    ),
  );

  /**
   * Every price a code could apply to. An open tier below its minimum has no
   * price yet - creditsForAmount says so by returning null - so it contributes
   * nothing to ask about until the buyer has typed enough.
   */
  const coupon = useCoupon(
    "credits",
    packs.map((pack) => {
      if (!pack.is_open_ended) return pack.price_inr;
      const asked = rupees(Number(amounts[pack.id] ?? ""));
      return creditsForAmount(pack, asked, creditsPerRupee) === null ? 0 : asked;
    }),
  );

  const { busy, error, notice, pay } = useCheckout(brandName, coupon.remove);

  // The value tiers are expressed against the smallest fixed pack, which is the
  // plain rate everything else improves on. An open tier is left out: its
  // credits column is not what it sells, so it has no rate to compare yet.
  const baseline = packs.reduce<CreditPack | undefined>((lowest, pack) => {
    if (pack.is_open_ended) return lowest;
    return !lowest || pack.price_inr < lowest.price_inr ? pack : lowest;
  }, undefined);

  const locked = disabledReason !== null;

  if (packs.length === 0) {
    return (
      <p className="text-sm text-muted">
        No credit packs are on sale at the moment. Contact support if you need more credits.
      </p>
    );
  }

  return (
    <div>
      {locked ? <Locked reason={disabledReason} /> : null}

      <CouponField coupon={coupon} disabled={locked} />

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {packs.map((pack) => {
          const working = busy === pack.id;
          const minimum = `Rs ${pack.price_inr.toLocaleString("en-IN")}`;

          /* ---------------------------------------------------------------- */
          /* open tier: the buyer sets the amount                              */
          /* ---------------------------------------------------------------- */
          if (pack.is_open_ended) {
            const typed = amounts[pack.id] ?? "";
            const amount = rupees(Number(typed));
            // null is the one honest answer below the minimum: there is nothing
            // to sell at that price, so no credit figure is quoted.
            const credits = creditsForAmount(pack, amount, creditsPerRupee);
            const tooLittle = credits === null;
            const cut = tooLittle ? null : coupon.cutFor(amount);
            const whyNot = tooLittle ? null : coupon.whyNot(amount);
            // What a single rupee buys on this tier. Said outright rather than
            // as a percentage: "250%" is only meaningful next to a base rate
            // the buyer has never been shown.
            const perRupee = (creditsPerRupee * (pack.credit_percent || 100)) / 100;

            return (
              <li
                key={pack.id}
                className={cx(
                  "col-span-2 flex flex-col rounded-xl border border-brand-500/40 bg-panel p-3 transition",
                  !locked && "hover:border-brand-500/60",
                )}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <p className="text-xs font-medium text-muted">{pack.name}</p>
                  {perRupee > 1 ? (
                    <Badge tone="good" className="px-1.5">
                      <Sparkles size={10} />
                      Rs 1 buys {formatCredits(perRupee)} credits
                    </Badge>
                  ) : null}
                </div>

                <Field label="Amount you want to pay (Rs)" name={`amount_${pack.id}`} className="mt-2">
                  <Input
                    id={`amount_${pack.id}`}
                    type="number"
                    inputMode="numeric"
                    min={pack.price_inr}
                    step="100"
                    value={typed}
                    disabled={locked}
                    onChange={(e) =>
                      setAmounts((current) => ({ ...current, [pack.id]: e.target.value }))
                    }
                    className="tabular-nums"
                  />
                </Field>

                <p className="mt-2 text-lg font-semibold tabular-nums text-brand-500">
                  {tooLittle ? "--" : formatCredits(credits)}
                  <span className="ml-1 text-xs font-normal text-muted">credits</span>
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                  {tooLittle
                    ? `Minimum ${minimum}. Type that or more.`
                    : `Minimum ${minimum}${
                        credits > 0 ? ` · Rs ${(amount / credits).toFixed(2)} each` : ""
                      }`}
                </p>

                {/* Spelled out in full here, because this is the one card where
                    the buyer chose the figure the discount comes off. */}
                {cut ? (
                  <p className="mt-1.5 text-xs leading-relaxed tabular-nums text-good-500">
                    {fmtRupees(amount)} − {fmtRupees(cut.discountInr)} ={" "}
                    <span className="font-semibold">{fmtRupees(cut.payableInr)}</span> to pay ·{" "}
                    {formatCredits(credits)} credits either way
                  </p>
                ) : whyNot ? (
                  <p className="mt-1.5 text-xs leading-relaxed text-warn-500">{whyNot}</p>
                ) : null}

                <button
                  type="button"
                  disabled={locked || tooLittle || busy !== null}
                  onClick={() =>
                    void pay(
                      pack.id,
                      () => {
                        const fd = new FormData();
                        fd.set("pack_id", pack.id);
                        // Sent so the server knows what was asked for. It prices
                        // the purchase itself either way - see startCheckout.
                        fd.set("amount_inr", typed);
                        fd.set("coupon_code", coupon.formValue);
                        return startCheckout(null, fd);
                      },
                      coupon.refused,
                    )
                  }
                  className={buttonClass("primary", "sm", "mt-3 w-full")}
                >
                  {working ? <Loader2 size={13} className="animate-spin" /> : null}
                  {working
                    ? "Opening..."
                    : locked
                      ? "Not available"
                      : tooLittle
                        ? `Minimum is ${minimum}`
                        : `Pay ${fmtRupees(cut ? cut.payableInr : amount)}`}
                </button>
              </li>
            );
          }

          /* ---------------------------------------------------------------- */
          /* fixed pack: a price and a credit count, both stated              */
          /* ---------------------------------------------------------------- */
          const betterValue = baseline ? valueAgainstEntryPack(pack, baseline) : 0;
          const cut = coupon.cutFor(pack.price_inr);

          return (
            <li
              key={pack.id}
              className={cx(
                "flex flex-col rounded-xl border border-line bg-panel p-3 transition",
                !locked && "hover:border-line-strong",
              )}
            >
              <div className="flex items-start justify-between gap-1.5">
                <p className="text-xs font-medium text-muted">{pack.name}</p>
                {betterValue > 0 ? (
                  <Badge tone="good" className="px-1.5">
                    <Sparkles size={10} />
                    {betterValue}%
                  </Badge>
                ) : null}
              </div>

              <p className="mt-1.5 text-lg font-semibold tabular-nums text-brand-500">
                {formatCredits(pack.credits)}
                <span className="ml-1 text-xs font-normal text-muted">credits</span>
              </p>
              <Price
                listInr={pack.price_inr}
                cut={cut}
                figureClass="text-sm font-medium text-strong"
              />
              <p className="mt-0.5 text-[11px] tabular-nums text-faint">
                Rs {rupeesPerCredit(pack).toFixed(2)} each
              </p>
              <CodeNote cut={cut} whyNot={coupon.whyNot(pack.price_inr)} />

              <button
                type="button"
                disabled={locked || busy !== null}
                onClick={() =>
                  void pay(
                    pack.id,
                    () => {
                      const fd = new FormData();
                      fd.set("pack_id", pack.id);
                      fd.set("coupon_code", coupon.formValue);
                      return startCheckout(null, fd);
                    },
                    coupon.refused,
                  )
                }
                className={buttonClass("primary", "sm", "mt-3 w-full")}
              >
                {working ? <Loader2 size={13} className="animate-spin" /> : null}
                {working
                  ? "Opening..."
                  : locked
                    ? "Not available"
                    : cut
                      ? `Pay ${fmtRupees(cut.payableInr)}`
                      : "Top up"}
              </button>
            </li>
          );
        })}
      </ul>

      <Outcome error={error} notice={notice} />
    </div>
  );
}
