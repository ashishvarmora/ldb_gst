# Changing the domain

Every place the public address of this site is written down, and what breaks if
you miss one. Work down the list in order — the first three are the ones that
break money and logins.

The address lives in **five** systems. Only one of them is this repository, and
in this repository it is a single environment variable — there are no hardcoded
URLs in the code, so you never need to edit and redeploy to move domains.

> **How to check the current address at any time**
>
> ```bash
> npx vercel project ls
> ```
>
> The `Latest Production URL` column is the truth. A 404 carrying
> `X-Vercel-Error: DEPLOYMENT_NOT_FOUND` on *every* path means you are asking
> for a hostname that no longer exists — not that the site is down.

---

## 1 · Vercel — `NEXT_PUBLIC_SITE_URL`

**Where:** Vercel → project `ldb_gst` → Settings → Environment Variables.
**Set it to:** the new address, no trailing slash, e.g. `https://rahdari.vercel.app`.
**Then:** redeploy. Environment variables are read at build time, so an existing
deployment keeps the old value until you rebuild.

**If you skip it:** the code falls back to `VERCEL_PROJECT_PRODUCTION_URL`, which
Vercel maintains for you, so most of the time nothing visibly breaks. That is
exactly why this is dangerous — the day you add a custom domain the fallback can
keep pointing at the old `*.vercel.app` host, and the things it feeds are all
links that leave the building, where you never see the failure:

| Reads it | Where | Failure if wrong |
| --- | --- | --- |
| Password reset link | `src/app/forgot-password/actions.ts` | Reset email points at a dead host; the user cannot get back in |
| Welcome email | `src/app/signup/actions.ts` | New customer's "sign in" link 404s |
| Referral link | `src/app/portal/referrals/page.tsx` | Every shared invite link is dead, and referral rewards stop |
| `metadataBase` | `src/app/layout.tsx` | Link previews resolve against the wrong host |

Resolution order is in `src/lib/env.ts` (`siteUrl`):
`NEXT_PUBLIC_SITE_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → `http://localhost:3000`.

---

## 2 · Razorpay — the webhook

**Where:** Razorpay Dashboard → Settings → Webhooks.

| Field | Value |
| --- | --- |
| URL | `https://<new-domain>/api/webhooks/razorpay` |
| Secret | must equal `RAZORPAY_WEBHOOK_SECRET` in Vercel |
| Active events | `payment.captured` and `payment.failed` — **only these two** |

Those are the only events the handler acts on (`src/app/api/webhooks/razorpay/route.ts`).
Anything else returns `200 {ok, ignored}` — harmless, but pointless noise.

**If you skip it:** this is the worst one. Razorpay posts to the old host, gets a
404, and **the customer's payment is never settled** — no credits, no plan, money
taken. The browser handshake in `checkout-actions.ts` covers the case where the
buyer stays on the page, so it will look like it mostly works; the failures are
the people who closed the tab or lost signal, and you will not hear about them.

**Check it end to end after moving:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<new-domain>/api/webhooks/razorpay
```

`400` is correct — the endpoint is alive and rejected an unsigned request. `404`
means the path is wrong. `200` would mean signature checking is broken, which is
a security problem, not a domain one.

Razorpay's dashboard also shows delivery history per webhook. After the first
real payment, confirm a `payment.captured` delivery succeeded there.

---

## 3 · Supabase — **two** separate fields

**Where:** Supabase Dashboard → Authentication → URL Configuration.

Both of these matter and they are not the same box:

1. **Site URL** — the single base address. Email templates build their links from
   it. Set it to the new address.
2. **Redirect URLs** — an allow-list. Add `https://<new-domain>/reset-password`.
   A redirect target that is not on this list is refused, so the reset flow dies
   at the last step even when the email is correct.

**If you skip it:** password reset and email confirmation stop working. The email
arrives, the link looks right, and clicking it fails — the hardest kind of
breakage to diagnose from a customer's description.

---

## 4 · The cron job (cron-job.org, or whatever is calling it)

**Where:** in whichever scheduler you use. There is no cron defined in
`vercel.json`, so this is external.

| Field | Value |
| --- | --- |
| URL | `https://<new-domain>/api/cron/track` |
| Header | `Authorization: Bearer <CRON_SECRET>` |

`CRON_SECRET` must match the Vercel variable. The endpoint refuses to run at all
if that variable is missing, and refuses the request if the bearer token does not
match (`src/app/api/cron/track/route.ts`).

**If you skip it:** truck tracking silently stops. Nothing errors on the site —
trucks just quietly stop being checked, alerts stop arriving, and the first sign
is a customer asking why they got no message. Watch `last_polled_at` on
`tracked_trucks` to confirm the worker is still running.

---

## 5 · Anything you have shared by hand

Not a system, but the one people forget: the address may be sitting in a
WhatsApp message, a Telegram pin, a printed card, a Google Business listing, or
a customer's bookmark. Old `*.vercel.app` hostnames are **not** redirected once
removed — they 404. If a lot of people have the old link, keep the old domain
attached to the project as an alias rather than deleting it, so both resolve.

---

## What you do **not** need to change

- **The code.** No source file contains the domain. Verify any time with
  `grep -rn "vercel.app" src/` — matches should only ever be in comments or docs.
- **Telegram.** Outbound only (`sendMessage` in `src/lib/telegram.ts`). There is
  no bot webhook, so nothing points back at us.
- **The Content-Security-Policy** in `next.config.ts`. It uses `'self'`, which
  follows whatever host serves the page.
- **The database.** No table stores the site address.

---

## After the move — a five-minute smoke test

```bash
for p in / /login /signup /pricing; do curl -s -o /dev/null -w "$p -> %{http_code}\n" "https://<new-domain>$p"; done
```

All four should be `200`. Then, by hand:

1. Request a password reset and click the link in the email — proves §1 and §3.
2. Make one small real purchase and confirm the credits land — proves §2. Check
   the delivery shows as succeeded in Razorpay's webhook log.
3. Wait for one cron interval and confirm `last_polled_at` moved — proves §4.

Steps 1 and 3 are the ones people skip, and they are the two that fail silently.
