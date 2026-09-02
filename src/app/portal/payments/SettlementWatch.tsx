"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Waits for the webhook, instead of claiming it has already landed.
 *
 * WHY THIS EXISTS AT ALL. Whether a payment happened is decided by Razorpay's
 * webhook and settle_payment(), never by the browser - see the comment at the
 * top of api/webhooks/razorpay/route.ts. The checkout handshake usually settles
 * it first and this component is never rendered; but the handshake is the one
 * half that can fail on a phone with bad signal, and when it does the money has
 * still moved and the credits are still coming. The old behaviour was to print
 * "Payment received" from the browser's word alone, which is a congratulations
 * that is sometimes false.
 *
 * So the page renders what the payment row actually says and this only asks
 * again. router.refresh() re-runs the Server Component, which re-reads the row
 * and the balance; when the status changes the parent stops rendering this at
 * all.
 *
 * Bounded twice over, because a poll on a page somebody has left open must not
 * run for ever: the tries below, and on the server the panel only renders this
 * while the payment is still young.
 */

const POLL_MS = 3000;
const MAX_TRIES = 20;

export function SettlementWatch({ supportEmail }: { supportEmail: string }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const waiting = tries < MAX_TRIES;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setTries((count) => count + 1);
      router.refresh();
    }, POLL_MS);
    return () => clearTimeout(timer);
    // `tries` is what re-arms the timer, so each pass schedules exactly one more.
  }, [tries, waiting, router]);

  if (waiting) {
    return (
      <p
        className="mt-2 flex items-center gap-2 text-xs text-muted"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={13} className="shrink-0 animate-spin" />
        Checking again every few seconds. You can leave this page — nothing will be lost.
      </p>
    );
  }

  return (
    <p className="mt-2 text-xs leading-relaxed text-warn-500" role="status">
      Still no confirmation. If money has left your account it will be credited once Razorpay
      confirms it{supportEmail ? <> — quote the reference above to {supportEmail}</> : null}. Nothing
      has been added to your balance yet.
    </p>
  );
}
