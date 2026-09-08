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
 *     one automatic check is one credit, one alert of each kind per lorry, five
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
    a: "Yes — there is a free trial, one per account and one per email address, and you can start it from [Plan and credits](/portal/plan) once your email is verified. It watches one lorry and comes with a small pot of credits; the exact days and credits are on the trial card itself.",
    category: "start",
    keywords: ["free", "trial", "muft", "free trial", "test", "try", "demo", "kaise"],
  },
  {
    q: "What do I actually have to do before a lorry is being watched?",
    a: "Six things, in this order: sign up, verify your email with the code, take the trial or buy a plan, connect Telegram in [Settings](/portal/settings), add the lorry under [My trucks](/portal/trucks), and switch on one alert for it. The one people skip is Telegram, and skipping it is the expensive mistake — see [getting started](/guide/start).",
    category: "start",
    keywords: ["start", "first", "setup", "shuru", "kaise", "begin", "new"],
  },
  {
    q: "How does it know where my lorry is? Is this GPS?",
    a: "It is not GPS and there is no device in the lorry. We ask the national toll network what your registration number has been recorded at, so you see the plazas it has passed and when — and a lorry on untolled roads produces nothing at all. The full account of where the data comes from is at [data sources](/data-sources).",
    category: "start",
    keywords: ["gps", "track", "kaise", "location", "toll", "how", "device", "lorry"],
  },
  {
    q: "What is a credit?",
    a: "A credit is one look at the toll records: one manual search costs one credit, and one automatic check of a watched lorry costs one credit. Your balance is one wallet that pays for both, and you can see it on [Plan and credits](/portal/plan).",
    category: "start",
    keywords: ["credit", "kya", "what", "kitna", "paisa", "balance", "unit"],
  },
  {
    q: "Why does it ask for a code from my email?",
    a: "Only the free trial needs it, because the trial is once per account and per mailbox and an unread mailbox can be manufactured. Buying a plan or credits never asks for a code — enter yours on [verify email](/portal/verify-email).",
    category: "start",
    keywords: ["code", "otp", "verify", "email", "6 digit", "confirm", "kyu"],
  },

  /* ======================================================================= */
  /* trucks                                                                   */
  /* ======================================================================= */
  {
    q: "My lorry stopped being checked and I never paused it",
    a: "Something stopped it and the row says which: an end time you set arrived, no toll crossing arrived for long enough, the portal could not answer for that number, the balance ran out, or the plan ended. Open the lorry on [My trucks](/portal/trucks) — the badge names the reason and the (i) beside it gives that lorry's own figures.",
    category: "trucks",
    keywords: ["band", "stopped", "paused", "auto pause", "kyu", "gaadi", "lorry"],
  },
  {
    q: "I renewed my plan but my lorries are still switched off",
    a: "That is how it works: renewing brings automatic checking back, but it does not switch any lorry on again. Take the ones you still need live yourself from [My trucks](/portal/trucks), which is also the moment to leave the parked ones off.",
    category: "trucks",
    keywords: ["renew", "chalu", "plan", "off", "not working", "resume", "band"],
  },
  {
    q: "I topped up and tracking is still off",
    a: "Topping up clears the refusal but it does not resume anything — the lorries that emptied the balance are usually the ones you least want back on, so the choice is left to you. Switch the ones you want live again on [My trucks](/portal/trucks).",
    category: "trucks",
    keywords: ["recharge", "topup", "top up", "chalu", "still off", "not working", "resume"],
  },
  {
    q: "Why does it say no movement when the lorry moved this morning?",
    a: "The clock runs from whichever is later, the last recorded crossing or the moment you took the lorry live, and it pauses when nothing new has arrived for the hours allowed. A crossing on an untolled road is not a crossing we can see, so a lorry off the highways looks parked; the exact window for that lorry is on its own page under [My trucks](/portal/trucks).",
    category: "trucks",
    keywords: ["no movement", "inactive", "paused", "band", "8 hours", "parked", "khada"],
  },
  {
    q: "It says the portal is not responding — is that my mistake?",
    a: "Usually it is a typo in the registration number, and sometimes a lorry the toll network has stopped reporting. You are warned after five unanswered checks in a row and checking pauses when that lorry's failure limit is reached; check the number before going live again, because each failed check still costs a credit.",
    category: "trucks",
    keywords: ["portal", "error", "failed", "not responding", "number", "typo", "galat"],
  },
  {
    q: "The last-checked time on my lorry is hours old",
    a: "A lorry is only checked when one of its own alerts is due, so a twelve-hour alert is checked twice a day and that is what the time will show. If the lorry is paused it is not being checked at all, and the badge on [My trucks](/portal/trucks) says so.",
    category: "trucks",
    keywords: ["last checked", "purana", "old", "not updating", "stale", "kab"],
  },
  {
    q: "I added the lorry but nothing has happened since",
    a: "A lorry with no alert switched on is never checked — it sits on the list costing nothing and telling you nothing. Open it from [My trucks](/portal/trucks) and switch on one alert.",
    category: "trucks",
    keywords: ["nothing", "no alert", "added", "kuch nahi", "not working", "silent"],
  },

  /* ======================================================================= */
  /* alerts                                                                   */
  /* ======================================================================= */
  {
    q: "Where do the alerts actually reach me?",
    a: "On Telegram, and on the bell inside the app — every alert is always recorded in the app whether or not it was delivered. Set the delivery up in [Settings](/portal/settings).",
    category: "alerts",
    keywords: ["alert", "telegram", "kaha", "where", "message", "notification"],
  },
  {
    q: "Do I have to use Telegram?",
    a: "To have an alert reach your phone, yes — it is the only channel that delivers today. Read this twice: if no chat id is saved, or one is saved with the switch off, the alert is recorded in the app, never sent to anybody, and the credit is spent all the same.",
    category: "alerts",
    keywords: ["telegram", "zaruri", "must", "need", "without", "phone", "kaise"],
  },
  {
    q: "Can I get the alerts on WhatsApp or SMS?",
    a: "Not yet. WhatsApp appears in [Settings](/portal/settings) marked coming soon and sends nothing at all today, and there is no SMS channel — Telegram is the one that works.",
    category: "alerts",
    keywords: ["whatsapp", "sms", "message", "kab", "coming soon", "channel"],
  },
  {
    q: "How do I connect Telegram?",
    a: `Open [@${ID_BOT_USERNAME}](${ID_BOT_START_URL}), press Start, and it replies with a plain number — that is your chat id. Paste it into [Settings](/portal/settings), then press Start on [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) too, turn the alerts switch on and press Send test. Step by step in [alerts and Telegram](/guide/alerts).`,
    category: "alerts",
    keywords: ["telegram", "chat id", "connect", "kaise", "setup", "userinfobot", "Gst_truck_watch_bot"],
  },
  {
    q: "The Telegram test message does not arrive",
    a: `Almost always because [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) has never been started, and Telegram forbids a bot from messaging anyone who has not started it. Open it, send \`/start\`, then press Send test again in [Settings](/portal/settings).`,
    category: "alerts",
    keywords: ["test", "telegram", "not arriving", "nahi aaya", "bot", "start"],
  },
  {
    q: "The lorry moved but I got no message",
    a: "The usual cause is Telegram not being connected — check that a chat id is saved with the switch on in [Settings](/portal/settings) and that Send test arrives. After that: the alert may be switched off, the crossing may not have reached the toll network yet, or the reading may have named the plaza the lorry was already at, which is not a movement.",
    category: "alerts",
    keywords: ["no alert", "moved", "chala", "silent", "missing", "message nahi"],
  },
  {
    q: "It will not let me add the same alert twice",
    a: "One alert of each kind per lorry, refused by design — two of a kind means two beats on one question and two charges every time they coincide. The interval belongs to the alert you already have, so change it there instead of adding a second one.",
    category: "alerts",
    keywords: ["duplicate", "same alert", "twice", "refused", "already", "dobara"],
  },
  {
    q: "The toll plaza I want is not in the list",
    a: "The list only holds plazas some lorry has actually been recorded at, and it offers the ones ahead of your lorry first; spelling mistakes are forgiven, so try typing it. If nothing close comes up you can still confirm the name as typed — but an alert fires only on the exact name the toll record uses, so a name the network never produces stays silent for ever while checks keep costing credits.",
    category: "alerts",
    keywords: ["plaza", "toll", "not in list", "nahi mila", "search", "typo", "name"],
  },
  {
    q: "Is only-when-it-moves cheaper than every-time-we-look?",
    a: "No. All the alert kinds check exactly as often, so choosing only-when-it-moves makes your phone quieter, not your bill smaller. Only a slower interval, or pausing the lorry, spends less.",
    category: "alerts",
    keywords: ["cheap", "sasta", "cost", "kitna", "movement", "interval", "save"],
  },

  /* ======================================================================= */
  /* credits                                                                  */
  /* ======================================================================= */
  {
    q: "Why did my credits go down when the truck did not move?",
    a: "Because a credit is spent when a check runs, never on what the check finds. No movement, nothing new, an unchanged plaza, no alert raised — every one of those is a check that happened and a credit that is gone. See what it went on, lorry by lorry, on [Activity](/portal/activity).",
    category: "credits",
    keywords: ["credit", "kam", "kaise", "kyu", "paisa", "no movement", "gaya", "khatam"],
  },
  {
    q: "Does a check that failed still cost me a credit?",
    a: "Yes. A portal that did not answer, an empty result and a new crossing all cost the same one credit, because the asking is what is charged. That is why retrying a registration number the portal will not answer only buys errors.",
    category: "credits",
    keywords: ["failed", "error", "charge", "paisa", "wasted", "refund", "kata"],
  },
  {
    q: "Do the alerts and the Telegram messages cost credits?",
    a: "No. Alerts and their delivery are free — the only things that spend credits are a manual search, at one credit, and an automatic check, at one credit.",
    category: "credits",
    keywords: ["alert", "telegram", "free", "cost", "kitna", "charge", "message"],
  },
  {
    q: "Do my credits expire?",
    a: "Credits you have paid for never expire: they survive your plan ending, they survive a renewal, and they are still there months later. Free trial credits are the one exception — they belong to the trial and the unused balance is cleared when it ends.",
    category: "credits",
    keywords: ["expire", "khatam", "validity", "lifetime", "credit", "kab tak"],
  },
  {
    q: "What happens to my trial credits when the trial ends?",
    a: "They are cleared. Trial credits are not lifetime credits — they were free, the trial is over, and whatever is left goes with it, so the leftover cannot be spent later or restored by buying a plan. A plan starts a fresh term from the day you buy it and brings credits of its own.",
    category: "credits",
    keywords: ["trial", "credit", "khatam", "left", "bacha", "expire", "free"],
  },
  {
    q: "My plan has ended — have I lost my credits too?",
    a: "No. The credits are yours, they never expire, and they still pay for manual searches on [Search](/portal/search). What ends with the plan is automatic tracking and the ability to top up.",
    category: "credits",
    keywords: ["plan", "expired", "credit", "gone", "khatam", "bacha", "search"],
  },
  {
    q: "Why will it not let me buy credits?",
    a: "A top-up needs a plan that is running right now, and not a trial — so an expired plan, the free trial, or never having bought a plan are all refused. Buy or renew a plan on [Plan and credits](/portal/plan); a plan brings credits with it, and you can add a top-up to the same payment.",
    category: "credits",
    keywords: ["topup", "recharge", "refused", "blocked", "nahi ho raha", "buy", "credit"],
  },
  {
    q: "I have three alerts on one lorry — is that three credits a check?",
    a: "No. The charge is one credit per lorry per check, not per alert, so several alerts falling due on the same lorry at the same moment share one charge. A faster interval costs more; more rules on the same interval do not.",
    category: "credits",
    keywords: ["alert", "kitna", "credit", "three", "multiple", "charge", "per"],
  },
  {
    q: "Where can I see what my credits went on?",
    a: "[Activity](/portal/activity) breaks the spending down by day and by lorry, and [Credit history](/portal/credits) is the statement of everything added and used that got the balance to today's number.",
    category: "credits",
    keywords: ["history", "kaha", "spent", "report", "ledger", "hisab", "activity"],
  },
  {
    q: "How do I make my credits last longer?",
    a: "Slow the interval down and pause what you are not watching — those are the only two levers, because the number of checks a day is the spend a day. A paused lorry keeps every crossing it recorded, costs nothing while it sits there, and frees a slot on your plan.",
    category: "credits",
    keywords: ["save", "bachao", "kitna", "cost", "less", "interval", "pause", "band"],
  },

  /* ======================================================================= */
  /* plans                                                                    */
  /* ======================================================================= */
  {
    q: "Do I need a plan just to search one number by hand?",
    a: "No. Manual search runs on credits alone, so it works on an expired plan and on an account that never bought one — that is the point of credits never expiring. What needs a live plan is automatic tracking, and topping up.",
    category: "plans",
    keywords: ["plan", "search", "zaruri", "need", "manual", "without", "kya"],
  },
  {
    q: "What does a plan give me that credits do not?",
    a: "A plan decides how many lorries you may watch at once and until when, and it is what allows automatic checking and top-ups at all; credits decide what each look costs. You need both — a plan with an empty balance checks nothing, and credits with no plan still search by hand. The plan is charged once for its whole term, not monthly; see [pricing](/pricing).",
    category: "plans",
    keywords: ["plan", "credit", "difference", "antar", "kya", "monthly", "price"],
  },
  {
    q: "How many lorries can I watch at once?",
    a: "Whatever your plan allows, and the limit counts the lorries being watched rather than the ones on your list — so pausing one frees a slot for another. Your own limit and how much of it is in use are on [Plan and credits](/portal/plan).",
    category: "plans",
    keywords: ["kitne", "trucks", "limit", "how many", "gaadi", "lorry", "slot"],
  },
  {
    q: "My plan has expired — what still works?",
    a: "Manual search, and nothing else: automatic tracking stops and top-ups are refused until a plan is running again. Renew inside the window that [Plan and credits](/portal/plan) shows you and your lorries carry on exactly where they stopped; after it, they are switched off and you take them live again yourself.",
    category: "plans",
    keywords: ["expired", "khatam", "plan", "renew", "what works", "band", "search"],
  },
  {
    q: "How do I renew, or move to a bigger plan?",
    a: "Renewing is a button on [Plan and credits](/portal/plan), but only once the plan has actually ended. Changing plan, adding trucks mid-term or renewing early is not self-service — ask us through [contact](/contact) and we will set it up.",
    category: "plans",
    keywords: ["renew", "upgrade", "bigger", "change", "kaise", "plan", "badalna"],
  },
  {
    q: "If I do not use my plan, do I get the money back?",
    a: "A plan is charged once for its term and credits are a prepaid entitlement with no cash value, so there is no self-service refund. If you think you have been charged incorrectly, write to us through [contact](/contact) with the payment reference — the full position is in the [terms](/terms).",
    category: "plans",
    keywords: ["refund", "paisa wapas", "cancel", "unused", "money back", "return"],
  },
  /* ======================================================================= */
  /* payments                                                                 */
  /* ======================================================================= */
  {
    q: "I paid and my credits have not arrived",
    a: "The payment is confirmed by the gateway rather than by your browser, so on a weak connection the money moves a few seconds before the credits do — the page keeps checking by itself and you can leave it. If it still has not landed, find the payment on [Payments](/portal/payments) and send us its reference through [support](/support).",
    category: "payments",
    keywords: ["paid", "payment", "credit nahi", "not received", "pending", "paisa"],
  },
  {
    q: "My coupon code was refused",
    a: "The form says which of the reasons it was: the code is not recognised, it has not started or has expired, it has been used up or already used by you, it applies only to plans or only to credit top-ups, or the order is below its minimum. Check it against how the offer was worded, then ask us through [support](/support).",
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
    a: "The checkout on the site takes online payment only. If you need to pay another way, ask us first through [contact](/contact) — a payment we take offline is recorded on your account by hand, and credits are only added once it has actually reached us.",
    category: "payments",
    keywords: ["cash", "bank", "upi", "cheque", "offline", "paisa", "kaise"],
  },
  {
    q: "Will you charge my card again automatically?",
    a: "No. Nothing here renews itself — a plan is one payment for its term and a top-up is one payment for credits, so every charge is one you made yourself.",
    category: "payments",
    keywords: ["auto", "recurring", "subscription", "renew", "card", "monthly", "charge"],
  },

  /* ======================================================================= */
  /* rewards                                                                  */
  /* ======================================================================= */
  {
    q: "How much do I get for inviting somebody?",
    a: "A percentage of what they pay, twice: once on their first plan and once on their first top-up, with a smaller share going to them as well. The live percentages and a worked example are on [Invite and earn](/portal/referrals).",
    category: "rewards",
    keywords: ["referral", "invite", "kitna", "commission", "earn", "reward", "paisa"],
  },
  {
    q: "When do the referral credits reach me?",
    a: "As credits on your balance, automatically, the moment their payment goes through — nothing to claim. Each of the two events pays once per person, ever, and you can watch where each invitee stands on [Invite and earn](/portal/referrals).",
    category: "rewards",
    keywords: ["referral", "kab", "when", "credit", "milega", "reward", "paid"],
  },
  {
    q: "Does it pay when somebody just signs up on my link?",
    a: "No — a sign-up on its own earns nobody anything. The reward is paid when the person you invited pays for their first plan, and again on their first top-up.",
    category: "rewards",
    keywords: ["signup", "referral", "register", "kuch nahi", "earn", "join"],
  },
  {
    q: "Can I use my own invite link?",
    a: "No. A referral is attached at sign-up and one account cannot refer itself, so a second account you open on your own link earns nothing.",
    category: "rewards",
    keywords: ["self", "own link", "khud", "refer", "second account", "cheat"],
  },

  /* ======================================================================= */
  /* account                                                                  */
  /* ======================================================================= */
  {
    q: "The verification code has not arrived",
    a: "Look in the spam or junk folder — a first message from a new sender is often filed there, and marking it not spam helps every later email from us reach you. Each code can be used once and expires, so if nothing comes, send a fresh one from [verify email](/portal/verify-email).",
    category: "account",
    keywords: ["code", "otp", "email", "nahi aaya", "spam", "verify", "resend"],
  },
  {
    q: "The password reset link does not work",
    a: "Reset links last an hour and work once, so an old link or one you have already used will be refused. Ask for a new one at [forgot password](/forgot-password) and open it from the same phone, then choose the new password straight away.",
    category: "account",
    keywords: ["password", "reset", "link", "expired", "kaam nahi", "login", "bhul"],
  },
  {
    q: "I cannot find Sign out",
    a: "It is in the account menu, at the end of the portal navigation — on a phone open the menu, and on a laptop it is under your name at the top right of [the portal](/portal).",
    category: "account",
    keywords: ["sign out", "logout", "log out", "nikalna", "exit", "menu"],
  },
  {
    q: "Will I get phone notifications if I add the app to my iPhone home screen?",
    a: "No — the app itself sends no notifications on any phone, on the home screen or not. Alerts arrive on Telegram, and are always listed on the bell inside the app when you open it.",
    category: "account",
    keywords: ["iphone", "notification", "app", "home screen", "push", "install", "android"],
  },

  /* ======================================================================= */
  /* trouble                                                                  */
  /* ======================================================================= */
  {
    q: "My phone is silent but my balance keeps falling",
    a: "This is the Telegram problem and it is the first thing to check: an alert with no chat id saved, or a chat id with the switch off, is recorded in the app and never sent — and the credit is spent either way. Open [Settings](/portal/settings), confirm the id is saved and the switch is on, and press Send test.",
    category: "trouble",
    keywords: ["silent", "no message", "credit kam", "balance", "telegram", "paisa"],
  },
  {
    q: "Every one of my lorries stopped at the same moment",
    a: "That is an account-wide stop, not a fault on any lorry: either the balance ran out or the plan ended, and both stop every live lorry together. The badge on [My trucks](/portal/trucks) says which, and fixing the account comes before switching anything back on.",
    category: "trouble",
    keywords: ["all trucks", "sab band", "stopped", "paused", "together", "kyu"],
  },
  {
    q: "Everything is refused but the screen still shows credits",
    a: "That is a finished free trial: its credits ended with it, so the leftover figure cannot be spent on anything. Choosing a plan on [Plan and credits](/portal/plan) starts you again, and a plan can bring credits with it.",
    category: "trouble",
    keywords: ["refused", "credit hai", "blocked", "trial", "not working", "kyu"],
  },
  {
    q: "I searched a lorry and nothing came back",
    a: "Nothing found means nothing was recorded — not that the lorry is not moving. Check the number for a typo, remember that untolled and state roads produce no records at all, then try a lorry you know runs on highways to satisfy yourself the search is working. The credit is still spent, because the asking is what costs.",
    category: "trouble",
    keywords: ["nothing", "no result", "kuch nahi", "empty", "search", "lorry", "not found"],
  },
  {
    q: "Can I use a toll crossing as proof?",
    a: "No — treat it as a lead, not as evidence. Records arrive late, arrive incomplete or never arrive, a gap has innocent explanations, and every timestamp means recorded at rather than is at; corroborate anything you act on by other means. The [terms](/terms) and [data sources](/data-sources) set out what may and may not be relied on.",
    category: "trouble",
    keywords: ["proof", "evidence", "court", "saboot", "legal", "reliable", "delay"],
  },
];
