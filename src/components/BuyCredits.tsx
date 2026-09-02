"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  type CheckoutBuyer,
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
  /**
   * Fills Razorpay's own name / email / contact boxes. Built on the server from
   * the session - see CheckoutBuyer - and every key is optional because an
   * absent one must be omitted rather than sent blank.
   */
  prefill?: CheckoutBuyer;
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

/**
 * The brand blue, as a literal Razorpay can use.
 *
 * Their window is its own document and cannot read our custom properties, so
 * the colour has to be handed over rather than inherited. Read off the live
 * stylesheet instead of typed in here: the portal renders in the light theme
 * where --c-brand-500 is #2563eb, the dark one carries a different blue, and a
 * second copy of either in this file is a copy that goes stale the first time
 * the palette moves.
 */
const BRAND_FALLBACK = "#2563eb";

function brandColour(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--c-brand-500")
    .trim();
  // Razorpay wants a hex triplet and does nothing sensible with anything else.
  // A blank read before the stylesheet has landed, or an oklch() once the
  // palette moves on, is worth dropping - their own default is closer to right
  // than a colour they cannot parse.
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : BRAND_FALLBACK;
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
 * A credit code typed into the discount box, which is not what this box is for.
 *
 * Caught by name rather than left to the server, because validate_coupon() does
 * not refuse one. Its rupees-off branch is keyed on `flat`, so a credit_bonus
 * falls through to the percentage branch and a code worth 500 credits is read
 * as 500% off - clamped, in the end, to a rupee payable. Letting one reach
 * checkout would charge Rs 1 for a plan and grant no bonus credits at all,
 * because settle_payment only marks the claim applied.
 *
 * This is the honest-buyer path and not a defence: nothing on the server stops
 * the same code being posted directly. The fix belongs in validate_coupon.
 */
const BONUS_CODE_MESSAGE =
  'That is a credit code, not a discount. Enter it under "Have a credit code?" on this page and the credits go straight to your balance.';

function isBonusCode(verdicts: Record<string, CouponVerdict>): boolean {
  return Object.values(verdicts).some((verdict) => verdict.ok && verdict.kind === "credit_bonus");
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

      // Never applied, so formValue stays empty and the code cannot travel to
      // openOrder even if the buyer leaves it sitting in the box.
      if (isBonusCode(next)) {
        setApplied(null);
        setVerdicts({});
        setPricedFor("");
        setMessage(BONUS_CODE_MESSAGE);
        return;
      }

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
 *
 * It used to sit at the top of the page, above the cards, where it asked for a
 * code before there was anything to discount. It is rendered inside the pay
 * panel now - one tap from the button that spends the money, and beside the
 * total it changes.
 */
function CouponField({ coupon, className }: { coupon: CouponBox; className?: string }) {
  /* It used to take a `disabled` flag for "nothing can be bought, so there is
     nothing to discount". That is structural now: a locked grid has no card
     that can be chosen, so the panel this lives in never renders. */
  if (!coupon.open && !coupon.applied) {
    return (
      <button
        type="button"
        onClick={coupon.reveal}
        className={cx(
          "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-brand-500 transition hover:bg-sunken",
          className,
        )}
      >
        <TicketPercent size={14} />
        Have a code?
      </button>
    );
  }

  return (
    <div className={cx("rounded-xl border border-line bg-raised p-3", className)}>
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

      {/* The "same credits either way" reassurance used to live here. The total
          below now states what is paid and what is received as two rows of one
          sum, which says it where it is checked rather than a line above. */}
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

/* -------------------------------------------------------------------------- */
/* the total, and the button that spends it                                    */
/* -------------------------------------------------------------------------- */

/**
 * A purchase that has been picked but not yet paid for.
 *
 * The card buttons used to open Razorpay on the first tap, so the last figure
 * anybody saw before money was involved was a price on a card - never the sum
 * of it, and never the code's effect on it stated in full. A tap now fills this
 * in, and one panel states the list price, what the code takes off, what is
 * actually charged and what arrives afterwards.
 *
 * `start` is the closure the card used to call, so each grid goes on owning
 * what it sells and this panel holds no second copy of it.
 */
type Chosen = {
  /** The card, so the grid can mark which one is being bought. */
  key: string;
  name: string;
  detail: string;
  /** Before any code. The panel's arithmetic starts here. */
  listInr: number;
  /**
   * What the buyer actually gets, as one line. Worked out from the list price
   * and never from what is paid, which is the whole reason it is shown next to
   * the discount: a code that takes rupees off must visibly take nothing else.
   */
  receive: string;
  start: () => Promise<CheckoutStart>;
};

/** One row of the sum. */
function Sum({
  label,
  value,
  tone = "plain",
  /** The row the decision is made on: the figure that will leave the account. */
  strong = false,
}: {
  label: string;
  value: string;
  tone?: "plain" | "good" | "brand";
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cx("text-xs", strong ? "font-medium text-ink" : "text-muted")}>{label}</dt>
      <dd
        className={cx(
          "shrink-0 tabular-nums",
          strong ? "text-lg font-semibold text-strong" : "text-xs",
          tone === "good" && "text-good-500",
          tone === "brand" && "text-brand-500",
          tone === "plain" && !strong && "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The last thing on screen before Razorpay: what is being bought, the code box,
 * the sum, and one button carrying the figure it will charge.
 *
 * The code box lives in here rather than above the grid because a discount code
 * needs something to discount - asked for first, it invited a hunt for a code
 * before the buyer had even chosen a pack, and its effect appeared four inches
 * away from the button that spent the money.
 */
function PayPanel({
  chosen,
  coupon,
  busy,
  onPay,
  onCancel,
}: {
  chosen: Chosen;
  coupon: CouponBox;
  /** Which card is mid-checkout, so only this button spins. */
  busy: string | null;
  onPay: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cut = coupon.cutFor(chosen.listInr);
  const whyNot = coupon.whyNot(chosen.listInr);
  const payable = cut ? cut.payableInr : chosen.listInr;
  const working = busy === chosen.key;

  /* On a phone the grid is taller than the screen, so a panel that appears
     under it appears out of sight. "nearest" rather than "center" so a panel
     already on screen is left where it is instead of jumping. */
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chosen.key]);

  return (
    <div
      ref={ref}
      className="mt-3 scroll-mt-20 rounded-xl border border-brand-500/50 bg-panel p-4 ring-1 ring-brand-500/15"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
            You are buying
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-strong">{chosen.name}</p>
          <p className="text-xs text-muted">{chosen.detail}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          className={buttonClass("ghost", "sm", "shrink-0")}
        >
          <X size={13} />
          Change
        </button>
      </div>

      <CouponField coupon={coupon} className="mt-3" />

      {/* Spelled out as rows rather than a struck-through price. A card being
          compared with three others only needs the new figure; the moment
          before paying is the moment to show where that figure came from. */}
      <dl className="mt-3 space-y-1.5 border-t border-divider pt-3">
        <Sum label="Price" value={fmtRupees(chosen.listInr)} />
        {cut && coupon.applied ? (
          <Sum
            label={`Code ${coupon.applied}`}
            value={`− ${fmtRupees(cut.discountInr)}`}
            tone="good"
          />
        ) : null}
        <Sum label="To pay now" value={fmtRupees(payable)} strong />
        {/* Directly under the figure that shrank, because "the credits do not
            change" is the one thing a buyer wants confirmed at that moment. */}
        <Sum label="You receive" value={chosen.receive} tone="brand" />
      </dl>

      {whyNot ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-warn-500">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{whyNot}</span>
        </p>
      ) : null}

      <button
        type="button"
        onClick={onPay}
        disabled={working}
        className={buttonClass("primary", "md", "mt-3 w-full")}
      >
        {working ? <Loader2 size={14} className="animate-spin" /> : null}
        {working ? "Opening payment..." : `Pay ${fmtRupees(payable)}`}
      </button>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Paid through Razorpay. Nothing is charged until you finish there.
      </p>
    </div>
  );
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
        /*
         * Razorpay asked every buyer for their name, email and phone on every
         * purchase, all three of which the server already knows. Handed over
         * exactly as the server built it: absent fields are missing keys rather
         * than empty strings, because Razorpay reads a blank prefill as an
         * answer and leaves the box in a worse state than an untouched one.
         */
        prefill: started.buyer,
        modal: {
          ondismiss: () => {
            // Nothing to undo. The payment row stays 'created', so if money did
            // move the webhook still settles it.
            setBusy(null);
          },
        },
        theme: { color: brandColour() },
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

/**
 * Where the account stands on a plan, which decides whether renewing the same
 * plan is offered at all.
 *
 *   none     nothing bought yet, so every card is a first purchase.
 *   expired  the plan has lapsed. Renewing the one they were on is the obvious
 *            thing to want, so that card offers exactly that.
 *   live     a plan is running, and renewing it early is deliberately not
 *            offered. Not because the sums would go wrong - settle_payment sets
 *            the new expiry to greatest(current expiry, today) + the months
 *            bought, so an early renewal does carry the days already paid for -
 *            but because the owner does not want the same month sold twice.
 *            Changing plan stays available either way: an upgrade is how a
 *            truck limit is raised, and that cannot wait for expiry.
 */
export type PlanStanding = "none" | "expired" | "live";

/** What a plan hands over, as one line for the total. */
function planReceipt(plan: Plan): string {
  const trucks =
    plan.truck_limit === -1
      ? "Unlimited trucks"
      : `${plan.truck_limit} truck${plan.truck_limit === 1 ? "" : "s"}`;
  return plan.included_credits > 0
    ? `${trucks} · ${formatCredits(plan.included_credits)} credits`
    : trucks;
}

export function BuyPlans({
  plans,
  brandName,
  currentPlanId,
  currentPlan = null,
  disabledReason,
  standing = "none",
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
  standing?: PlanStanding;
}) {
  const [months, setMonths] = useState<number>(1);
  /**
   * The card being bought, held as an id rather than a copy of its figures.
   * The term picker sits above the grid and can be changed after a card is
   * tapped, so a snapshotted price would be the one from before that change -
   * which is the single thing the total panel exists to prevent.
   */
  const [chosenId, setChosenId] = useState<string | null>(null);
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

  /**
   * Renewing the plan already in force. Only offered once it has run out - see
   * PlanStanding - and it is the one card whose button changes with standing,
   * because every other card is a change of plan rather than a renewal.
   */
  const canRenew = standing === "expired";

  const chosenPlan = chosenId ? (plans.find((plan) => plan.id === chosenId) ?? null) : null;

  /* Rebuilt on every render from the term picker's current value, so the figure
     in the panel and the figure the order is opened for cannot disagree. */
  const purchase: Chosen | null = chosenPlan
    ? {
        key: chosenPlan.id,
        name: `${chosenPlan.name} plan`,
        detail: months === 1 ? "1 month" : `${months} months`,
        listInr: rupees(chosenPlan.price_per_month * months),
        receive: planReceipt(chosenPlan),
        start: () => {
          const fd = new FormData();
          fd.set("plan_id", chosenPlan.id);
          fd.set("months", String(months));
          // The code goes with the purchase, so the server holds the claim and
          // charges the figure the panel was showing.
          fd.set("coupon_code", coupon.formValue);
          return startPlanCheckout(null, fd);
        },
      }
    : null;

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
              /* The total below re-prices itself from this, so the choice can
                 be changed with a card already picked and nothing goes stale. */
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

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const mine = plan.id === currentPlanId;
          const picked = plan.id === chosenId;
          const total = rupees(plan.price_per_month * months);
          const cut = coupon.cutFor(total);
          // Nothing to charge for means no order to open, so say so on the card
          // rather than letting the click come back with a refusal.
          const buyable = plan.price_per_month > 0;
          // Only worth saying against a plan they are not already on, and only
          // when we know which one that is.
          const change = !mine && currentPlan ? truckChange(plan, currentPlan) : null;
          /* The one card that is not for sale: the plan already running. Its
             renewal is what standing "live" withholds, and there is nothing
             else this card could sell them. */
          const inert = mine && standing === "live";

          return (
            <li
              key={plan.id}
              className={cx(
                "flex flex-col rounded-xl border bg-panel p-4 transition",
                picked
                  ? "border-brand-500 ring-2 ring-brand-500/25"
                  : mine
                    ? "border-brand-500/60 ring-1 ring-brand-500/20"
                    : "border-line",
                !locked && !mine && !picked && "hover:border-line-strong",
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

              {/*
                Selects rather than pays. The figure it would charge, and the
                code that changes it, are both settled in the total panel below
                the grid - so this button decides what is bought and nothing
                about what it costs.
              */}
              <button
                type="button"
                disabled={locked || !buyable || inert || busy !== null}
                onClick={() => setChosenId(plan.id)}
                className={buttonClass(
                  picked || change?.better || standing === "none" || (mine && canRenew)
                    ? "primary"
                    : "secondary",
                  "md",
                  "mt-4 w-full",
                )}
              >
                {picked ? <Check size={14} /> : null}
                {!buyable
                  ? "Contact support"
                  : locked
                    ? "Not available"
                    : picked
                      ? "Chosen"
                      : inert
                        ? /* Renewal is withheld until it lapses, and the end
                             date is on the page above, so this says what the
                             card is rather than offering an action. */
                          "Your current plan"
                        : mine
                          ? "Renew this plan"
                          : change?.better
                            ? "Upgrade to this"
                            : standing === "none"
                              ? "Choose this plan"
                              : "Switch to this plan"}
              </button>
            </li>
          );
        })}
      </ul>

      {purchase ? (
        <PayPanel
          chosen={purchase}
          coupon={coupon}
          busy={busy}
          onPay={() => void pay(purchase.key, purchase.start, coupon.refused)}
          onCancel={() => setChosenId(null)}
        />
      ) : null}

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
   * The pack being bought, as an id. Held this way rather than as a copy of its
   * price because the open tier's amount box can be edited after the card is
   * chosen - a snapshot would leave the total quoting a figure the buyer has
   * since typed over.
   */
  const [chosenId, setChosenId] = useState<string | null>(null);

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

  const chosenPack = chosenId ? (packs.find((pack) => pack.id === chosenId) ?? null) : null;

  /**
   * What the chosen card would buy, rebuilt every render from whatever is in
   * the amount box now.
   *
   * An open tier below its minimum buys nothing, so it yields no purchase at
   * all rather than a panel offering to charge an amount the server would
   * refuse - creditsForAmount returning null is that answer.
   */
  const purchase: Chosen | null = (() => {
    if (!chosenPack) return null;

    if (!chosenPack.is_open_ended) {
      return {
        key: chosenPack.id,
        name: chosenPack.name,
        detail: `${formatCredits(chosenPack.credits)} credits`,
        listInr: chosenPack.price_inr,
        receive: `${formatCredits(chosenPack.credits)} credits`,
        start: () => {
          const fd = new FormData();
          fd.set("pack_id", chosenPack.id);
          fd.set("coupon_code", coupon.formValue);
          return startCheckout(null, fd);
        },
      };
    }

    const typed = amounts[chosenPack.id] ?? "";
    const amount = rupees(Number(typed));
    const credits = creditsForAmount(chosenPack, amount, creditsPerRupee);
    if (credits === null) return null;

    return {
      key: chosenPack.id,
      name: chosenPack.name,
      detail: `${fmtRupees(amount)} of credits`,
      listInr: amount,
      receive: `${formatCredits(credits)} credits`,
      start: () => {
        const fd = new FormData();
        fd.set("pack_id", chosenPack.id);
        // Sent so the server knows what was asked for. It prices the purchase
        // itself either way - see startCheckout.
        fd.set("amount_inr", typed);
        fd.set("coupon_code", coupon.formValue);
        return startCheckout(null, fd);
      },
    };
  })();

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

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {packs.map((pack) => {
          const picked = pack.id === chosenId;
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
                  "col-span-2 flex flex-col rounded-xl border bg-panel p-3 transition",
                  picked ? "border-brand-500 ring-2 ring-brand-500/25" : "border-brand-500/40",
                  !locked && !picked && "hover:border-brand-500/60",
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

                {/* Terse here, like every other card. The sum this comes from
                    is spelled out in the total panel, where it is checked. */}
                <CodeNote cut={cut} whyNot={whyNot} />

                <button
                  type="button"
                  disabled={locked || tooLittle || busy !== null}
                  onClick={() => setChosenId(pack.id)}
                  className={buttonClass("primary", "sm", "mt-3 w-full")}
                >
                  {picked ? <Check size={13} /> : null}
                  {locked
                    ? "Not available"
                    : tooLittle
                      ? `Minimum is ${minimum}`
                      : picked
                        ? "Chosen"
                        : "Top up this much"}
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
                "flex flex-col rounded-xl border bg-panel p-3 transition",
                picked ? "border-brand-500 ring-2 ring-brand-500/25" : "border-line",
                !locked && !picked && "hover:border-line-strong",
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
                onClick={() => setChosenId(pack.id)}
                className={buttonClass("primary", "sm", "mt-3 w-full")}
              >
                {picked ? <Check size={13} /> : null}
                {locked ? "Not available" : picked ? "Chosen" : "Top up"}
              </button>
            </li>
          );
        })}
      </ul>

      {purchase ? (
        <PayPanel
          chosen={purchase}
          coupon={coupon}
          busy={busy}
          onPay={() => void pay(purchase.key, purchase.start, coupon.refused)}
          onCancel={() => setChosenId(null)}
        />
      ) : null}

      <Outcome error={error} notice={notice} />
    </div>
  );
}
