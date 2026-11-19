import type { GuideFaq } from "./types";
import { ALERT_BOT_START_URL, ALERT_BOT_USERNAME, ID_BOT_START_URL, ID_BOT_USERNAME } from "@/lib/telegram-bot";

/**
 * Standalone FAQs: a question whose whole answer is a short paragraph and
 * which does not need an article of its own. Anything that needs a figure, a
 * table or steps belongs in ./articles.ts instead - an article can carry its
 * own `faqs`, and those appear here and on /guide/faq automatically.
 *
 * `a` may carry inline `[label](/href)` links and `` `code` ``. One to three
 * sentences, no line breaks, no lists. A longer answer is an article.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES ABOUT WHAT MAY BE WRITTEN HERE
 *
 * 1 · NO PRICES, NO PACK SIZES, NO TRIAL LENGTH, NO WINDOW IN HOURS. Every one
 *     of those is a row an administrator edits without a deploy - the plans,
 *     the credit ladder, the trial's days and credits, the no-movement window,
 *     the referral percentages, the failure limit. A number typed into an
 *     answer here is a number that goes quietly wrong, and the reader trusts
 *     it over the screen in front of them. Point at [pricing](/pricing) or at
 *     the officer's own [plan](/portal/plan) page instead.
 *
 *     Fixed in code, and therefore sayable: one manual search is one credit,
 *     an automatic check is "your plan's rate" (0064), one alert of each kind per truck, five
 *     failures in a row before a warning, and a reset link that lasts an hour.
 *
 * 2 · THE QUESTION IS IN THE OFFICER'S WORDS, NOT THE PRODUCT'S. "Why did my
 *     credits go down when the truck did not move?" is what gets typed into
 *     the search box; "credit consumption semantics" is not. The Hinglish a
 *     customer actually searches with - kitna, paisa, recharge, band, chalu,
 *     gaadi, kaise - lives in `keywords`, where it can be matched without
 *     making the question itself read as a translation.
 */
export const FAQS: GuideFaq[] = [
  /* ======================================================================= */
  /* start                                                                    */
  /* ======================================================================= */
  {
    q: "Can I try it before paying anything?",
    a: "Yes. There is a free trial, one per account and email address, which you can start from [Plan and credits](/portal/plan) once your email is verified. It tracks one truck and includes some free credits; the exact days and credits are shown on the trial card.",
    category: "start",
    keywords: ["free", "trial", "muft", "free trial", "test", "try", "demo", "kaise"],
  },
  {
    q: "What do I need to do before a truck is tracked?",
    a: "Six steps, in order: sign up, verify your email with the code, start the trial or buy a plan, set up phone notifications or Telegram in [Settings](/portal/settings), add the truck under [My trucks](/portal/trucks), and switch on one alert for it. Connect alerts before tracking, so you do not miss crossings — see [getting started](/guide/start).",
    category: "start",
    keywords: ["start", "first", "setup", "shuru", "kaise", "begin", "new"],
  },
  {
    q: "How does it know where my truck is? Is this GPS?",
    a: "It is not GPS and needs no device in the truck. We check the national toll records for your vehicle number, so you see the plazas it has crossed and when. A truck on untolled roads produces no records. See [where the data comes from](/data-sources).",
    category: "start",
    keywords: ["gps", "track", "kaise", "location", "toll", "how", "device", "lorry"],
  },
  {
    q: "What is a credit?",
    a: "Credits pay for checking the toll records. A manual search uses one credit, and an automatic check of a tracked truck uses credits at your plan's rate (see [Pricing](/pricing)). One balance pays for both; you can see it on [Plan and credits](/portal/plan).",
    category: "start",
    keywords: ["credit", "kya", "what", "kitna", "paisa", "balance", "unit"],
  },
  {
    q: "Why does it ask for a code from my email?",
    a: "Only the free trial needs it, because the trial is limited to one per account and email address. Buying a plan or credits does not need a code. Enter yours on [verify email](/portal/verify-email).",
    category: "start",
    keywords: ["code", "otp", "verify", "email", "6 digit", "confirm", "kyu"],
  },

  /* ======================================================================= */
  /* trucks                                                                   */
  /* ======================================================================= */
  {
    q: "My truck stopped being checked and I never paused it",
    a: "It paused automatically, and the row shows why: an end time you set, no new toll crossing for the set time, repeated checks with no result for that number, an empty balance, or an ended plan. Open the truck on [My trucks](/portal/trucks) — the badge shows the reason and the (i) beside it gives the details.",
    category: "trucks",
    keywords: ["band", "stopped", "paused", "auto pause", "kyu", "gaadi", "lorry"],
  },
  {
    q: "I renewed my plan but my trucks are still switched off",
    a: "Renewing allows automatic checks again, but does not switch trucks back on. Switch on the ones you need from [My trucks](/portal/trucks), and leave parked trucks off.",
    category: "trucks",
    keywords: ["renew", "chalu", "plan", "off", "not working", "resume", "band"],
  },
  {
    q: "I topped up and tracking is still off",
    a: "Topping up does not switch trucks back on automatically, so you can choose which ones to resume. Switch them on from [My trucks](/portal/trucks).",
    category: "trucks",
    keywords: ["recharge", "topup", "top up", "chalu", "still off", "not working", "resume"],
  },
  {
    q: "Why does it say no movement when the truck moved this morning?",
    a: "The time is counted from the later of the last recorded crossing and the moment you switched the truck on, and tracking pauses when no new crossing arrives within the set hours. Movement on untolled roads is not recorded, so a truck off the highways can appear parked. The window for each truck is on its page under [My trucks](/portal/trucks).",
    category: "trucks",
    keywords: ["no movement", "inactive", "paused", "band", "8 hours", "parked", "khada"],
  },
  {
    q: "It says No response for this number. What should I check?",
    a: "Usually the vehicle number is incorrect; sometimes the toll records have stopped reporting that truck. We notify you after five unsuccessful checks in a row, and tracking pauses at that truck's failure limit. Check the number before switching it back on, as automatic checks are charged when they run.",
    category: "trucks",
    keywords: ["portal", "error", "failed", "not responding", "number", "typo", "galat"],
  },
  {
    q: "The last-checked time on my truck is hours old",
    a: "A truck is checked only when one of its alerts is due, so a truck with a twelve-hour interval is checked twice a day. A paused truck is not checked, and the badge on [My trucks](/portal/trucks) shows this.",
    category: "trucks",
    keywords: ["last checked", "purana", "old", "not updating", "stale", "kab"],
  },
  {
    q: "I added the truck but nothing has happened since",
    a: "A truck with no alert switched on is not checked. Open it from [My trucks](/portal/trucks) and switch on an alert.",
    category: "trucks",
    keywords: ["nothing", "no alert", "added", "kuch nahi", "not working", "silent"],
  },

  /* ======================================================================= */
  /* alerts                                                                   */
  /* ======================================================================= */
  {
    q: "Where are alerts delivered?",
    a: "As phone notifications or Telegram messages, and in the bell inside the app. Every alert is saved in the app, even if a message could not be delivered. Set up delivery in [Settings](/portal/settings).",
    category: "alerts",
    keywords: ["alert", "telegram", "kaha", "where", "message", "notification"],
  },
  {
    q: "Do I have to use Telegram?",
    a: "No. You can use phone notifications, Telegram, or both. If neither is set up, alerts are saved in the app but not sent to your phone, and checks still use credits.",
    category: "alerts",
    keywords: ["telegram", "zaruri", "must", "need", "without", "phone", "kaise"],
  },
  {
    q: "Can I get the alerts on WhatsApp or SMS?",
    a: "Not yet. WhatsApp is shown in [Settings](/portal/settings) as coming soon, and there is no SMS option. Use phone notifications or Telegram.",
    category: "alerts",
    keywords: ["whatsapp", "sms", "message", "kab", "coming soon", "channel"],
  },
  {
    q: "How do I connect Telegram?",
    a: `Open [@${ID_BOT_USERNAME}](${ID_BOT_START_URL}) and press Start; it replies with a number — your chat ID. Paste it into [Settings](/portal/settings), press Start on [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) too, turn the alerts switch on and press Send test. Step-by-step guide: [alerts and Telegram](/guide/alerts).`,
    category: "alerts",
    keywords: ["telegram", "chat id", "connect", "kaise", "setup", "userinfobot", "Gst_truck_watch_bot"],
  },
  {
    q: "The Telegram test message does not arrive",
    a: `Usually because [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) has not been started — Telegram bots can only message people who have started them. Open it, send \`/start\`, then press Send test again in [Settings](/portal/settings).`,
    category: "alerts",
    keywords: ["test", "telegram", "not arriving", "nahi aaya", "bot", "start"],
  },
  {
    q: "The truck moved but I got no alert",
    a: "First check that phone notifications or Telegram are set up in [Settings](/portal/settings) and that Send test arrives. Otherwise: the alert may be switched off, the crossing may not have reached the toll records yet, or the record may show the same plaza as before, which is not a new crossing.",
    category: "alerts",
    keywords: ["no alert", "moved", "chala", "silent", "missing", "message nahi"],
  },
  {
    q: "It will not let me add the same alert twice",
    a: "Each truck can have one alert of each type. Two of the same type would check the same thing twice and charge for both. Change the check interval on your existing alert instead.",
    category: "alerts",
    keywords: ["duplicate", "same alert", "twice", "refused", "already", "dobara"],
  },
  {
    q: "The toll plaza I want is not in the list",
    a: "The list holds plazas where trucks have been recorded, with those ahead of your truck shown first. Small spelling mistakes are accepted, so try typing it. You can confirm a typed name, but an alert is sent only when it exactly matches the name in the toll record — otherwise it never triggers while checks still use credits.",
    category: "alerts",
    keywords: ["plaza", "toll", "not in list", "nahi mila", "search", "typo", "name"],
  },
  {
    q: "Is Only when it moves cheaper than Every check?",
    a: "No. All alert types are checked at the same rate, so Only when it moves sends fewer messages but uses the same credits. Only a longer check interval, or pausing the truck, uses fewer credits.",
    category: "alerts",
    keywords: ["cheap", "sasta", "cost", "kitna", "movement", "interval", "save"],
  },

  /* ======================================================================= */
  /* credits                                                                  */
  /* ======================================================================= */
  {
    q: "Why did my credits go down when the truck did not move?",
    a: "Each check uses credits whether or not the truck moved. See credit use by truck on [Activity](/portal/activity).",
    category: "credits",
    keywords: ["credit", "kam", "kaise", "kyu", "paisa", "no movement", "gaya", "khatam"],
  },
  {
    q: "Is a failed search or check charged?",
    a: "Automatic checks are charged when they run, whatever the result. A manual search that cannot reach the toll records is not charged — the credit is returned. A search that returns no crossings is a valid result and uses one credit.",
    category: "credits",
    keywords: ["failed", "error", "charge", "paisa", "wasted", "refund", "kata"],
  },
  {
    q: "Do the alerts and the Telegram messages cost credits?",
    a: "No. Alerts and their delivery are free. Only manual searches (one credit each) and automatic checks (at your plan's rate) use credits.",
    category: "credits",
    keywords: ["alert", "telegram", "free", "cost", "kitna", "charge", "message"],
  },
  {
    q: "Do my credits expire?",
    a: "No. Credits never expire, including trial credits. They remain after a plan or trial ends and after a renewal.",
    category: "credits",
    keywords: ["expire", "khatam", "validity", "lifetime", "credit", "kab tak"],
  },
  {
    q: "What happens to my trial credits when the trial ends?",
    a: "They stay on your balance and can be used for manual searches. Automatic tracking stops until you choose a plan, which includes credits of its own.",
    category: "credits",
    keywords: ["trial", "credit", "khatam", "left", "bacha", "expire", "free"],
  },
  {
    q: "My plan has ended — have I lost my credits too?",
    a: "No. Credits never expire and can still be used for manual searches on [Search](/portal/search). When a plan ends, automatic tracking and top-ups stop.",
    category: "credits",
    keywords: ["plan", "expired", "credit", "gone", "khatam", "bacha", "search"],
  },
  {
    q: "Why will it not let me buy credits?",
    a: "A top-up needs an active paid plan, so it is not available on an expired plan, on the free trial, or without a plan. Buy or renew a plan on [Plan and credits](/portal/plan); it includes credits, and you can add a top-up to the same payment.",
    category: "credits",
    keywords: ["topup", "recharge", "refused", "blocked", "nahi ho raha", "buy", "credit"],
  },
  {
    q: "I have three alerts on one truck. Is each check charged three times?",
    a: "No. Credits are charged per truck per check, not per alert, so several alerts due on the same truck at the same time share one check. A shorter interval costs more; more alerts on the same interval do not.",
    category: "credits",
    keywords: ["alert", "kitna", "credit", "three", "multiple", "charge", "per"],
  },
  {
    q: "Where can I see what my credits went on?",
    a: "[Activity](/portal/activity) shows credit use by day and by truck, and [Credit history](/portal/credits) is your statement of all credits added and used.",
    category: "credits",
    keywords: ["history", "kaha", "spent", "report", "ledger", "hisab", "activity"],
  },
  {
    q: "How do I make my credits last longer?",
    a: "Use a longer check interval and pause trucks you do not need to track right now. Pausing a parked truck is the best way to save credits — it keeps its recorded crossings, uses no credits, and frees a slot on your plan.",
    category: "credits",
    keywords: ["save", "bachao", "kitna", "cost", "less", "interval", "pause", "band"],
  },

  /* ======================================================================= */
  /* plans                                                                    */
  /* ======================================================================= */
  {
    q: "Do I need a plan for a manual search?",
    a: "No. Manual search uses credits only, so it works on an expired plan or without a plan. Automatic tracking and top-ups need an active plan.",
    category: "plans",
    keywords: ["plan", "search", "zaruri", "need", "manual", "without", "kya"],
  },
  {
    q: "What does a plan give me that credits do not?",
    a: "A plan sets how many trucks you can track at once and for how long, and enables automatic checks and top-ups. Credits pay for each search and check. Tracking needs both; credits without a plan still pay for manual searches. A plan is charged once for its whole term, not monthly — see [Pricing](/pricing).",
    category: "plans",
    keywords: ["plan", "credit", "difference", "antar", "kya", "monthly", "price"],
  },
  {
    q: "How many trucks can I track at once?",
    a: "As many as your plan allows. The limit counts live trucks, not the trucks on your list, so pausing one frees a slot. Your limit and current use are on [Plan and credits](/portal/plan).",
    category: "plans",
    keywords: ["kitne", "trucks", "limit", "how many", "gaadi", "lorry", "slot"],
  },
  {
    q: "My plan has expired — what still works?",
    a: "Manual search. Automatic tracking and top-ups stop until a plan is active again. If you renew within the window shown on [Plan and credits](/portal/plan), your trucks continue where they stopped; after that, they are switched off and you switch them back on yourself.",
    category: "plans",
    keywords: ["expired", "khatam", "plan", "renew", "what works", "band", "search"],
  },
  {
    q: "How do I renew, or move to a bigger plan?",
    a: "You can renew from [Plan and credits](/portal/plan) once the plan has ended. To change plan, add trucks mid-term or renew early, please [contact us](/contact) and we will set it up.",
    category: "plans",
    keywords: ["renew", "upgrade", "bigger", "change", "kaise", "plan", "badalna"],
  },
  {
    q: "If I do not use my plan, do I get the money back?",
    a: "A plan is charged once for its term, and credits are prepaid with no cash value, so refunds are not available in the app. If you think you were charged incorrectly, write to us through [contact](/contact) with the payment reference. See the [terms](/terms) for details.",
    category: "plans",
    keywords: ["refund", "paisa wapas", "cancel", "unused", "money back", "return"],
  },
  /* ======================================================================= */
  /* payments                                                                 */
  /* ======================================================================= */
  {
    q: "I paid and my credits have not arrived",
    a: "Credits are added once the payment gateway confirms the payment, which can take a few seconds on a slow connection. The page updates by itself. If credits still have not arrived, find the payment on [Payments](/portal/payments) and send us its reference through [support](/support).",
    category: "payments",
    keywords: ["paid", "payment", "credit nahi", "not received", "pending", "paisa"],
  },
  {
    q: "My coupon code was refused",
    a: "The form shows the reason: the code is not recognised, not yet valid or expired, fully used or already used by you, valid only for plans or only for top-ups, or the order is below its minimum. Check the offer terms, then contact us through [support](/support) if needed.",
    category: "payments",
    keywords: ["coupon", "code", "discount", "offer", "refused", "kaam nahi", "promo"],
  },
  {
    q: "Where is my receipt?",
    a: "On [Payments](/portal/payments): every payment has a full receipt with its reference and what it bought, and the list can be exported.",
    category: "payments",
    keywords: ["receipt", "bill", "invoice", "gst", "kaha", "download", "payment"],
  },
  {
    q: "Can I pay by cash or bank transfer?",
    a: "The website checkout accepts online payment only. To pay another way, contact us first through [contact](/contact). Offline payments are recorded by our team, and credits are added once the payment is received.",
    category: "payments",
    keywords: ["cash", "bank", "upi", "cheque", "offline", "paisa", "kaise"],
  },
  {
    q: "Will you charge my card again automatically?",
    a: "No. Nothing renews automatically. A plan is one payment for its term and a top-up is one payment for credits.",
    category: "payments",
    keywords: ["auto", "recurring", "subscription", "renew", "card", "monthly", "charge"],
  },

  /* ======================================================================= */
  /* rewards                                                                  */
  /* ======================================================================= */
  {
    q: "How much do I earn for inviting someone?",
    a: "A percentage of their first plan payment and of their first top-up, as credits. Your invitee also earns a smaller share. Current percentages and an example are on [Invite & earn](/portal/referrals).",
    category: "rewards",
    keywords: ["referral", "invite", "kitna", "commission", "earn", "reward", "paisa"],
  },
  {
    q: "When do the referral credits reach me?",
    a: "Automatically, as soon as their payment is confirmed — there is nothing to claim. Each reward is paid once per invitee, and you can follow each invitee's status on [Invite & earn](/portal/referrals).",
    category: "rewards",
    keywords: ["referral", "kab", "when", "credit", "milega", "reward", "paid"],
  },
  {
    q: "Do I earn when someone signs up with my link?",
    a: "No. Sign-up alone does not earn a reward. You earn when your invitee buys their first plan, and again on their first top-up.",
    category: "rewards",
    keywords: ["signup", "referral", "register", "kuch nahi", "earn", "join"],
  },
  {
    q: "Can I use my own invite link?",
    a: "No. An account cannot refer itself, and a second account opened with your own link does not earn rewards.",
    category: "rewards",
    keywords: ["self", "own link", "khud", "refer", "second account", "cheat"],
  },

  /* ======================================================================= */
  /* account                                                                  */
  /* ======================================================================= */
  {
    q: "The verification code has not arrived",
    a: "Check your spam or junk folder, and mark our email as not spam so future emails arrive in your inbox. Each code works once and expires, so if nothing arrives, send a new one from [verify email](/portal/verify-email).",
    category: "account",
    keywords: ["code", "otp", "email", "nahi aaya", "spam", "verify", "resend"],
  },
  {
    q: "The password reset link does not work",
    a: "Reset links expire after an hour and work once. Request a new one at [forgot password](/forgot-password), open it on the same device, and choose your new password straight away.",
    category: "account",
    keywords: ["password", "reset", "link", "expired", "kaam nahi", "login", "bhul"],
  },
  {
    q: "I cannot find Sign out",
    a: "It is in the account menu. On a phone, open the menu; on a laptop, it is under your name at the top right of [the portal](/portal).",
    category: "account",
    keywords: ["sign out", "logout", "log out", "nikalna", "exit", "menu"],
  },
  {
    q: "Will I get phone notifications if I add the app to my iPhone home screen?",
    a: "Yes, on iOS 16.4 or later. Add Rahdari to your Home Screen from Safari, open it from that icon, and turn on notifications in [Settings](/portal/settings). Alerts are also always listed in the bell inside the app.",
    category: "account",
    keywords: ["iphone", "notification", "app", "home screen", "push", "install", "android"],
  },

  /* ======================================================================= */
  /* trouble                                                                  */
  /* ======================================================================= */
  {
    q: "I get no alerts but my balance is going down",
    a: "Check your alert setup first. If neither phone notifications nor Telegram are set up, alerts are saved in the app but not sent, and checks still use credits. Open [Settings](/portal/settings), turn on notifications or connect Telegram, and press Send test.",
    category: "trouble",
    keywords: ["silent", "no message", "credit kam", "balance", "telegram", "paisa"],
  },
  {
    q: "Every one of my trucks stopped at the same moment",
    a: "This is an account-wide pause: either the balance ran out or the plan ended. The badge on [My trucks](/portal/trucks) shows which. Top up or renew first, then switch trucks back on.",
    category: "trouble",
    keywords: ["all trucks", "sab band", "stopped", "paused", "together", "kyu"],
  },
  {
    q: "Tracking has stopped but I still have credits",
    a: "Your plan or free trial has probably ended. Your credits remain and can be used for manual searches; automatic tracking needs an active plan. Choose a plan on [Plan and credits](/portal/plan).",
    category: "trouble",
    keywords: ["refused", "credit hai", "blocked", "trial", "not working", "kyu"],
  },
  {
    q: "Why does a search show no crossings?",
    a: "No records means no crossing was recorded — not that the truck has not moved. Check the vehicle number is correct; trucks on untolled or state roads produce no records. A search that returns no crossings uses one credit like any other.",
    category: "trouble",
    keywords: ["nothing", "no result", "kuch nahi", "empty", "search", "lorry", "not found"],
  },
  {
    q: "Can I rely on a toll crossing as proof?",
    a: "Use it as an operational record. Records can be delayed or incomplete, and each time shows when a crossing was recorded, not where the truck is now. For legal or contractual use, verify through official channels. See the [terms](/terms) and [where the data comes from](/data-sources).",
    category: "trouble",
    keywords: ["proof", "evidence", "court", "saboot", "legal", "reliable", "delay"],
  },
];
