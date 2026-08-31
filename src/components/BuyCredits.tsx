"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, Info, Loader2, Sparkles, Truck, Wallet } from "lucide-react";

import { Field, Input } from "@/components/form";
import { buttonClass, Badge, cx, Panel } from "@/components/ui";
import {
  confirmCheckout,
  startCheckout,
  startPlanCheckout,
  type CheckoutStart,
} from "@/app/portal/plan/checkout-actions";
// Only the pure formatters. The service-role helpers in the same module are
// never referenced here, so nothing privileged is constructed in the browser.
//
// bonusPercent is aliased on the way in: it compares two fixed packs by value,
// and has nothing to do with the bonus_percent an open tier carries. Two
// different ideas that would otherwise share a name on the same card.
import {
  bonusPercent as valueAgainstEntryPack,
  creditsForAmount,
  formatCredits,
  rupeesPerCredit,
} from "@/lib/credits";
import { friendlyError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import type { CreditPack, Plan } from "@/lib/types";

/**
 * The two things that can be bought, sharing one payment window.
 *
 * A plan is what a new account buys first - it decides how many trucks may be
 * watched and hands over a batch of credits. Credits are the top-up for an
 * account that already has a plan: when the credits run out you buy more of
 * them, not another copy of the plan.
 *
 * Both live in this file so the Razorpay script loader and the start/confirm
 * dance exist once. Splitting them would mean two copies of the one piece of
 * this code that is easy to get subtly wrong.
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

/**
 * Start the order, open the payment window, confirm what comes back. The only
 * thing that differs between a pack and a plan is which action opens the order,
 * so that is the only thing the caller passes in.
 */
function useCheckout(brandName: string) {
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
      if (result.ok) setNotice(result.message ?? "Payment received.");
      else setError(result.error);
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
  async function pay(key: string, start: () => Promise<CheckoutStart>) {
    setError(null);
    setNotice(null);
    setBusy(key);

    try {
      const started = await start();
      if (!started.ok) {
        setError(started.error);
        setBusy(null);
        return;
      }

      await loadCheckoutScript();
      const Checkout = window.Razorpay;
      if (!Checkout) throw new Error("The payment window could not be loaded.");

      const checkout = new Checkout({
        key: started.keyId,
        order_id: started.orderId,
        amount: Math.round(started.amountInr * 100),
        currency: "INR",
        name: brandName,
        description: `${started.itemName} — ${started.itemDetail}`,
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

export function BuyPlans({
  plans,
  brandName,
  currentPlanId,
  disabledReason,
  /** True once a plan is running: the copy becomes about renewing, not starting. */
  renewing = false,
}: {
  plans: Plan[];
  brandName: string;
  currentPlanId: string | null;
  disabledReason: string | null;
  renewing?: boolean;
}) {
  const [months, setMonths] = useState<number>(1);
  const { busy, error, notice, pay } = useCheckout(brandName);
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

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const mine = plan.id === currentPlanId;
          const working = busy === plan.id;
          const total = plan.price_per_month * months;
          // Nothing to charge for means no order to open, so say so on the card
          // rather than letting the click come back with a refusal.
          const buyable = plan.price_per_month > 0;

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
                {mine ? <Badge tone="brand">Your plan</Badge> : null}
              </div>

              {plan.description ? (
                <p className="mt-1 text-xs leading-relaxed text-muted">{plan.description}</p>
              ) : null}

              <p className="mt-3 text-2xl font-semibold tabular-nums text-strong">
                {fmtRupees(total)}
              </p>
              <p className="mt-0.5 text-xs text-muted tabular-nums">
                {months === 1
                  ? "a month"
                  : `for ${months} months · ${fmtRupees(plan.price_per_month)} a month`}
              </p>

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

              <button
                type="button"
                disabled={locked || !buyable || busy !== null}
                onClick={() =>
                  void pay(plan.id, () => {
                    const fd = new FormData();
                    fd.set("plan_id", plan.id);
                    fd.set("months", String(months));
                    return startPlanCheckout(null, fd);
                  })
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
  const { busy, error, notice, pay } = useCheckout(brandName);

  // What has been typed into each open tier, keyed by pack. Starts at the
  // minimum, so a card is never showing a refusal before anyone has touched it.
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      packs.filter((pack) => pack.is_open_ended).map((pack) => [pack.id, String(pack.price_inr)]),
    ),
  );

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

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {packs.map((pack) => {
          const working = busy === pack.id;
          const minimum = `Rs ${pack.price_inr.toLocaleString("en-IN")}`;

          /* ---------------------------------------------------------------- */
          /* open tier: the buyer sets the amount                              */
          /* ---------------------------------------------------------------- */
          if (pack.is_open_ended) {
            const typed = amounts[pack.id] ?? "";
            const amount = Number(typed);
            // null is the one honest answer below the minimum: there is nothing
            // to sell at that price, so no credit figure is quoted.
            const credits = creditsForAmount(pack, amount, creditsPerRupee);
            const tooLittle = credits === null;

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
                  {pack.bonus_percent > 0 ? (
                    <Badge tone="good" className="px-1.5">
                      <Sparkles size={10} />
                      {formatCredits(pack.bonus_percent)}% extra credits
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

                <button
                  type="button"
                  disabled={locked || tooLittle || busy !== null}
                  onClick={() =>
                    void pay(pack.id, () => {
                      const fd = new FormData();
                      fd.set("pack_id", pack.id);
                      // Sent so the server knows what was asked for. It prices
                      // the purchase itself either way - see startCheckout.
                      fd.set("amount_inr", typed);
                      return startCheckout(null, fd);
                    })
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
                        : `Pay Rs ${amount.toLocaleString("en-IN")}`}
                </button>
              </li>
            );
          }

          /* ---------------------------------------------------------------- */
          /* fixed pack: a price and a credit count, both stated              */
          /* ---------------------------------------------------------------- */
          const betterValue = baseline ? valueAgainstEntryPack(pack, baseline) : 0;

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
              <p className="text-sm font-medium tabular-nums text-strong">
                {fmtRupees(pack.price_inr)}
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-faint">
                Rs {rupeesPerCredit(pack).toFixed(2)} each
              </p>

              <button
                type="button"
                disabled={locked || busy !== null}
                onClick={() =>
                  void pay(pack.id, () => {
                    const fd = new FormData();
                    fd.set("pack_id", pack.id);
                    return startCheckout(null, fd);
                  })
                }
                className={buttonClass("primary", "sm", "mt-3 w-full")}
              >
                {working ? <Loader2 size={13} className="animate-spin" /> : null}
                {working ? "Opening..." : locked ? "Not available" : "Top up"}
              </button>
            </li>
          );
        })}
      </ul>

      <Outcome error={error} notice={notice} />
    </div>
  );
}
