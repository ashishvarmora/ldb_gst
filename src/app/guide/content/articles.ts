import type { GuideArticle } from "./types";
import { ALERT_BOT_START_URL, ALERT_BOT_USERNAME, ID_BOT_START_URL, ID_BOT_USERNAME } from "@/lib/telegram-bot";

/**
 * The help centre's articles.
 *
 * Two rules held this file to what it says, and both are worth keeping when it
 * is edited.
 *
 * 1. NO NUMBER THE DATABASE OWNS. Plan prices, plan credits, truck limits,
 *    trial days, trial credits, pack prices, the referral percentages, the
 *    no-movement window and the failure limit are all rows an administrator
 *    edits without a deploy. Prose that quotes one of them is prose that goes
 *    silently wrong, so every one of them is pointed at instead - the pricing
 *    page, the officer's own screen, or the field that holds it. Manual search
 *    is stated as one credit; an automatic check is "your plan's rate", because
 *    each plan can set its own (0064).
 *
 * 2. THE MONEY RULES ARE STATED, NOT SOFTENED. A credit is spent when a check
 *    runs and never on its outcome; trial credits outlive the trial (0057); an
 *    expired plan searches but does not track and cannot top up; renewing and
 *    topping up never switch a truck back on by themselves. Every one of those
 *    surprises somebody, and a guide that hedges them is the reason they were
 *    surprised.
 */
export const ARTICLES: GuideArticle[] = [
  /* ======================================================================== */
  /* start                                                                     */
  /* ======================================================================== */
  {
    slug: "what-rahdari-does",
    title: "What Rahdari does, and what it costs you",
    summary:
      "Enter a truck number to see the toll plazas it crossed. Each search uses one credit.",
    category: "start",
    minutes: 3,
    keywords: [
      "what is rahdari",
      "lorry",
      "gaadi",
      "truck tracking",
      "toll",
      "FASTag",
      "kitna",
      "kya hai",
      "cost",
      "credit",
    ],
    blocks: [
      {
        kind: "p",
        text: "Enter a truck's vehicle number. Rahdari checks the national toll records for that number and shows the plazas it has crossed, newest first, with the time of each crossing.",
      },
      {
        kind: "p",
        text: "You can search manually whenever you need to. Or you can track a truck, and Rahdari checks it automatically at an interval you choose and alerts you when it finds a new crossing.",
      },
      { kind: "h", text: "How a crossing reaches your screen" },
      {
        kind: "steps",
        items: [
          "A truck passes a tolled highway plaza.",
          "The gantry at that plaza records the passing.",
          "The record reaches the national logistics data infrastructure.",
          "Rahdari retrieves it and shows it on your screen.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "This is not GPS",
        text: "A truck is recorded only where it crosses a toll plaza. A truck on state roads, on a short local run, or one that has not crossed a plaza recently shows no records. No records does not mean the truck is not moving. Records can also arrive late, so read every time as when the crossing was recorded, not where the truck is now.",
      },
      { kind: "h", text: "What each action costs" },
      {
        kind: "p",
        text: "There is one balance, called credits. Searches and automatic checks both use it.",
      },
      {
        kind: "table",
        head: ["What you do", "What it costs"],
        rows: [
          ["A manual search", "1 credit"],
          ["One automatic check of a tracked truck", "At your plan's rate (see Pricing)"],
          ["Sending an alert", "Free"],
          ["Adding a truck, adding an alert, making a group", "Free"],
          ["Pausing a truck", "Free, and it uses no credits while paused"],
        ],
      },
      {
        kind: "p",
        text: "Check frequency sets your cost. A truck checked every fifteen minutes is checked 96 times a day, and each check uses credits at your plan's rate. A truck checked every six hours is checked four times a day. Read [how credits work](/guide/start/how-credits-work) before you start tracking.",
      },
      { kind: "h", text: "What you need to buy" },
      {
        kind: "p",
        text: "A plan sets how many trucks you can track and for how long; credits pay for each search and check. Tracking needs both — a plan with an empty balance checks nothing. Credits without a plan still pay for manual searches.",
      },
      {
        kind: "note",
        tone: "info",
        title: "What the records can and cannot show",
        text: "A crossing means the truck was recorded at that plaza at that time. It does not show where the truck is now, and a gap does not mean it stopped. Use it as an operational record; verify through official channels where proof is needed. See [where the data comes from](/data-sources).",
      },
      { kind: "cta", href: "/pricing", label: "See plans and pricing", hint: "Current prices" },
    ],
    faqs: [
      {
        q: "Can I see where a truck is right now?",
        a: "No. You see the last toll plaza it was recorded crossing. Between plazas, and on roads with no plaza, there are no records.",
      },
      {
        q: "Does a search cost the same whether it finds something or not?",
        a: "Yes. A search that returns no crossings uses one credit, like any other. If the search cannot reach the toll records, the credit is returned.",
      },
      {
        q: "Do I need a plan just to search one truck by hand?",
        a: "No. Manual search uses your credit balance and works even after a plan has ended. Automatic tracking needs an active plan.",
      },
    ],
  },

  {
    slug: "create-your-account",
    title: "Open an account and confirm your email",
    summary:
      "Sign up with an email address and a password, then enter the six-digit code we email you. Both are free.",
    category: "start",
    minutes: 2,
    keywords: [
      "sign up",
      "register",
      "account",
      "khata",
      "email code",
      "OTP",
      "six digit",
      "verify",
      "login",
    ],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open [the sign-up page](/signup) and register with an email address and a password. Nothing is charged for this.",
          "Add your mobile number when asked. We use it only to contact you about your account.",
          "Open [Verify your email](/portal/verify-email) and send yourself the code.",
          "Check your inbox and enter the six-digit code.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Do not skip the code",
        text: "The free trial starts only after your email is confirmed, as the trial is limited to one per account. Buying a plan or credits does not need the code — only the trial does.",
      },
      { kind: "h", text: "If the code does not arrive" },
      {
        kind: "bullets",
        items: [
          "Check the spam and promotions folders first.",
          "Check that the address shown on screen is correct. The code is sent to that address.",
          "Codes can take a minute to arrive. Each code works once; if one has expired, send a new one.",
          "You can send it again from the same page.",
        ],
      },
      {
        kind: "p",
        text: "If it still does not arrive, write to us from [the contact page](/contact) with your registered email address and our team will help.",
      },
      { kind: "cta", href: "/signup", label: "Open an account" },
    ],
    faqs: [
      {
        q: "Can I change my sign-in email later?",
        a: "Please write to us. It cannot be changed in the app, because your trial, receipts and password reset are linked to it.",
      },
      {
        q: "Is my mobile number required?",
        a: "Yes, please add it. We use it to contact you about your account, and the trial is limited to one per mobile number as well as one per account.",
      },
      {
        q: "I registered but nothing is being tracked. Why?",
        a: "Signing up only opens the account. Automatic checks need a plan or an active trial, plus a truck with at least one alert switched on. Follow [your first truck, end to end](/guide/start/first-truck-in-five-minutes).",
      },
    ],
  },

  {
    slug: "the-free-trial",
    title: "Claim the free trial",
    summary:
      "A short trial with a set amount of free credits, once per account, after your email is confirmed. It ends when either the days or the credits run out.",
    category: "start",
    minutes: 2,
    keywords: [
      "free trial",
      "trial",
      "free",
      "muft",
      "free credit",
      "demo",
      "test",
      "kitna free",
    ],
    blocks: [
      {
        kind: "p",
        text: "Go to [Plan and credits](/portal/plan) and press Start the free trial. The trial starts when you press the button, not on the day you signed up.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "The trial ends on whichever runs out first",
        text: "The trial is limited by both days and credits. If the credits are used up on day two, the trial ends on day two. If the days run out first, the trial ends then, even with credits left. Your [Plan and credits](/portal/plan) page shows both.",
      },
      { kind: "h", text: "Trial limits" },
      {
        kind: "bullets",
        items: [
          "It cannot be topped up. Buying credits needs an active paid plan, so when trial credits run out, choose a plan to continue.",
          "Automatic tracking stops when the trial ends. Any unused credits stay on your balance and can still be used for manual searches.",
          "It is limited to one per account, email address and mobile number. If you think this is wrong for you, write to us.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Credits do not expire",
        text: "Credits do not expire, including trial credits. They remain after a plan or trial ends, and can still be used for manual searches.",
      },
      { kind: "h", text: "Make the trial last" },
      {
        kind: "p",
        text: "Trial credits do not last long with frequent checks: one truck checked every fifteen minutes is checked 96 times a day. Set a longer check interval — an hour, or three hours — and the trial lasts several days instead of one afternoon. See [check frequency and cost](/guide/trucks/how-often-we-look).",
      },
      { kind: "cta", href: "/portal/plan", label: "Start the free trial" },
    ],
    faqs: [
      {
        q: "Can I get a second trial?",
        a: "No. The trial is limited by account, email address and mobile number. If you have a genuine need for more trial time, write to us rather than creating a second account.",
      },
      {
        q: "My trial ended. What happens to my remaining credits?",
        a: "They stay on your balance and can be used for manual searches. Automatic tracking needs a plan. Every credit added and used is shown in [your credit history](/portal/credits).",
      },
      {
        q: "Do I have to give card details for the trial?",
        a: "No. The trial is free and needs no payment details. You only see a payment screen when you choose a plan.",
      },
    ],
  },

  {
    slug: "first-truck-in-five-minutes",
    title: "Your first truck, end to end",
    summary:
      "Five steps, in order. Set up alerts before you start tracking, so you do not miss crossings.",
    category: "start",
    minutes: 3,
    keywords: [
      "first truck",
      "getting started",
      "shuru",
      "kaise",
      "setup",
      "add truck",
      "gaadi add",
      "quick start",
    ],
    blocks: [
      {
        kind: "p",
        text: "Follow these steps in order. Set up alerts (step three) before tracking, so you are notified of every crossing.",
      },
      {
        kind: "steps",
        items: [
          "Confirm your email with the six-digit code, then start the free trial or choose a plan on [Plan and credits](/portal/plan). Automatic checks need a plan or trial.",
          "Try a manual search on [Search](/portal/search). Enter any vehicle number. It uses one credit and confirms your account is working.",
          "Set up alerts in [Settings](/portal/settings) before you start tracking: turn on phone notifications or connect Telegram, then press Send test. If the test does not arrive, alerts will not either.",
          "Add the truck on [My trucks](/portal/trucks). The form asks for the number and then for its first alert.",
          "Give it one alert and choose a check interval. Only when it moves is a good default, and an hour is a good first interval. Checking every fifteen minutes uses 96 checks a day for that truck.",
        ],
      },
      {
        kind: "figure",
        name: "portal-home",
        caption: "The home screen after signing in: your balance and the first things to set up.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A truck with no alert is never checked",
        text: "It stays on the list but is not checked and sends no alerts. That is why the add form asks for the first alert together with the number.",
      },
      {
        kind: "note",
        tone: "good",
        title: "How to tell it is working",
        text: "Within one check interval, the truck's page shows a last-checked time, and [your activity page](/portal/activity) shows the check and its cost. A new crossing sends you an alert. If the first two happen but no alert arrives, check your alert settings — see [I got no alert](/guide/trouble/no-alert-arrived).",
      },
      { kind: "cta", href: "/portal/trucks", label: "Add your first truck" },
    ],
    faqs: [
      {
        q: "How long until I see something?",
        a: "The first check runs within one check interval of the alert you set. An alert is sent only when there is something new: with Only when it moves, a parked truck sends no alert.",
      },
      {
        q: "Should I start with frequent checks to see it working?",
        a: "No. Use Check now on the truck's page instead — it uses one credit and shows the result straight away. Keep the automatic interval longer until you know what you need.",
      },
      {
        q: "Can I add several trucks at once?",
        a: "Add them one at a time on [My trucks](/portal/trucks), because each one needs its own alert. For reading several together afterwards, put them in a group on [Groups](/portal/cases).",
      },
    ],
  },

  {
    slug: "how-credits-work",
    title: "How credits work",
    summary:
      "One credit balance pays for searches and automatic checks. A plan separately sets how many trucks you can track and for how long.",
    category: "start",
    minutes: 3,
    keywords: [
      "credit",
      "credits",
      "balance",
      "paise",
      "recharge",
      "kitna credit",
      "plan vs credit",
      "wallet",
      "top up",
    ],
    blocks: [
      {
        kind: "p",
        text: "Your account has one credit balance. It pays for manual searches (one credit each) and automatic checks of tracked trucks (at your plan's rate, shown on [Pricing](/pricing)). Nothing else uses credits.",
      },
      { kind: "h", text: "A plan and credits are two different things" },
      {
        kind: "table",
        head: ["", "A plan", "Credits"],
        rows: [
          ["Sets", "How many trucks at once, and until when", "How many searches and checks you can run"],
          ["Charged", "Once, for the whole term — not per month", "Whenever you top up"],
          ["Expires", "On its end date", "Never"],
        ],
      },
      {
        kind: "p",
        text: "Tracking needs both. A plan with an empty balance checks nothing. Credits without a plan still pay for manual searches.",
      },
      { kind: "h", text: "What to buy when you run short" },
      {
        kind: "bullets",
        items: [
          "If checks are refused, or every truck is paused with No credits left, top up credits.",
          "If you cannot add another truck, you need a larger plan.",
          "If your plan has ended, renew it to resume automatic checks. Credits alone will not.",
        ],
      },
      { kind: "h", text: "Credits are used when a check runs" },
      {
        kind: "p",
        text: "Automatic checks are charged when they run, whatever the result — a new crossing, nothing new, no response from the toll records, or an alert that could not be delivered.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Check frequency sets your cost",
        text: "One truck checked every fifteen minutes is 96 checks a day, whether it moves or not. Pausing a parked truck is the best way to save credits.",
      },
      { kind: "h", text: "Do credits expire" },
      {
        kind: "p",
        text: "Credits never expire, including trial credits. They remain after a plan or trial ends, and can still be used for manual searches.",
      },
      { kind: "cta", href: "/portal/credits", label: "See your credit history", hint: "Every credit in and out, with dates" },
    ],
    faqs: [
      {
        q: "Do more alerts on one truck cost more?",
        a: "No. Credits are charged per truck per check, not per alert. Several alerts due on the same truck at the same time share one check. A shorter check interval costs more; more alerts on the same interval do not.",
      },
      {
        q: "I have credits but my plan ended. Can I still use them?",
        a: "Yes, for manual searches. Automatic tracking needs an active plan.",
      },
      {
        q: "Does an alert or a Telegram message cost anything?",
        a: "No. Alerts and messages are free. Only searches and checks use credits.",
      },
      {
        q: "Is a failed search charged?",
        a: "Automatic checks are charged when they run. A manual search that cannot reach the toll records is not charged — the credit is returned.",
      },
    ],
  },

  /* ======================================================================== */
  /* trucks                                                                    */
  /* ======================================================================== */
  {
    slug: "add-a-truck",
    title: "Add a truck",
    summary:
      "The number, an optional remark, its first alert, and three optional limits that pause it automatically. Adding a truck is free.",
    category: "trucks",
    minutes: 2,
    keywords: [
      "add truck",
      "add lorry",
      "gaadi add karo",
      "new truck",
      "registration number",
      "number plate",
      "watch",
      "track",
    ],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open [My trucks](/portal/trucks) and press Add a truck.",
          "Enter the vehicle number. Spaces and capitals do not matter — `GJ01AB1234` and `gj 01 ab 1234` are the same truck.",
          "Add a remark if it helps you recognise it later, such as the transporter or the route. Only you see it.",
          "Choose its first alert and check interval. The interval decides how many credits it uses.",
          "Save. Adding a truck is free; only checks use credits.",
        ],
      },
      {
        kind: "figure",
        name: "add-truck",
        caption: "The add form: the number, a remark, and the first alert in the same step.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A truck with no alert is never checked",
        text: "That is why the first alert is part of the add form. With no alert switched on, the truck stays on your list but is not checked and sends no alerts.",
      },
      { kind: "h", text: "Automatic pause limits" },
      {
        kind: "p",
        text: "The add form has three optional limits that stop a forgotten truck from using credits. You can leave them blank and change them later on the truck's page.",
      },
      {
        kind: "bullets",
        items: [
          "Stop checking after — an end time. Checks stop at that time automatically.",
          "Stop checking after this many failures — how many unsuccessful checks in a row before it pauses. Leave it blank to use the default shown in the field.",
          "Pause if it stops moving for — how long a truck can go without a new crossing before checks pause. Leave it blank to use the default shown in the field.",
        ],
      },
      { kind: "h", text: "Slots" },
      {
        kind: "p",
        text: "Your plan sets how many trucks can be tracked at once. My trucks shows how many slots are free. A paused truck does not use a slot, so pausing one frees room for another.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Go to My trucks" },
    ],
    faqs: [
      {
        q: "I typed the number wrong. What happens?",
        a: "Checks for a number that does not exist return no result, and automatic checks are charged when they run. After five unsuccessful checks in a row we notify you, and at the failure limit the truck pauses. Correct the number on the truck's page before switching it back on.",
      },
      {
        q: "Can I add the same truck twice?",
        a: "There is no need to. One truck can have one alert of each type, plus a plaza alert for each named plaza, which covers what a second copy would do.",
      },
      {
        q: "Does removing a truck delete its history?",
        a: "No. Its alerts are removed and its slot is freed, but every recorded toll crossing is kept.",
      },
    ],
  },

  {
    slug: "my-trucks-and-the-truck-page",
    title: "My trucks, and a truck's own page",
    summary:
      "What each row on the list shows, and what is on each truck's page: the route, the alerts, and every check with its cost.",
    category: "trucks",
    minutes: 3,
    keywords: [
      "my trucks",
      "truck list",
      "gaadi list",
      "watchlist",
      "live tracking",
      "truck page",
      "history",
      "route",
      "last checked",
    ],
    blocks: [
      { kind: "h", text: "The two tabs" },
      {
        kind: "bullets",
        items: [
          "Live tracking — checked automatically and using credits.",
          "Watchlist — on your list, not checked and not using credits.",
        ],
      },
      {
        kind: "p",
        text: "Use the switch on a truck's row to move it between the two. Nothing is deleted either way.",
      },
      { kind: "h", text: "What a row tells you" },
      {
        kind: "table",
        head: ["On the row", "What it shows"],
        rows: [
          ["The vehicle number", "Tap it to open the truck's page"],
          ["A badge", "Whether it is live, or why it paused"],
          ["The switch", "Starts and stops tracking for this truck"],
          ["Recent activity", "Its last crossing, and how often it is checked"],
        ],
      },
      {
        kind: "figure",
        name: "truck-row",
        caption: "One row: the number, its badge, the switch, and its check interval.",
      },
      { kind: "h", text: "The truck's page" },
      {
        kind: "p",
        text: "Tap the number to open it. From top to bottom, the page shows:",
      },
      {
        kind: "bullets",
        items: [
          "The number, its badge, and when it was last checked. If it is paused, the (i) on the badge shows when and why.",
          "Check now — an immediate check for one credit, without waiting for the next scheduled check.",
          "Pause and Go live — the same switch as on the list, with more detail.",
          "Alerts on this truck — each alert, its check interval, and whether it is switched on.",
          "Route — every recorded toll crossing, newest first.",
          "Alerts raised — what was sent about this truck, and whether it was delivered.",
          "Every check, and its cost — opens [your activity](/portal/activity) filtered to this truck, so you can see the credits it has used.",
          "Settings — the remark, the tracking switch, the three pause limits, and Remove.",
        ],
      },
      {
        kind: "figure",
        name: "truck-detail",
        caption: "A truck's page: last checked, where it was last recorded, and what to do next.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Only movements are stored",
        text: "A check that reports the same plaza as before is not added to the route. A short route list does not mean checks are missing — it means the truck has not crossed a new plaza. The full list of checks is on the activity page.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Open My trucks" },
    ],
    faqs: [
      {
        q: "The route is empty but the balance is going down. Is something broken?",
        a: "Probably not. Automatic checks are charged whether or not they find a new crossing, and only new crossings are added to the route. If the last-checked time is recent, checks are working and the truck has not crossed a new plaza.",
      },
      {
        q: "What does Check now cost?",
        a: "One credit, the same as a manual search. The button shows the cost before you press it.",
      },
      {
        q: "Can I read several trucks together?",
        a: "Yes. Put them in a group on [Groups](/portal/cases) and their crossings appear on one combined timeline. Groups are free.",
      },
    ],
  },

  {
    slug: "going-live-and-pausing",
    title: "Going live, switching off, and every reason a truck pauses",
    summary:
      "Pausing is the best way to manage your credit use. Seven things can stop a truck being checked; you can undo four of them yourself.",
    category: "trucks",
    minutes: 4,
    keywords: [
      "pause",
      "band",
      "chalu",
      "resume",
      "go live",
      "stop tracking",
      "auto pause",
      "paused reason",
      "why paused",
      "save credit",
    ],
    blocks: [
      {
        kind: "p",
        text: "The switch on a truck's row and the Pause and Go live buttons on its page are the same control. Live means it is checked and uses credits. Paused means it is not checked and uses no credits.",
      },
      {
        kind: "note",
        tone: "good",
        title: "Nothing is lost by pausing",
        text: "Paused trucks keep their history and use no credits. Resume any time. Alerts, settings and recorded crossings are all kept, and the slot is free for another truck meanwhile.",
      },
      {
        kind: "p",
        text: "A parked truck returns the same crossing on every check, and each check uses credits. Pausing a parked truck is the best way to save credits.",
      },
      { kind: "h", text: "Why a truck stops being checked" },
      {
        kind: "table",
        head: ["Badge", "What happened", "Can you switch it back on?"],
        rows: [
          ["Paused by you", "You paused it", "Yes, whenever you like"],
          [
            "Tracking period ended",
            "The end time you set for it arrived",
            "Yes — and set a new end time at the same moment",
          ],
          [
            "No movement detected",
            "No new toll crossing for the time set for this truck",
            "Yes, when it is back on the road",
          ],
          [
            "No response for this number",
            "Too many checks in a row returned no result for this number",
            "Yes, after checking the number is correct",
          ],
          [
            "No credits left",
            "Your balance ran out, so all live trucks paused",
            "No — top up first, then switch them back on",
          ],
          [
            "Plan ended",
            "The plan ended and was not renewed in time, so all trucks were switched off",
            "No — renew first, then switch them back on",
          ],
          [
            "Account suspended",
            "This account is on hold, so no trucks are checked",
            "No — contact support",
          ],
        ],
      },
      {
        kind: "figure",
        name: "pause-badges",
        caption: "Each badge shows why the truck paused.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "The last three need account action first",
        text: "With an empty balance, an ended plan or an account on hold, a truck switched on would pause again at its next check. Top up, renew, or contact us first, then switch each truck back on.",
      },
      { kind: "h", text: "Renewing and topping up do not restart trucks automatically" },
      {
        kind: "p",
        text: "Topping up or renewing a plan allows automatic checks again, but does not switch trucks back on by itself. Go to [My trucks](/portal/trucks) and switch on the ones you need. This prevents credits being used on trucks you no longer need to track.",
      },
      { kind: "h", text: "How the no-movement pause works" },
      {
        kind: "p",
        text: "The time is counted from the later of the last crossing and the moment the truck went live — not from an older crossing. So a truck that has been parked for a week still gets the full window from the moment you switch it on. Each new crossing resets the time. The window is the Pause if it stops moving for field in the truck's Settings, which shows the default when left blank.",
      },
      { kind: "h", text: "How the failure pause works" },
      {
        kind: "p",
        text: "A check fails when the toll records return no result for that number. After five unsuccessful checks in a row we notify you once. At the truck's failure limit it pauses, because automatic checks are charged when they run. The usual cause is an incorrect number. Correct it and switch the truck back on.",
      },
      {
        kind: "note",
        tone: "info",
        title: "No charge on pausing",
        text: "A truck that reaches one of its pause limits is not charged for a final check. The pause is decided before any credit is used.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Review live trucks", hint: "Trucks on the Live tracking tab use credits" },
    ],
    faqs: [
      {
        q: "Does pausing lose my alerts or my history?",
        a: "No. Alerts keep their settings, and every recorded crossing is kept. Switching back on continues where it stopped.",
      },
      {
        q: "My truck paused itself and I did not do anything. Why?",
        a: "The reason is shown on the row and on the truck's page. The most common are no recent movement, an end time you set, and an empty balance.",
      },
      {
        q: "Does a paused truck use a slot on my plan?",
        a: "No. Only live trucks use slots, so pausing one frees room for another.",
      },
      {
        q: "I renewed my plan. Why is nothing being checked?",
        a: "Renewing does not switch trucks back on automatically. Open [My trucks](/portal/trucks) and switch on the ones you need.",
      },
    ],
  },

  {
    slug: "how-often-we-look",
    title: "Check frequency and cost",
    summary:
      "How often a truck is checked decides how many credits it uses. Read this before you start tracking.",
    category: "trucks",
    minutes: 3,
    keywords: [
      "interval",
      "how often",
      "kitni der",
      "15 minutes",
      "beat",
      "frequency",
      "credits a day",
      "cost per day",
      "bill",
    ],
    blocks: [
      {
        kind: "p",
        text: "Every alert has its own check interval — how often that truck is checked. Each check uses credits at your plan's rate. The table below assumes 1 credit per check; see [Pricing](/pricing) for your plan's rate.",
      },
      {
        kind: "table",
        head: ["Check every", "Checks a day", "Credits a day, per truck (at 1 credit per check)"],
        rows: [
          ["15 minutes", "96", "96"],
          ["30 minutes", "48", "48"],
          ["1 hour", "24", "24"],
          ["3 hours", "8", "8"],
          ["6 hours", "4", "4"],
          ["12 hours", "2", "2"],
        ],
      },
      {
        kind: "p",
        text: "Two trucks on the same interval use twice this. Ten trucks checked every fifteen minutes use about 960 checks a day.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Plan credits and frequent checks",
        text: "Included credits suit moderate check intervals. For frequent checks, plan to top up. A longer interval makes the same credits last much longer.",
      },
      { kind: "h", text: "Choosing a check interval" },
      {
        kind: "bullets",
        items: [
          "A consignment you are waiting on: 15 or 30 minutes, then pause it when it arrives.",
          "A truck you want a daily update on: 3, 6 or 12 hours.",
          "A truck you only need to know about when it reaches one plaza: a longer interval is usually enough.",
          "A truck parked in a yard: pause it.",
        ],
      },
      {
        kind: "p",
        text: "The field takes minutes or hours, and the line below it shows how many checks a day that is. You can change it any time from the truck's page.",
      },
      { kind: "h", text: "More alerts do not mean more cost" },
      {
        kind: "p",
        text: "Credits are charged per truck per check, not per alert. Two alerts due on the same truck at the same time share one check. Two alerts on different intervals produce checks at both intervals, which can mean more checks than intended. That is why each truck can have only one alert of each type.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Only when it moves is not cheaper",
        text: "All alert types are checked at the same rate. Only when it moves sends fewer messages but does not use fewer credits. Only a longer check interval does that.",
      },
      { kind: "cta", href: "/portal/activity", label: "See your credit use by truck" },
    ],
    faqs: [
      {
        q: "What is the shortest check interval?",
        a: "The field accepts short intervals, but no truck is checked more often than the platform's own schedule allows, and frequent checks use the most credits. Start at an hour and shorten it only for a truck you are waiting on.",
      },
      {
        q: "If a truck does not move, do I still pay?",
        a: "Yes. Each check uses credits when it runs, whatever it finds. The no-movement auto-pause limits this.",
      },
      {
        q: "Can I set a different interval for a night run?",
        a: "Not on a schedule. Change the interval on the truck's page when needed, or pause the truck and switch it back on when the run starts.",
      },
    ],
  },

  /* ======================================================================== */
  /* alerts                                                                    */
  /* ======================================================================== */
  {
    slug: "choosing-alert-rules",
    title: "Choosing alert rules",
    summary:
      "Three alert types, one of each per truck. They differ in what you are notified about, not in cost.",
    category: "alerts",
    minutes: 3,
    keywords: [
      "alert",
      "alerts",
      "rule",
      "location change",
      "moved",
      "toll plaza alert",
      "plaza",
      "notification",
      "message",
      "kab batayega",
    ],
    blocks: [
      {
        kind: "p",
        text: "A truck is checked only when it has an alert, and the alert decides what you are notified about. Add one from the truck's page under Alerts on this truck.",
      },
      {
        kind: "table",
        head: ["Alert", "What you are notified about", "Example message"],
        rows: [
          [
            "Every check",
            "A message on every check with the truck's latest plaza, even if unchanged",
            "`GJ02AT8546 is at Nadiad Toll Plaza`",
          ],
          [
            "Only when it moves",
            "Checked just as often, but you are notified only when it reaches a different plaza",
            "`GJ02AT8546 moved to Nadiad Toll Plaza`",
          ],
          [
            "When it reaches a plaza",
            "Name one plaza. You are notified the first time the truck is recorded there",
            "`GJ02AT8546 reached Nadiad Toll Plaza`",
          ],
        ],
      },
      {
        kind: "figure",
        name: "alert-rules",
        caption: "Choosing an alert type and check interval. The line below the field shows how many checks a day that is.",
      },
      {
        kind: "p",
        text: "Only when it moves is the recommended default. Every check suits a truck you want a running log of, and sends many messages.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "All three cost the same",
        text: "All types are checked at the same rate, so they use the same credits. Only when it moves sends fewer messages, not fewer checks. The check interval sets the cost — see [check frequency and cost](/guide/trucks/how-often-we-look).",
      },
      { kind: "h", text: "One alert of each type per truck" },
      {
        kind: "p",
        text: "Each truck can have one switched-on alert of each type, plus one for each named plaza. This avoids extra cost: two Only when it moves alerts on different intervals would check the same truck twice for the same answer.",
      },
      { kind: "h", text: "The toll plaza alert, and choosing a plaza" },
      {
        kind: "p",
        text: "When it reaches a plaza needs one plaza named. The picker helps in two ways:",
      },
      {
        kind: "bullets",
        items: [
          "It suggests plazas ahead of this truck, based on its last crossing and direction of travel. If it has only one recorded crossing, it suggests the nearest plazas instead and says so. Distances are straight-line, so they are shorter than by road.",
          "If you type instead, small spelling mistakes still find the plaza. Select the suggestion rather than keeping what you typed: the alert needs an exact match with the plaza name in the toll record.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Two different plazas are two different alerts",
        text: "Alerts for Nadiad and for Malvan are separate, so both are allowed on one truck. When their checks fall at the same time, they share one check.",
      },
      { kind: "h", text: "Switching an alert off" },
      {
        kind: "p",
        text: "A switched-off alert runs no checks and uses no credits. It is worth keeping rather than deleting: it keeps your check interval and the last plaza it reported, so you are not alerted again about a crossing you already know about when you switch it back on.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Open a truck and add an alert" },
    ],
    faqs: [
      {
        q: "Can I get an alert when a truck leaves a state, or enters a city?",
        a: "Not as a separate alert type. Use When it reaches a plaza for a plaza on that route, or Only when it moves and follow the plaza names as they arrive.",
      },
      {
        q: "I added a plaza alert and heard nothing when the truck passed it.",
        a: "Check that the plaza name was selected from the suggestions rather than typed. The alert needs an exact match with the plaza name in the toll record. Also check that the truck is on the Live tracking tab.",
      },
      {
        q: "Why can I not add two Only when it moves rules?",
        a: "Two would check the same thing twice and charge for both. Change the check interval on your existing alert instead.",
      },
    ],
  },

  {
    slug: "telegram-alerts",
    title: "Where alerts are delivered, and setting up Telegram",
    summary:
      "Choose phone notifications or Telegram for your alerts. Connect your preferred channel in Settings and send a test before relying on it.",
    category: "alerts",
    minutes: 3,
    keywords: [
      "telegram",
      "chat id",
      "notification",
      "phone",
      "message nahi aaya",
      "whatsapp",
      "bell",
      "alerts not coming",
      "userinfobot",
      "Gst_truck_watch_bot",
    ],
    blocks: [
      {
        kind: "p",
        text: "Alerts can arrive as phone notifications, Telegram messages or WhatsApp once connected in Notifications. They also appear in the app’s notification bell. WhatsApp carries only the important ones: a plaza crossing, a move to a new plaza, a halt and moving again. Every-check updates and hourly halt reminders come in the app and on Telegram.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Set up alerts before tracking",
        text: "If neither phone notifications nor Telegram are set up, alerts are saved in the app but not sent to your phone — and checks still use credits. Set up notifications in Settings and send a test before you start tracking.",
      },
      { kind: "h", text: "Find your chat ID" },
      {
        kind: "steps",
        items: [
          `Open [@${ID_BOT_USERNAME}](${ID_BOT_START_URL}) in Telegram and press Start. It replies with a number — that is your chat ID.`,
          "Copy that number.",
        ],
      },
      { kind: "h", text: "Save it and test it" },
      {
        kind: "steps",
        items: [
          "Paste the number into the Chat ID field in [Settings](/portal/settings) and save.",
          "Turn on Send me alerts on Telegram. If the switch is off, nothing is sent.",
          "Press Send test. If the test message arrives, alerts will arrive.",
          `If it does not arrive, open [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) and send it \`/start\`, then test again. Telegram bots can only message people who have started them.`,
        ],
      },
      {
        kind: "figure",
        name: "telegram-setup",
        caption: "The chat ID field, the switch below it, and Send test.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Why two bots",
        text: "The first bot only tells you your chat ID and sends nothing afterwards. Alerts come from our own bot, which is why it needs its own `/start`. Send test confirms that both steps are done.",
      },
      { kind: "h", text: "If Telegram is silent" },
      {
        kind: "p",
        text: "Work through these in order:",
      },
      {
        kind: "steps",
        items: [
          "Telegram is installed and signed in on that phone.",
          "Telegram's own notifications are allowed in the phone's settings. On an iPhone that is Settings, then Notifications, then Telegram.",
          "The chat ID is saved and the switch under it is on.",
          `You have sent [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) a \`/start\`.`,
          "Send test reports connected.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "The bell is your alert history",
        text: "The bell at the top of the screen lists the same alerts inside the app. To be notified on your phone, turn on phone notifications or connect Telegram in Settings.",
      },
      { kind: "cta", href: "/portal/notifications", label: "Set up alerts", hint: "Before you start tracking" },
    ],
    faqs: [
      {
        q: "An alert says it was not delivered. Do I get the credit back?",
        a: "No. Credits pay for the check, which ran. Delivery is separate and free. The alert is kept in the app with the reason it was not delivered.",
      },
      {
        q: "Can I send alerts to a group or to my team?",
        a: "You can save one chat ID. A Telegram group has its own ID, so you can use a group chat — get its ID the same way and paste that instead.",
      },
      {
        q: "Can I get alerts by SMS or WhatsApp?",
        a: "WhatsApp, yes: turn it on in Notifications. It carries crossings, halts and moving again; every-check updates stay in the app and on Telegram. SMS is not available.",
      },
      {
        q: "Will my old alerts be sent once I connect Telegram?",
        a: "No. Alerts raised before connecting are saved but not sent. You can still read them in the bell and on the truck's page.",
      },
    ],
  },

  /* ======================================================================== */
  /* credits                                                                   */
  /* ======================================================================== */
  {
    slug: "what-spends-a-credit",
    title: "What uses credits, and what is free",
    summary:
      "Searches and automatic checks use credits. Everything else, including alerts, is free.",
    category: "credits",
    minutes: 2,
    keywords: [
      "credit",
      "cost",
      "kitna lagega",
      "charge",
      "spend",
      "free",
      "paise",
      "billing",
      "what costs",
    ],
    blocks: [
      {
        kind: "table",
        head: ["What you do", "What it costs"],
        rows: [
          ["A manual search on [Search](/portal/search)", "1 credit"],
          ["Check now on a truck's page", "1 credit"],
          ["One automatic check of a tracked truck", "At your plan's rate (see Pricing)"],
          ["An alert", "Free"],
          ["The notification or Telegram message", "Free"],
          ["Adding or removing a truck", "Free"],
          ["Adding, editing or switching off an alert", "Free"],
          ["Making a group and reading it", "Free"],
          ["Pausing a truck", "Free, and it uses no credits while paused"],
          ["Opening any screen in the app", "Free"],
        ],
      },
      { kind: "h", text: "Automatic checks are charged when they run" },
      {
        kind: "p",
        text: "The charge does not depend on the result. Each of these is charged the same:",
      },
      {
        kind: "bullets",
        items: [
          "A new crossing was recorded.",
          "Nothing new since last time.",
          "The toll records did not respond.",
          "The alert could not be delivered.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "An empty result still uses a credit",
        text: "No crossings means nothing has been recorded for that number recently. It is a valid result and is charged like any other search or check.",
      },
      { kind: "h", text: "Per truck per check, not per alert" },
      {
        kind: "p",
        text: "Several alerts due on the same truck at the same time share one check. A shorter check interval costs more; more alerts on the same interval do not.",
      },
      { kind: "cta", href: "/portal/activity", label: "See every charge on your account", hint: "Grouped by truck, with dates" },
    ],
    faqs: [
      {
        q: "A check returned no result. Why was I charged?",
        a: "Automatic checks are charged when they run. That is why a truck pauses after repeated unsuccessful checks. A manual search that cannot reach the toll records is not charged — the credit is returned.",
      },
      {
        q: "Do automatic checks cost the same on every plan?",
        a: "Not always. Each plan can set its own rate for automatic checks, shown on [Pricing](/pricing). Manual searches cost the same on every plan. Larger top-ups give better value per credit.",
      },
      {
        q: "Where can I see exactly what was charged?",
        a: "[Activity](/portal/activity) lists every charge and can be filtered to one truck. [Credit history](/portal/credits) shows the same charges against your balance.",
      },
    ],
  },

  {
    slug: "credit-history-and-running-out",
    title: "Your credit history, and running out",
    summary:
      "Where to see credits added and used, and what stops when the balance reaches zero.",
    category: "credits",
    minutes: 3,
    keywords: [
      "credit history",
      "ledger",
      "balance",
      "khatam",
      "credit khatam",
      "out of credits",
      "no credits",
      "statement",
      "activity",
      "recharge",
    ],
    blocks: [
      { kind: "h", text: "Two screens" },
      {
        kind: "bullets",
        items: [
          "[Credit history](/portal/credits) is your statement: how your balance reached its current figure, under Credits added and Credits used.",
          "[Activity](/portal/activity) shows credit use in detail: every search and check, its cost, and which truck it was for. You can filter it to one truck from that truck's page.",
        ],
      },
      {
        kind: "figure",
        name: "credit-ledger",
        caption: "The statement: credits added, credits used, and the resulting balance.",
      },
      {
        kind: "p",
        text: "Credit use is shown one row per day. Tap a day to see the individual searches and checks.",
      },
      { kind: "h", text: "The lines you will see under Credits added" },
      {
        kind: "bullets",
        items: [
          "Purchased — a top-up you paid for.",
          "Included with plan — the credits a plan brought with it.",
          "Free trial credits — your trial credits.",
          "Credit code redeemed — a code worth credits.",
          "Referral reward and Welcome bonus — credits earned through an invite.",
          "Added by administrator and Adjusted by administrator — a correction or credit added by our team, with a note explaining why.",
        ],
      },
      { kind: "h", text: "What stops when the balance reaches zero" },
      {
        kind: "p",
        text: "Everything that uses credits:",
      },
      {
        kind: "bullets",
        items: [
          "Manual searches are refused.",
          "Automatic checks stop, and every live truck is paused with the badge No credits left.",
        ],
      },
      {
        kind: "note",
        tone: "good",
        title: "Nothing is lost",
        text: "No checks run and no credits are used. Your trucks, their alerts and every recorded crossing are kept.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Topping up does not switch trucks back on",
        text: "After a top-up, switch each truck back on from [My trucks](/portal/trucks). Switching one on before topping up will not work — it would pause again at its next check.",
      },
      { kind: "h", text: "Before it happens" },
      {
        kind: "p",
        text: "The app warns you when your balance is running low, shown as the number of searches left. When you see the warning, top up or pause trucks you do not need to track right now.",
      },
      { kind: "cta", href: "/portal/credits", label: "Open your credit history" },
    ],
    faqs: [
      {
        q: "My balance dropped and I did not search anything.",
        a: "Automatic checks usually account for most credit use. One truck checked every fifteen minutes is 96 checks a day, whether or not it moves. Open [Activity](/portal/activity) to see credit use by truck.",
      },
      {
        q: "Can my balance go negative?",
        a: "No. A check the balance cannot cover is refused, not charged.",
      },
      {
        q: "I topped up but a truck is still paused.",
        a: "That is expected. Renewing and topping up do not switch trucks back on. Switch it on from [My trucks](/portal/trucks).",
      },
      {
        q: "A top-up is not showing in my history.",
        a: "Check [Payment history](/portal/payments) first. Credits are added once the payment is confirmed. See [my payment did not add credits](/guide/trouble/payment-did-not-add-credits).",
      },
    ],
  },

  /* ======================================================================== */
  /* plans                                                                     */
  /* ======================================================================== */
  {
    slug: "the-plans",
    title: "The plans, and what each one allows",
    summary:
      "A plan is charged once for its whole term. It sets how many trucks you can track at once, for how long, and how many credits are included.",
    category: "plans",
    minutes: 3,
    keywords: [
      "plan",
      "plans",
      "price",
      "kitna",
      "monthly",
      "subscription",
      "truck limit",
      "slots",
      "buy plan",
      "pricing",
    ],
    blocks: [
      {
        kind: "p",
        text: "Current prices, terms, included credits and truck limits are on [the pricing page](/pricing) and your [Plan and credits](/portal/plan) page.",
      },
      { kind: "h", text: "What a plan sets" },
      {
        kind: "bullets",
        items: [
          "How many trucks can be tracked at once. This limits live trucks, not trucks on your list — a paused truck uses no slot.",
          "For how long. The price shown is for the whole plan and is charged once — not monthly.",
          "How many credits are included.",
          "Whether you can buy more credits. A top-up needs an active paid plan.",
        ],
      },
      {
        kind: "figure",
        name: "plan-cards",
        caption: "Each card shows the whole price, the term, the credits included, and the truck limit.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Included credits and frequent checks",
        text: "Included credits suit moderate check intervals. For frequent checks, plan to top up. A truck checked every fifteen minutes is checked 96 times a day; a longer interval makes the same credits last much longer.",
      },
      { kind: "h", text: "The free trial as a plan" },
      {
        kind: "p",
        text: "The trial works like a plan, with three differences: it is free, it is once per account, and it cannot be topped up. Unused trial credits stay on your balance after it ends. See [claim the free trial](/guide/start/the-free-trial).",
      },
      { kind: "h", text: "Choosing one" },
      {
        kind: "bullets",
        items: [
          "Count the trucks you need to track at the same time, not the total you have. That is what the plan limits.",
          "Choose a term that suits your use. A plan is charged once and expires on its end date.",
          "Plan to top up. Included credits get you started.",
        ],
      },
      { kind: "cta", href: "/portal/plan", label: "See the plans on your account" },
    ],
    faqs: [
      {
        q: "Is the price monthly?",
        a: "No. The price shown is for the whole plan, charged once. The card shows how long the plan runs.",
      },
      {
        q: "Can I change plan part-way through?",
        a: "While a paid plan is active, changing plan or renewing early is handled by our team — please [contact us](/contact). Once a plan has ended, you can buy a new one from [Plan and credits](/portal/plan). Your credits are unaffected either way.",
      },
      {
        q: "Do I lose my trucks if I move to a smaller plan?",
        a: "Nothing is deleted. Only as many trucks as the new plan allows can be live at once, so choose which to keep live and pause the rest.",
      },
      {
        q: "What happens to unused credits when a plan ends?",
        a: "They stay on your balance. Credits never expire and can still be used for manual searches.",
      },
    ],
  },

  {
    slug: "plan-states-and-renewing",
    title: "Active, expired, or no plan — and renewing",
    summary:
      "What you can do in each plan state. An expired plan keeps your account, but stops automatic tracking and top-ups.",
    category: "plans",
    minutes: 3,
    keywords: [
      "plan expired",
      "renew",
      "expired",
      "khatam",
      "plan ended",
      "no plan",
      "lapsed",
      "grace",
      "renewal",
    ],
    blocks: [
      {
        kind: "table",
        head: ["Your account", "Manual search", "Automatic tracking", "Top up credits"],
        rows: [
          ["Paid plan, active", "Yes", "Yes", "Yes"],
          ["Free trial, active", "Yes", "Yes", "No — a top-up needs a paid plan"],
          [
            "Plan expired, or never bought one",
            "Yes — credits never expire",
            "No",
            "No — renew first",
          ],
          ["Free trial ended", "Yes — unused credits remain", "No", "No — choose a plan"],
          [
            "No credits left",
            "No",
            "No — every truck is paused",
            "Yes, if a paid plan is active",
          ],
        ],
      },
      {
        kind: "p",
        text: "Note the third row. An expired plan does not close your account: your credits remain and can be used for manual searches. An expired plan stops automatic checks, the alerts that come from them, and top-ups.",
      },
      { kind: "h", text: "What happens the day a plan ends" },
      {
        kind: "steps",
        items: [
          "Automatic checks stop that day, and no credits are used on checks.",
          "Your trucks stay switched on, but not checked, for a short renewal window, so renewing in that window continues where it stopped. Your [Plan and credits](/portal/plan) page shows the days remaining.",
          "After that window every truck is switched off and marked Plan ended. Nothing is deleted — your trucks, their alerts and every recorded crossing are kept.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Renewing does not switch your trucks back on",
        text: "Once trucks have been switched off, renewing allows automatic checks again but does not switch them back on. Go to [My trucks](/portal/trucks) and switch on the ones you need. This prevents credits being used on trucks you no longer track.",
      },
      { kind: "h", text: "Renewing" },
      {
        kind: "p",
        text: "Buy a plan again from [Plan and credits](/portal/plan). It includes its own credits, and you can add a top-up to the same payment. Then switch your trucks back on.",
      },
      {
        kind: "note",
        tone: "info",
        title: "An account on hold is different",
        text: "When an account is on hold, all its trucks stop, and only our support team can resolve it. Renewing or topping up does not change this — write to us from [the contact page](/contact).",
      },
      { kind: "cta", href: "/portal/plan", label: "Check or renew your plan" },
    ],
    faqs: [
      {
        q: "My plan ended. Can I still search?",
        a: "Yes, as long as you have credits. Paid credits never expire. Automatic tracking needs an active plan.",
      },
      {
        q: "Can I buy credits instead of renewing, to keep tracking going?",
        a: "No. A top-up needs an active paid plan, and credits alone do not restore automatic tracking. Renew your plan to resume tracking.",
      },
      {
        q: "Will I lose my alerts and settings if I renew late?",
        a: "No. Your trucks, their alerts, check intervals and history are all kept. You only need to switch each truck back on.",
      },
    ],
  },

  /* ======================================================================== */
  /* payments                                                                  */
  /* ======================================================================== */
  {
    slug: "buying-credits",
    title: "Buying credits, and why a plan is required",
    summary:
      "Top-ups add credits and change nothing else. They need an active paid plan, so they are not available on the trial or after a plan ends.",
    category: "payments",
    minutes: 3,
    keywords: [
      "top up",
      "topup",
      "buy credits",
      "recharge",
      "credit kharido",
      "add credits",
      "refused",
      "pack",
      "open amount",
    ],
    blocks: [
      {
        kind: "p",
        text: "Open [Plan and credits](/portal/plan) and go to the Top up credits panel. Choose a pack, or enter your own amount on the open tier. Larger packs cost less per credit, and the panel shows the rate for each.",
      },
      {
        kind: "p",
        text: "A top-up adds credits only. It does not change your plan, its end date, or how many trucks you can track. Credits you buy never expire.",
      },
      {
        kind: "figure",
        name: "checkout",
        caption: "The top-up panel: the packs, the credits each includes, and the discount code box.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A top-up needs an active paid plan",
        text: "If your plan has expired, you are on the free trial, or you have never bought a plan, a top-up is not available. Buy or renew a plan first — it includes its own credits. You can also buy a plan and a top-up together in one payment.",
      },
      { kind: "h", text: "Paying" },
      {
        kind: "steps",
        items: [
          "Choose a pack or enter an amount. The panel shows the credits before you pay.",
          "Add a discount code if you have one, in the Discount code box on the same panel.",
          "Press the pay button. A Razorpay window opens with your name and contact details filled in.",
          "Pay using any method Razorpay offers. We never see or store your card or bank details.",
          "Stay on the page for a few seconds. Credits are added when Razorpay confirms the payment.",
        ],
      },
      { kind: "h", text: "Credit codes and discount codes" },
      {
        kind: "table",
        head: ["Type of code", "Where to enter it", "What it does"],
        rows: [
          [
            "A code worth credits",
            "Have a credit code? on [Plan and credits](/portal/plan)",
            "Adds credits directly. No purchase needed",
          ],
          [
            "A discount code",
            "The Discount code box on the buying panel",
            "Reduces the price",
          ],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "A discount reduces the price, not the credits",
        text: "Credits are calculated from the price before the discount, so you get the same credits for less. A credit code adds credits directly, so it has its own box and cannot be used at checkout.",
      },
      { kind: "cta", href: "/portal/plan", label: "Top up credits" },
    ],
    faqs: [
      {
        q: "Why is my top-up being refused?",
        a: "A top-up needs an active paid plan. On an expired plan, on the trial, or with no plan, buy or renew a plan instead — it includes credits.",
      },
      {
        q: "Can I buy a plan and credits in one payment?",
        a: "Yes. The buying panel lets you add a top-up to a plan purchase, charged as one payment. Your receipt shows both separately.",
      },
      {
        q: "Do bought credits expire if I stop using the account?",
        a: "No. Purchased credits do not expire and can be used for manual searches even without a plan.",
      },
      {
        q: "Is there a minimum on the open tier?",
        a: "Yes. The panel shows the minimum amount.",
      },
    ],
  },

  {
    slug: "payments-and-receipts",
    title: "Your payment history and receipts",
    summary:
      "Every payment, what it bought, the credits it added, and the reference to quote if you need help.",
    category: "payments",
    minutes: 3,
    keywords: [
      "payment",
      "receipt",
      "invoice",
      "bill",
      "razorpay",
      "reference",
      "order id",
      "failed payment",
      "paisa kata",
      "history",
    ],
    blocks: [
      {
        kind: "p",
        text: "[Payment history](/portal/payments) lists every payment on the account. Each row shows the date and time, status, what you bought, the payment method, the price, the amount paid after any discount, the credits added, and a reference.",
      },
      {
        kind: "figure",
        name: "payment-history",
        caption: "The payment list, and the full receipt for the payment you open.",
      },
      { kind: "h", text: "The three statuses" },
      {
        kind: "table",
        head: ["Status", "What it means", "What to do"],
        rows: [
          ["Paid", "Confirmed. The credits or the plan are on your account", "Nothing"],
          [
            "Waiting for confirmation",
            "Razorpay has not confirmed it yet, so nothing has been added",
            "Wait a few seconds and reload the page",
          ],
          [
            "Did not go through",
            "The payment was not completed. Nothing was charged and nothing was added",
            "Try again any time",
          ],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "If money was debited but the payment is not confirmed",
        text: "Open the payment on [Payment history](/portal/payments), copy the reference, and write to us from [the contact page](/contact). Please do not pay again before we reply.",
      },
      { kind: "h", text: "The receipt" },
      {
        kind: "p",
        text: "Tap a row to open its full receipt at the top of the page. It shows what was bought, the amount paid, any discount, the credits added, and the references. A plan bought with a top-up lists both separately, so you can see which credits were included and which were bought.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Payments recorded by our team have no gateway reference",
        text: "If our team recorded a payment for you, its receipt shows no order or payment ID, because it was not processed through Razorpay.",
      },
      { kind: "cta", href: "/portal/payments", label: "Open your payment history" },
    ],
    faqs: [
      {
        q: "Can I get a GST invoice?",
        a: "The app provides a receipt on [Payment history](/portal/payments). For a GST invoice, write to us from [the contact page](/contact) with the payment reference.",
      },
      {
        q: "Where do I see what a payment did to my balance?",
        a: "The receipt shows the credits it added, and [Credit history](/portal/credits) shows the same entry in your statement.",
      },
      {
        q: "A payment did not go through. Was I charged?",
        a: "No. An unsuccessful payment is not charged and adds nothing. If your bank shows a debit, send us the payment reference.",
      },
    ],
  },

  /* ======================================================================== */
  /* rewards                                                                   */
  /* ======================================================================== */
  {
    slug: "refer-and-earn",
    title: "Invite & earn",
    summary:
      "Share your link. When someone who signs up with it buys their first plan, and again on their first top-up, you both earn credits. Sign-up alone does not earn a reward.",
    category: "rewards",
    minutes: 3,
    keywords: [
      "refer",
      "referral",
      "invite",
      "earn",
      "commission",
      "bonus",
      "link share",
      "code",
      "credit code",
      "kitna milega",
    ],
    blocks: [
      {
        kind: "p",
        text: "Your invite link is on [Invite & earn](/portal/referrals), with buttons to copy and share it. Anyone who signs up with it is linked to your account.",
      },
      {
        kind: "figure",
        name: "referral-share",
        caption: "Your link, what it has earned so far, and everyone who has used it.",
      },
      { kind: "h", text: "How rewards work" },
      {
        kind: "table",
        head: ["Their first payment", "You get", "They get"],
        rows: [
          [
            "Their first plan",
            "A percentage of what they paid, as credits",
            "A smaller percentage, as credits",
          ],
          [
            "Their first top-up",
            "A percentage of what they paid, as credits",
            "A smaller percentage, as credits",
          ],
        ],
      },
      {
        kind: "p",
        text: "The current percentages are shown on [Invite & earn](/portal/referrals), converted into credits for you.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Sign-up alone does not earn a reward",
        text: "Rewards are paid when your invitee makes a payment, not when they sign up. There are two rewards per invitee, each paid once: their first plan and their first top-up.",
      },
      { kind: "h", text: "If they buy a plan and credits in one payment" },
      {
        kind: "p",
        text: "The reward is paid once, on the whole amount, and covers both events. Buying both together earns the same as buying them separately.",
      },
      { kind: "h", text: "What the badges on your list mean" },
      {
        kind: "table",
        head: ["Badge", "What it means"],
        rows: [
          ["Waiting", "Signed up, no payment yet"],
          ["Part paid", "One of the two rewards has been credited"],
          ["Both paid", "Both rewards have been credited"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Reward credits work like any other credits",
        text: "They are added to the same balance, never expire, and appear in [your credit history](/portal/credits) as a referral reward or welcome bonus.",
      },
      { kind: "h", text: "Codes worth credits" },
      {
        kind: "p",
        text: "If you receive a credit code, redeem it in the Have a credit code? box on [Plan and credits](/portal/plan). No purchase is needed. Discount codes go in the Discount code box on the buying panel instead — see [buying credits](/guide/payments/buying-credits).",
      },
      { kind: "cta", href: "/portal/referrals", label: "Get your invite link" },
    ],
    faqs: [
      {
        q: "When exactly do the credits arrive?",
        a: "As soon as your invitee's payment is confirmed. If they have paid and no reward has arrived, ask them to check that their payment is confirmed, then write to us.",
      },
      {
        q: "Can I invite myself with a second account?",
        a: "No. Rewards are checked against the account, email address and mobile number.",
      },
      {
        q: "Someone signed up without my link. Can it be linked now?",
        a: "Please write to us with both email addresses and we will review it.",
      },
      {
        q: "Is there a bonus for bringing several people?",
        a: "There is a milestone bonus, and [Invite & earn](/portal/referrals) shows whether it is running and what it takes to reach it.",
      },
    ],
  },

  /* ======================================================================== */
  /* account                                                                   */
  /* ======================================================================== */
  {
    slug: "your-account-and-getting-help",
    title: "Your profile, your phone, and getting help",
    summary:
      "What you can change yourself, what our team can change for you, using the app on your phone, and how to contact us.",
    category: "account",
    minutes: 3,
    keywords: [
      "profile",
      "settings",
      "mobile number",
      "phone",
      "password",
      "sign out",
      "home screen",
      "app install",
      "support",
      "help",
      "madad",
    ],
    blocks: [
      { kind: "h", text: "Your profile" },
      {
        kind: "p",
        text: "Your details are in the My profile panel on [Settings](/portal/settings): your name, mobile number, and optionally your job title, company, city and state. You can change any of these yourself. The panel also shows your sign-in email, password and the date you joined.",
      },
      {
        kind: "bullets",
        items: [
          "Keep your mobile number up to date. We use it to contact you about your account.",
          "Your sign-in email cannot be changed in the app. Write to us to change it — your receipts, password reset and trial are linked to it.",
          "Change your password from the same panel. If you have forgotten it, use [forgot password](/forgot-password) instead.",
          "Sign out from the menu at the top of the screen.",
        ],
      },
      { kind: "h", text: "Where alerts are delivered" },
      {
        kind: "p",
        text: "Choose phone notifications or Telegram in [Notifications](/portal/notifications). For phone notifications, allow notifications for Rahdari on your device. For Telegram alerts, allow Telegram notifications and verify your chat connection. Use Send test for the channel you want to check.",
      },
      { kind: "h", text: "Putting Rahdari on your home screen" },
      {
        kind: "p",
        text: "Your phone will offer to add Rahdari to your home screen. It then opens full screen, loads faster on a slow connection, and shows a clear notice instead of a browser error when the signal drops. To get alerts on your phone, turn on notifications in Settings.",
      },
      { kind: "h", text: "Keeping your own copy of your history" },
      {
        kind: "p",
        text: "The Backup to your Google Sheet panel on [Settings](/portal/settings) copies your crossings, your alerts, your searches and a usage summary into a sheet you own. Share the sheet with the address shown on that panel as an Editor, paste the link, and test the connection. If the sheet stops working, tracking continues as normal.",
      },
      { kind: "h", text: "Getting help" },
      {
        kind: "steps",
        items: [
          "See [the support page](/support) first. It answers the most common questions.",
          "Browse [the help centre](/guide), organised by task.",
          "If you still need help, write to us from [the contact page](/contact) with your account email and when the issue happened. Our team will reply.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "What to include when you write",
        text: "The vehicle number if it is about a truck, the payment reference if it is about a payment, and when you noticed the issue.",
      },
      { kind: "cta", href: "/portal/settings", label: "Open Settings" },
    ],
    faqs: [
      {
        q: "How do I sign out on a laptop?",
        a: "From the menu at the top of the screen, the same as on a phone.",
      },
      {
        q: "Can somebody else in my office use my account?",
        a: "Separate logins under one account are not available yet. A shared sign-in shares the balance and alerts; a shared Telegram group can deliver alerts to several people.",
      },
      {
        q: "Where can I read the terms and what you do with my data?",
        a: "[Terms](/terms), [privacy](/privacy), and [where the data comes from](/data-sources).",
      },
    ],
  },

  /* ======================================================================== */
  /* trouble                                                                   */
  /* ======================================================================== */
  {
    slug: "truck-not-being-checked",
    title: "My truck is not being checked",
    summary:
      "Work through this list in order. Most causes are shown on the truck's page.",
    category: "trouble",
    minutes: 3,
    keywords: [
      "not checking",
      "not tracking",
      "check nahi ho raha",
      "paused",
      "band ho gaya",
      "no updates",
      "stopped",
      "last checked",
    ],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the truck on [My trucks](/portal/trucks). Trucks on the Watchlist tab are not checked.",
          "Check its badge. If it is paused, the badge shows why, and the (i) beside it shows since when. See [every reason a truck pauses](/guide/trucks/going-live-and-pausing).",
          "Check it has an alert switched on. A truck without one is not checked.",
          "Check your balance on [Credit history](/portal/credits). When it is empty, no checks run and every live truck is paused.",
          "Check your plan on [Plan and credits](/portal/plan). Automatic checks need an active plan. With an expired plan, manual search still works but tracking does not.",
          "Check the last-checked time on the truck's page. If it is recent, checks are working and the issue is alert delivery. See [I got no alert](/guide/trouble/no-alert-arrived).",
        ],
      },
      { kind: "h", text: "The most common causes" },
      {
        kind: "table",
        head: ["What you see", "Cause", "What to do"],
        rows: [
          [
            "No alert on the truck",
            "It was added without an alert",
            "Add an alert on the truck's page",
          ],
          [
            "Badge says No credits left",
            "The balance ran out",
            "Top up, then switch each truck back on",
          ],
          [
            "Badge says Plan ended",
            "The plan ended and the renewal window passed",
            "Renew, then switch each truck back on",
          ],
          [
            "Badge says No movement detected",
            "No new crossing for the time set for this truck. Usually a parked truck",
            "Switch it on when it is back on the road, or lengthen the window in its Settings",
          ],
          [
            "Badge says No response for this number",
            "Repeated checks returned no result for this number",
            "Check the number is correct, then switch it back on",
          ],
          [
            "Badge says Tracking period ended",
            "The end time you set arrived",
            "Switch it on and set a new end time",
          ],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Some need account action first",
        text: "With an empty balance, an ended plan or an account on hold, the truck would pause again at its next check. Resolve the account issue first.",
      },
      {
        kind: "note",
        tone: "info",
        title: "An empty route is not an error",
        text: "Only new crossings are added to the route, so a truck that has not crossed a plaza shows nothing new. A truck on untolled roads produces no records.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Open My trucks" },
    ],
    faqs: [
      {
        q: "It says it was checked, but there is nothing new.",
        a: "The truck has not been recorded at a new plaza. The check ran and was charged, but there was nothing new to report.",
      },
      {
        q: "I switched it on and it switched itself off again.",
        a: "An empty balance or ended plan paused it at the next check. The badge shows which. Resolve that first, then switch it back on.",
      },
      {
        q: "Can I force a check right now?",
        a: "Yes. Check now on the truck's page runs an immediate check for one credit.",
      },
    ],
  },

  {
    slug: "no-alert-arrived",
    title: "I got no alert",
    summary:
      "If checks are running but no alerts reach your phone, check your notification settings in this order.",
    category: "trouble",
    minutes: 2,
    keywords: [
      "no alert",
      "alert nahi aaya",
      "message nahi aaya",
      "telegram",
      "silent",
      "notification",
      "phone",
      "not delivered",
    ],
    blocks: [
      {
        kind: "note",
        tone: "warn",
        title: "Set up alerts before tracking",
        text: "If neither phone notifications nor Telegram are set up, alerts are saved in the app but not sent to your phone — and checks still use credits.",
      },
      {
        kind: "steps",
        items: [
          "Open [Settings](/portal/settings). Confirm that phone notifications are on, or that a Telegram chat ID is saved and its switch is on.",
          "Press Send test. If the test arrives, alerts will too.",
          `For Telegram, if the test does not arrive, open [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) and send it \`/start\`, then test again. Telegram bots can only message people who have started them.`,
          "Check that notifications are allowed for Rahdari (or Telegram) in your phone's settings.",
          "Open the truck's page and check Alerts raised. If alerts are listed as not delivered, checks are working and the issue is delivery.",
        ],
      },
      { kind: "h", text: "If no alerts are being raised at all" },
      {
        kind: "bullets",
        items: [
          "With Only when it moves, a truck that has not reached a different plaza sends no alert. This is expected.",
          "For a plaza alert, the plaza name must match the toll record exactly. Select it from the suggestions rather than typing it.",
          "A switched-off alert sends nothing. Check that the alert is on, not just the truck.",
          "If the truck is not being checked at all, start with [my truck is not being checked](/guide/trouble/truck-not-being-checked) instead.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "The bell is your alert history",
        text: "The bell inside the app lists your alerts. To be notified on your phone, turn on phone notifications or connect Telegram in Settings.",
      },
      { kind: "cta", href: "/portal/notifications", label: "Check your alert settings" },
    ],
    faqs: [
      {
        q: "Will missed alerts be sent once notifications are set up?",
        a: "No. Alerts raised before setup are saved but not sent. You can still read them in the bell and on each truck's page.",
      },
      {
        q: "Do I get the credits back for alerts that were never delivered?",
        a: "No. Credits pay for the check, which ran. Delivery is free and separate.",
      },
      {
        q: "The test message arrives but real alerts do not.",
        a: "Delivery is working, so no alerts are being raised. Check the alert is switched on and the truck is on the Live tracking tab. With Only when it moves, no alert is sent until the truck reaches a different plaza.",
      },
    ],
  },

  {
    slug: "payment-did-not-add-credits",
    title: "My payment did not add credits",
    summary:
      "Check the payment status first. Credits are added once Razorpay confirms the payment; an unsuccessful payment is not charged.",
    category: "trouble",
    minutes: 2,
    keywords: [
      "payment failed",
      "credit nahi aaya",
      "paisa kata",
      "money deducted",
      "razorpay",
      "pending",
      "not confirmed",
      "refund",
      "top up refused",
    ],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open [Payment history](/portal/payments) and find the payment. Check its status.",
          "Waiting for confirmation: Razorpay has not confirmed it yet. Wait a few seconds and reload.",
          "Did not go through: the payment was not completed. Nothing was charged, and you can try again any time.",
          "Paid: the payment is complete. Check [Credit history](/portal/credits) for the matching entry, and the receipt for the credits added.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "If money was debited but the payment is not confirmed",
        text: "Please do not pay again. Open the payment on [Payment history](/portal/payments), copy the reference, and write to us from [the contact page](/contact) with the reference and the time you paid.",
      },
      { kind: "h", text: "If the top-up was refused before you paid" },
      {
        kind: "p",
        text: "A top-up needs an active paid plan. On an expired plan, on the free trial, or with no plan, buy or renew a plan instead — it includes credits. See [buying credits](/guide/payments/buying-credits).",
      },
      { kind: "h", text: "If credits were added but nothing is being checked" },
      {
        kind: "p",
        text: "Topping up does not switch trucks back on automatically. Go to [My trucks](/portal/trucks) and switch on the ones you need.",
      },
      { kind: "cta", href: "/portal/payments", label: "Check your payment history" },
    ],
    faqs: [
      {
        q: "I paid for a plan and a top-up together. Only half the credits show.",
        a: "Open the receipt. A combined payment lists the plan's included credits and the purchased credits separately; the total was added to your balance.",
      },
      {
        q: "How long should I wait before writing to you?",
        a: "Confirmation usually takes seconds. If a payment is still unconfirmed after a few minutes and your bank shows a debit, write to us with the reference.",
      },
      {
        q: "Can I get a refund?",
        a: "Write to us from [the contact page](/contact) with the payment reference and details. Refunds are handled by our team, not in the app.",
      },
    ],
  },

  {
    slug: "cannot-sign-in",
    title: "I cannot sign in, or reset my password",
    summary:
      "Reset your password from the sign-in page. If the email does not arrive, check these steps before writing to us.",
    category: "trouble",
    minutes: 2,
    keywords: [
      "cannot sign in",
      "login problem",
      "password",
      "forgot password",
      "reset",
      "email nahi aaya",
      "locked out",
      "suspended",
      "no access",
    ],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open [forgot password](/forgot-password) and enter your registered email. We will send a link to choose a new password.",
          "Check your spam and promotions folders.",
          "Check that you entered the email address you registered with.",
          "Wait a minute and try again. If a link has expired, request a new one.",
          "Still nothing? Write to us from [the contact page](/contact) using your registered email, and tell us when you tried.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Two different emails",
        text: "A password reset sends a link. Confirming your email address sends a six-digit code, which is only needed before the free trial. Buying a plan or credits does not need a code.",
      },
      { kind: "h", text: "If you can sign in but cannot use the app" },
      {
        kind: "bullets",
        items: [
          "An account on hold cannot use the app, and all its trucks are stopped. Please write to us from [the contact page](/contact) to resolve it.",
          "If you can sign in but nothing is being checked, the cause is usually the plan, the balance or a paused truck. See [my truck is not being checked](/guide/trouble/truck-not-being-checked).",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Do not open a second account",
        text: "The free trial is once per account, email address and mobile number, and a new account starts empty — no trucks, history or credits. Recovering your existing account is quicker.",
      },
      { kind: "cta", href: "/login", label: "Go to the sign-in page" },
    ],
    faqs: [
      {
        q: "Can I change the email I sign in with?",
        a: "Please write to us. Your receipts, password reset and trial are linked to it.",
      },
      {
        q: "Is my data still there if I have not signed in for months?",
        a: "Yes. Your trucks, their alerts and your credits are all kept. Automatic checks need an active plan, and you switch each truck back on yourself.",
      },
      {
        q: "The reset link says it has expired.",
        a: "Request a new one from [forgot password](/forgot-password). Each link works once and expires after an hour.",
      },
    ],
  },
  /* ======================================================================== */
  /* live tracking (GPS from the driver's phone, /live)                        */
  /* ======================================================================== */
  {
    slug: "live-tracking-trips",
    title: "Live tracking: trips, driver link and masters",
    summary:
      "Track a truck by the driver's phone. Everything starts from a trip - sending or receiving.",
    category: "trucks",
    minutes: 3,
    keywords: ["live", "gps", "driver", "location", "trip", "supplier", "dealer", "masters", "link", "whatsapp", "gaadi kaha hai"],
    blocks: [
      {
        kind: "p",
        text: "Live tracking shows where a truck is from the driver's phone. The driver gets a link on WhatsApp, opens it, and taps Start sharing. No app and no device are needed. It is separate from toll tracking and uses the same login.",
      },
      { kind: "h", text: "Everything is a trip" },
      {
        kind: "steps",
        items: [
          "Tap New trip. Choose We are sending or We are receiving, and give the trip a name. The trip number is given automatically; name and number never change.",
          "Add the driver - this is the only thing needed to start tracking.",
          "Optionally switch on Truck and Trip details: where from, where to, purpose, times, goods and documents.",
          "Send the driver his link on WhatsApp. When he starts sharing, the trip shows his position, distance left and ETA.",
        ],
      },
      { kind: "h", text: "Sending or receiving" },
      {
        kind: "bullets",
        items: [
          "Sending (to a dealer, customer or your own site): pick your driver and truck from Masters. From is your warehouse; To is the customer - enter the name and the exact location by searching the address, picking it on the map, or pasting a Google Maps link.",
          "Receiving (a supplier sends to you and does not use the app): type the supplier's driver name and mobile, the truck number and the supplier's place on the trip itself. This is saved on the trip only, not in your masters. To is your warehouse.",
          "If the supplier also uses Rahdari, he can create the trip himself and simply send you his tracking link.",
        ],
      },
      { kind: "h", text: "Masters" },
      {
        kind: "p",
        text: "Masters is the only place to add, edit or archive your own drivers, trucks and warehouses. Trips just pick from them; the Add new button next to a picker opens the master and brings you back with the new item selected. The Drivers list also shows each driver's live status and when he was last seen.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Automatic updates",
        text: "With the locations saved, the trip marks loading, left and arrived by itself, warns when a truck is likely late, has no GPS for a while, or the e-way bill is about to expire. Every change is kept in the trip's activity log.",
      },
      { kind: "cta", href: "/live/trips", label: "Open Live tracking" },
    ],
    faqs: [
      {
        q: "Does the driver need to install an app?",
        a: "No. He opens the link from WhatsApp in his phone's browser and taps Start sharing. He can stop sharing any time.",
      },
      {
        q: "How do I track a truck a supplier is sending me?",
        a: "Create a trip with We are receiving and type his driver's name and mobile on the trip. The driver's link stops by itself after the trip.",
      },
    ],
  },
];
