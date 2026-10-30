# "Paid on Razorpay, but the app says failed"

What to do when a customer's money was taken but their plan or credits did not
arrive. Read this **before** touching their account by hand.

## Why it happens

Razorpay's checkout reports a failed **attempt**, not a failed order. The window
stays open and the customer can retry on the same order, and a UPI app that
answers late can still complete the payment a minute later. Until 30 Oct 2026 a
failed attempt closed the payment row as `failed`, and `settle_payment()` would
not settle a failed row — so the money was captured and nothing was handed over.

Fixed by migration `0060` plus `src/lib/payment-reconcile.ts`. A captured
payment is now settled automatically by whichever of these gets there first:

| Path | When |
|---|---|
| Checkout handshake (`confirmCheckout`) | The customer finishes in the window. Seconds. |
| Razorpay webhook (`/api/webhooks/razorpay`) | Razorpay calls us, and retries until we answer. Seconds. |
| Failure report (`reportCheckoutFailure`) | Asks Razorpay before marking anything failed. |
| Receipt page (`/portal/payments?ref=…`) | The customer opens their payment within 7 days. |
| Cron sweep (`/api/cron/track`) | Every tick: unpaid online rows from the last 72 hours. |

Each one runs `settle_payment()`, which grants once and only once. If two paths
race, one settles and the other is told "already settled".

## What to do

1. **Find the payment.** Go to Admin → Finance → Payments, filter by the
   customer, and look for a `failed` or `pending` Razorpay row.
2. **Press "Recheck with Razorpay"** on that row. It asks Razorpay directly:
   - *"Settled now"* — done. The customer has the plan/credits, with the real
     payment id on the receipt and the referral reward paid.
   - *"No captured payment on this order"* — Razorpay never took the money for
     this order. Ask the customer for the `pay_…` id from their bank SMS or
     Razorpay receipt and search for it in the Razorpay dashboard; it may belong
     to a different order (a second try), which will have its own row.
3. **Only if Razorpay shows the money but there is no row at all** (very rare —
   e.g. a row deleted by hand): use **Record a payment** with the real amount,
   date and the `pay_…` id in the note.

## What NOT to do

- **Do not assign the plan or add credits by hand** for an online payment. The
  payment will settle on its own (webhook, sweep or receipt page) and the
  customer then has the plan twice. This is what happened on 29 Oct 2026, and
  the duplicate had to be reversed.
- Do not change a row's `status` in the database by hand. `settle_payment()` is
  the only thing that should move a row to `paid`, because it also writes the
  ledger, the plan expiry, the coupon and the referral in one transaction.
- If you did give something by hand before reading this, use "Recheck with
  Razorpay" anyway, then reverse your manual grant with an `admin_adjust`
  ledger entry so the customer holds exactly one of what they paid for.

## Checks worth keeping

- Razorpay dashboard → Settings → Webhooks: `https://rahdari.in/api/webhooks/razorpay`
  is active, with `payment.captured` and `payment.failed` ticked, and its
  secret matches `RAZORPAY_WEBHOOK_SECRET`.
- Razorpay → Account → Website: `rahdari.in` is registered. When it is not,
  every payment is refused with "website does not match registered website(s)".
- The cron scheduler is calling `/api/cron/track`. Its JSON reply now includes
  a `payments` block: `settled` lists any order the sweep had to rescue. A
  non-empty list means the webhook missed something — worth a look.
