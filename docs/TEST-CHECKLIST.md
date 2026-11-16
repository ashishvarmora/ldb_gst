# Rahdari — release test checklist

Run the **Smoke** section before every deploy, the **Full** sections before a
bigger release, and the **Live/ops** section monthly. Tick each line; anything
that fails blocks the release unless it is written down as known.

Legend: 🟢 smoke (must pass every deploy) · 🔵 full · 🟠 live/ops · 💰 touches money.
Test on: Android Chrome (360–412 px), the Android app, iPhone Safari + Home Screen
icon, desktop Chrome. Use a **test customer** account, never a real one.

---

## 1. Public site (signed out)
| # | Case | Expected | Type |
|---|---|---|---|
| 1.1 | Open `/` | Loads < 1 s, logo, hero, plans, app download section, no console errors | 🟢 |
| 1.2 | Open `/pricing` | Every active plan with price, term, credits, truck limit; packs listed | 🟢 |
| 1.3 | `/guide`, a category, an article, `/guide/faq` | Load, links work, back works | 🔵 |
| 1.4 | `/about`, `/contact`, `/support`, `/privacy`, `/terms`, `/data-sources` | Load, support email/phone correct | 🔵 |
| 1.5 | A random URL `/xyz` | Friendly 404 page, HTTP 404 | 🔵 |
| 1.6 | Header "Sign in" while signed in | Goes straight to the account | 🔵 |
| 1.7 | Width 360 px | No sideways scroll, no clipped buttons | 🟢 |

## 2. Account
| # | Case | Expected | Type |
|---|---|---|---|
| 2.1 | Sign up with name, email, mobile, password | Account created, verify-email screen | 🟢 |
| 2.2 | Sign up with an existing email / short password / bad mobile | Clear inline message, nothing created | 🔵 |
| 2.3 | Verification code: correct / wrong / expired / resend | Trial starts only on correct; resend rate-limited | 🔵 |
| 2.4 | Sign in correct / wrong password | Portal / clear error, no hint whether the email exists | 🟢 |
| 2.5 | Forgot password → mail → set new password | Works once; old link refused | 🔵 |
| 2.6 | Sign out, press browser Back | No portal content visible | 🔵 |
| 2.7 | Suspended account signs in | "no access" page | 🔵 |

## 3. Search 💰
| # | Case | Expected | Type |
|---|---|---|---|
| 3.1 | Search a valid number (`GJ 02 AB 1234` with spaces/dashes) | Result page, crossings newest first, **1 credit charged** | 🟢 |
| 3.2 | Search with 0 credits | Clear "not enough credits" + way to buy; nothing charged | 🔵 |
| 3.3 | Invalid format (`ABC`) | Inline message, nothing charged | 🔵 |
| 3.4 | Toll portal down / slow | Apology message with the reason, **credit returned**, ledger shows "Search failed — credit returned" | 🔵 |
| 3.5 | Two tabs, 1 credit, search both at once | Exactly one succeeds; balance never negative | 🔵 |
| 3.6 | Reopen a recent search | No new charge | 🔵 |
| 3.7 | Many searches fast | Rate-limit message, not an error page | 🔵 |

## 4. Trucks, alerts, tracking 💰
| # | Case | Expected | Type |
|---|---|---|---|
| 4.1 | Add a truck within the plan's limit | Added; counts update | 🟢 |
| 4.2 | Add beyond the limit | Refused with "upgrade" message | 🔵 |
| 4.3 | Set an alert rule; wait for the cron | Automatic check charges 1 credit; alert arrives (push / Telegram) | 🔵 |
| 4.4 | Pause / resume a truck | No checks while paused; badge "Tracking paused" | 🔵 |
| 4.5 | Plan expires | Automatic checks stop; manual search still works | 🔵 |
| 4.6 | Truck with repeated portal failures | Auto-paused with reason shown | 🔵 |
| 4.7 | CSV export of trucks / history | Downloads, opens in Excel, no formula injection | 🔵 |

## 5. Plans, credits, payments 💰 (Razorpay **test mode** on a preview, never live money)
| # | Case | Expected | Type |
|---|---|---|---|
| 5.1 | Buy a plan, pay | Plan active, credits added, receipt page "Paid", admin mail | 🔵 |
| 5.2 | Buy plan + top-up in one payment | Both granted once | 🔵 |
| 5.3 | Discount code valid / expired / used up / wrong scope | Correct price or clear refusal; never full price silently | 🔵 |
| 5.4 | Close the payment window | Row stays pending → later "failed"; nothing granted | 🔵 |
| 5.5 | UPI fails once, retry in same window succeeds | Plan granted (0060) | 🔵 |
| 5.6 | Pay, then kill the browser before the handshake | Granted by webhook or the 1-minute reconcile | 🔵 |
| 5.7 | Same plan while it is still running | Refused with the end date | 🔵 |
| 5.8 | Top-up without a plan | Refused with the reason | 🔵 |
| 5.9 | Admin → Finance → "Recheck with Razorpay" | Settles a captured order, else "nothing was charged" | 🔵 |
| 5.10 | Payments list / receipt / CSV | Correct statuses, amounts, IST dates | 🔵 |

## 6. Notifications & chat
| # | Case | Expected | Type |
|---|---|---|---|
| 6.1 | First visit, permission not asked | Browser prompt / "Allow notifications" banner | 🟢 |
| 6.2 | Permission blocked | Banner with steps + button; never covers the tab bar | 🔵 |
| 6.3 | Android app first open | System permission dialog | 🔵 |
| 6.4 | "Send a test notification" | Arrives on the device | 🔵 |
| 6.5 | Customer sends a chat | Admin push; admin mail after N min if unread | 🔵 |
| 6.6 | Admin replies, customer does not read for N min | Customer email once, link opens the chat | 🔵 |

## 7. Referral & codes
| # | Case | Expected | Type |
|---|---|---|---|
| 7.1 | New user signs up with an invite link, pays | Both sides rewarded once | 🔵 |
| 7.2 | Self-referral (own link, second account) | No reward | 🔵 |
| 7.3 | Bonus code redeem: valid / again / unknown / discount code | Credits once; clear messages | 🔵 |

## 8. Admin
| # | Case | Expected | Type |
|---|---|---|---|
| 8.1 | Customer opens `/admin` | Refused | 🟢 |
| 8.2 | Settings → Notify admin: add 2 emails, "Send a test email" | Both receive | 🔵 |
| 8.3 | "Send today's summary now" | Summary arrives, numbers match dashboard | 🔵 |
| 8.4 | Record an offline payment | Plan/credits granted once, admin mail | 🔵 |
| 8.5 | Announcement banner / popup / push | Shows to the right customers, once/daily as set | 🔵 |

## 9. Security & abuse
| # | Case | Expected | Type |
|---|---|---|---|
| 9.1 | Read any table with the public anon key | 0 rows | 🟠 |
| 9.2 | Call money RPCs with the anon key | "permission denied" | 🟠 |
| 9.3 | Change an id in a URL / form to another customer's | Not found / refused | 🔵 |
| 9.4 | Unsigned POST to `/api/webhooks/razorpay` | 400 | 🟢 |
| 9.5 | `/api/cron/*` without the secret | 403 | 🟢 |
| 9.6 | Brute-force sign-in / codes / coupons | Rate-limited | 🔵 |
| 9.7 | HTML/script in name, chat, truck label | Shown as text, never executed (page and email) | 🔵 |
| 9.8 | Security headers present (CSP, HSTS, X-Frame-Options/frame-ancestors) | Yes | 🟠 |

## 10. Performance & resilience
| # | Case | Expected | Type |
|---|---|---|---|
| 10.1 | Public pages | Served from CDN (`X-Vercel-Cache: HIT`), < 200 ms | 🟠 |
| 10.2 | Portal pages, warm | < 1 s | 🟠 |
| 10.3 | Load test — **from a cloud machine, never the office IP** | `/pricing` 100 conns: 0 errors | 🟠 |
| 10.4 | Toll portal returns 500 | Retry once, then refund + apology | 🔵 |
| 10.5 | Supabase slow (> 15 s) | Error message, not an endless spinner | 🔵 |
| 10.6 | Offline on the phone | Offline page with retry | 🔵 |

## 11. Live / ops (monthly)
| # | Case | Expected | Type |
|---|---|---|---|
| 11.1 | Razorpay ↔ DB cross-check (every captured payment has a paid row) | No mismatch | 🟠 |
| 11.2 | cron-job.org history: track (5 min) and notify (1 min) | All green | 🟠 |
| 11.3 | Vercel / Supabase / Resend usage vs free limits | Below 70% | 🟠 |
| 11.4 | Weekly `pg_dump` backup exists and restores | Yes | 🟠 |
| 11.5 | Razorpay webhook URL and registered website | `rahdari.in` | 🟠 |
| 11.6 | Active coupons reviewed (expiry, claims) | As intended | 🟠 |
