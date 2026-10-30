"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { recheckPayment } from "./actions";
import type { ActionResult } from "@/lib/types";

/**
 * One unpaid online row's "ask Razorpay" button. The answer replaces the button
 * in place, because the admin pressing it is usually on the phone with the
 * customer and wants the verdict where they were looking.
 */
export function RecheckPayment({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recheckPayment,
    null,
  );
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="mt-1">
      <input type="hidden" name="order_id" value={orderId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 transition hover:text-brand-300 disabled:opacity-60"
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Recheck with Razorpay
      </button>
      {state ? (
        <span
          className={`mt-0.5 block max-w-56 text-xs ${state.ok ? "text-good-500" : "text-bad-500"}`}
        >
          {state.ok ? state.message : state.error}
        </span>
      ) : null}
    </form>
  );
}
