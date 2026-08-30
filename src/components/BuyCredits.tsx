"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Info, Loader2, Sparkles } from "lucide-react";

import { buttonClass, Badge, cx, Panel } from "@/components/ui";
import { confirmCheckout, startCheckout } from "@/app/portal/plan/checkout-actions";
// Only the pure formatters. The service-role helpers in the same module are
// never referenced here, so nothing privileged is constructed in the browser.
import { bonusPercent, formatCredits, rupeesPerCredit } from "@/lib/credits";
import { friendlyError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import type { CreditPack } from "@/lib/types";

/**
 * The credit shop.
 *
 * The packs are always shown, even when nothing can be bought - an officer
 * without a live plan should still be able to see what credits cost before
 * asking their administrator for one. `disabledReason` is worked out on the
 * server, because two thirds of that decision (the admin toggle and whether the
 * keys exist) is not knowable in the browser.
 */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

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

export function BuyCredits({
  packs,
  disabledReason,
}: {
  packs: CreditPack[];
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The bonus tiers are expressed against the smallest pack, which is the plain
  // rate everything else improves on.
  const baseline = packs.reduce<CreditPack | undefined>(
    (lowest, pack) => (!lowest || pack.price_inr < lowest.price_inr ? pack : lowest),
    undefined,
  );

  async function confirm(handshake: Handshake) {
    const fd = new FormData();
    fd.set("razorpay_order_id", handshake.razorpay_order_id ?? "");
    fd.set("razorpay_payment_id", handshake.razorpay_payment_id ?? "");
    fd.set("razorpay_signature", handshake.razorpay_signature ?? "");

    try {
      const result = await confirmCheckout(null, fd);
      if (result.ok) {
        setNotice(result.message ?? "Credits added to your balance.");
      } else {
        setError(result.error);
      }
    } catch {
      // The money has very likely arrived - only our confirmation call did not
      // get through. The webhook settles it either way, so do not alarm anyone.
      setNotice("Payment received. Your balance will update in a moment.");
    } finally {
      setBusyPack(null);
      router.refresh();
    }
  }

  async function buy(pack: CreditPack) {
    setError(null);
    setNotice(null);
    setBusyPack(pack.id);

    try {
      const fd = new FormData();
      fd.set("pack_id", pack.id);

      const started = await startCheckout(null, fd);
      if (!started.ok) {
        setError(started.error);
        setBusyPack(null);
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
        name: "Truck Watch",
        description: `${started.packName} — ${formatCredits(started.credits)} credits`,
        handler: (handshake) => {
          void confirm(handshake);
        },
        modal: {
          ondismiss: () => {
            // Nothing to undo. The payment row stays 'created', so if money did
            // move the webhook still credits it.
            setBusyPack(null);
          },
        },
        theme: { color: "#2563eb" },
      });

      checkout.on("payment.failed", () => {
        setBusyPack(null);
        setError("That payment did not go through. Nothing was charged - you can try again.");
      });

      checkout.open();
    } catch (err) {
      setError(friendlyError(err));
      setBusyPack(null);
    }
  }

  if (packs.length === 0) {
    return (
      <Panel title="Buy credits">
        <p className="text-sm text-muted">
          No credit packs are on sale at the moment. Ask your administrator to add credits to your
          account.
        </p>
      </Panel>
    );
  }

  const locked = disabledReason !== null;

  return (
    <Panel
      title="Buy credits"
      description={locked ? undefined : "Credits are added to your balance as soon as you pay."}
    >
      {locked ? (
        <p className="mb-4 flex items-start gap-2.5 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-sm leading-relaxed text-warn-500">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>{disabledReason}</span>
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {packs.map((pack) => {
          const bonus = baseline ? bonusPercent(pack, baseline) : 0;
          const busy = busyPack === pack.id;

          return (
            <li
              key={pack.id}
              className={cx(
                "flex flex-col rounded-xl border border-line bg-panel p-4 transition",
                !locked && "hover:border-line-strong",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink">{pack.name}</p>
                {bonus > 0 ? (
                  <Badge tone="good">
                    <Sparkles size={11} />
                    {bonus}% better value
                  </Badge>
                ) : null}
              </div>

              <p className="mt-2 text-2xl font-semibold tabular-nums text-strong">
                {fmtRupees(pack.price_inr)}
              </p>
              <p className="mt-0.5 text-sm text-brand-500 tabular-nums">
                {formatCredits(pack.credits)} credits
              </p>
              <p className="mt-0.5 text-xs text-muted tabular-nums">
                Rs {rupeesPerCredit(pack).toFixed(2)} per credit
              </p>

              <button
                type="button"
                disabled={locked || busyPack !== null}
                onClick={() => void buy(pack)}
                className={buttonClass("primary", "md", "mt-4 w-full")}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {busy ? "Opening payment..." : locked ? "Not available" : "Buy"}
              </button>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {notice ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-good-500/40 bg-good-500/10 px-3 py-2 text-sm text-good-500">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </p>
      ) : null}
    </Panel>
  );
}
