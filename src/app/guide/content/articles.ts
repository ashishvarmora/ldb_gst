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
 *    page, the officer's own screen, or the field that holds it. The two
 *    exceptions are fixed in code and stated as numbers: one credit a manual
 *    search, one credit an automatic check.
 *
 * 2. THE MONEY RULES ARE STATED, NOT SOFTENED. A credit is spent when a check
 *    runs and never on its outcome; trial credits die with the trial; an
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
      "Give it a lorry number and it tells you which toll plazas that number has been recorded at. Every look costs one credit.",
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
        text: "You give Rahdari a lorry's registration number. It asks the national toll network what that number has been recorded at, and shows you the plazas it has passed, newest first, with the time of each crossing.",
      },
      {
        kind: "p",
        text: "You can do that once by hand, whenever you want to know. Or you can put a lorry under watch, and Rahdari does the asking for you on a beat you choose, sending a Telegram message when it finds something.",
      },
      { kind: "h", text: "How a crossing reaches your screen" },
      {
        kind: "steps",
        items: [
          "A lorry passes a tolled highway plaza.",
          "The gantry at that plaza records the passing.",
          "The record reaches the national logistics data infrastructure.",
          "Rahdari asks for it, and it appears on your screen.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "This is not GPS",
        text: "A lorry is only visible where there is a reading point. One on state roads, on a short local run, or one that simply has not passed a plaza recently produces no records at all. Nothing found means nothing was recorded — not that the lorry is not moving. Records can also arrive late, so read every time as recorded at, never as is at.",
      },
      { kind: "h", text: "What each action costs" },
      {
        kind: "p",
        text: "There is one balance, called credits, and two things draw on it. Both cost the same.",
      },
      {
        kind: "table",
        head: ["What you do", "What it costs"],
        rows: [
          ["A search you type yourself", "1 credit"],
          ["One automatic check of a lorry you are watching", "1 credit"],
          ["An alert being raised, and the Telegram message", "Free"],
          ["Adding a lorry, adding an alert, making a group", "Free"],
          ["Pausing a lorry", "Free, and it stops the spending"],
        ],
      },
      {
        kind: "p",
        text: "So how closely you watch is the whole cost of the product. A lorry checked every fifteen minutes is checked 96 times a day, which is 96 credits a day for that one lorry. A lorry checked every six hours is four. Read [how credits work](/guide/start/how-credits-work) before you switch anything on.",
      },
      { kind: "h", text: "What you need to buy" },
      {
        kind: "p",
        text: "Two different things, and getting them the wrong way round is how people buy the wrong one. A plan decides how many lorries you may watch at once and until when. Credits pay for each look. You need both — a plan with an empty balance checks nothing, and credits with no plan still search by hand.",
      },
      {
        kind: "note",
        tone: "info",
        title: "What the records can and cannot show",
        text: "A crossing means the lorry was recorded at that plaza at that time. It says nothing about where it is now, and a gap has innocent explanations. Treat what you find as a lead to check by other means, never as proof on its own. Where the data comes from is set out on [the data sources page](/data-sources).",
      },
      { kind: "cta", href: "/pricing", label: "See the plans and prices", hint: "Live prices, always current" },
    ],
    faqs: [
      {
        q: "Can I see where a lorry is right now?",
        a: "No. You see where it was last recorded crossing a toll plaza. Between plazas, and on roads with no plaza, there is nothing to see.",
      },
      {
        q: "Does a search cost the same whether it finds something or not?",
        a: "Yes. One credit, because the asking is what costs. An empty result is a real answer and it costs the same one credit.",
      },
      {
        q: "Do I need a plan just to search one lorry by hand?",
        a: "No. Manual search runs off your credit balance and works even when a plan has ended. Automatic tracking is the part that needs a plan that is still running.",
      },
    ],
  },

  {
    slug: "create-your-account",
    title: "Open an account and confirm your email",
    summary:
      "Sign up with an email address and a password, then type in the six-digit code we email you. Nothing is charged for either.",
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
          "Add your mobile number when it asks. It is how we reach you if something goes wrong with a payment.",
          "Open [Verify your email](/portal/verify-email) and send yourself the code.",
          "Check that mailbox and type the six-digit code in.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Do not skip the code",
        text: "The free trial will not start until the address is confirmed. The trial is once per account, and an unconfirmed address can be made up, so the code is the thing that keeps the trial honest. Buying a plan or credits never asks you for a code — only the trial does.",
      },
      { kind: "h", text: "If the code does not arrive" },
      {
        kind: "bullets",
        items: [
          "Check the spam and promotions folders first.",
          "Check the address on the screen is the one you actually read. The code goes wherever that says.",
          "Codes can take a minute. Each one can be used once, and one that has expired needs a fresh send.",
          "Send it again from the same page. There is no limit on trying.",
        ],
      },
      {
        kind: "p",
        text: "If it still does not come, write to us from [the contact page](/contact) with the address you registered with. A person reads it.",
      },
      { kind: "cta", href: "/signup", label: "Open an account" },
    ],
    faqs: [
      {
        q: "Can I change my sign-in email later?",
        a: "Write to us. It is not a field you can edit yourself, because the address is what the trial, the receipts and the password reset all hang on.",
      },
      {
        q: "Is my mobile number required?",
        a: "Add it. It is what we use to reach you about a payment, and the trial is one per mobile number as well as one per account.",
      },
      {
        q: "I registered but nothing is being tracked. Why?",
        a: "Registering only opens the account. Automatic checking needs a plan or a running trial, plus a lorry with at least one alert switched on. Follow [your first lorry, end to end](/guide/start/first-truck-in-five-minutes).",
      },
    ],
  },

  {
    slug: "the-free-trial",
    title: "Claim the free trial",
    summary:
      "A short trial with a fixed pot of credits, once per account, after your email is confirmed. It ends when either the days or the credits run out.",
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
        text: "Go to [Plan and credits](/portal/plan) and press Start the free trial. It is a button rather than something handed over at sign-up, so the clock starts when you are ready, not on the day you registered.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "The trial ends on whichever runs out first",
        text: "It is limited by both its days and its credits. Spend the credits on day two and the trial is finished on day two. Let the days run out with credits still in the pot and the trial is finished then. Your own [Plan and credits](/portal/plan) page shows both numbers.",
      },
      { kind: "h", text: "Three things the trial will not do" },
      {
        kind: "bullets",
        items: [
          "It cannot be topped up. Buying credits needs a paid plan that is running, and a trial is not one. So a trial that runs out of credits is finished until you choose a plan.",
          "Its credits do not survive it. When the trial ends the unused trial balance is cleared. They were free and the trial is over.",
          "It is once per account, and once per mailbox and mobile number too. If you think that is wrong for you, write to us.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Purchased credits are different",
        text: "Credits you pay for never expire. They survive your plan ending, they survive a renewal, and they are still there months later. Only trial credits die with the trial.",
      },
      { kind: "h", text: "Spend it on the right thing" },
      {
        kind: "p",
        text: "A trial pot does not go far on a fast beat: one lorry checked every fifteen minutes spends 96 credits a day. Put your one lorry on a slower beat — an hour, or three hours — and you will see the product work for several days instead of one afternoon. See [how often we look](/guide/trucks/how-often-we-look).",
      },
      { kind: "cta", href: "/portal/plan", label: "Start the free trial" },
    ],
    faqs: [
      {
        q: "Can I get a second trial?",
        a: "No. It is refused by the account, the mailbox and the mobile number. An administrator can add credits by hand if there is a real reason, so write to us rather than making a second account.",
      },
      {
        q: "My trial ended and I still had credits showing. Where did they go?",
        a: "They were cleared, which is the rule for trial credits. The clearing is recorded in [your credit history](/portal/credits) so you can see exactly what happened and when.",
      },
      {
        q: "Do I have to give card details for the trial?",
        a: "No. Nothing is charged and nothing is asked for. You only reach a payment screen when you choose a plan.",
      },
    ],
  },

  {
    slug: "first-truck-in-five-minutes",
    title: "Your first lorry, end to end",
    summary:
      "Five steps, in this order. The Telegram step is the one people skip and the expensive one to skip.",
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
        text: "Do these in order. Step three is the one people leave for later, and leaving it for later is what makes the balance go down while the phone stays silent.",
      },
      {
        kind: "steps",
        items: [
          "Confirm your email with the six-digit code, then start the free trial or choose a plan on [Plan and credits](/portal/plan). A plan is what allows automatic checking at all.",
          "Try one search by hand on [Search](/portal/search). Type any registration number. It costs one credit and it proves the account works before you commit to a beat.",
          "Connect Telegram in [Settings](/portal/settings) — before you switch any tracking on. Save your chat id, turn the switch on, and press Send test. If the test message does not arrive, alerts will not either.",
          "Add the lorry on [My trucks](/portal/trucks). The form asks for the number and then for its first alert.",
          "Give it one alert and pick how often to look. Only when it moves is the sensible choice. An hour is a sensible first beat; fifteen minutes is 96 credits a day for that one lorry.",
        ],
      },
      {
        kind: "figure",
        name: "portal-home",
        caption: "The home screen after signing in: your balance, and the three things to do first.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A lorry with no alert is never checked",
        text: "It sits on the list costing nothing and telling you nothing. That is why the add form asks for the first alert in the same breath as the number.",
      },
      {
        kind: "note",
        tone: "good",
        title: "How to tell it is working",
        text: "Within one beat, the lorry's own page shows a last-checked time. [Your activity page](/portal/activity) shows the check and its cost. And a movement produces a Telegram message. If the first two happen and the third does not, the problem is Telegram — see [I got no alert](/guide/trouble/no-alert-arrived).",
      },
      { kind: "cta", href: "/portal/trucks", label: "Add your first lorry" },
    ],
    faqs: [
      {
        q: "How long until I see something?",
        a: "The first check happens within one beat of the alert you set. But a message only arrives when there is something to say: a parked lorry produces no movement and, on the Only when it moves rule, no message.",
      },
      {
        q: "Should I start with a fast beat to see it working?",
        a: "No. Use Check now on the lorry's own page instead — it is one credit and it answers straight away. Then leave the automatic beat slow until you know what you want.",
      },
      {
        q: "Can I add several lorries at once?",
        a: "Add them one at a time on [My trucks](/portal/trucks), because each one needs its own alert. For reading several together afterwards, put them in a group on [Groups](/portal/cases).",
      },
    ],
  },

  {
    slug: "how-credits-work",
    title: "How credits work",
    summary:
      "One balance pays for every look. A plan is a separate thing that decides how many lorries and for how long. This is the idea worth getting right first.",
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
        text: "There is one number on your account called credits. Every look at a lorry draws one credit from it — a search you type, or an automatic check of a lorry you are watching. Nothing else draws on it.",
      },
      { kind: "h", text: "A plan and credits are two different things" },
      {
        kind: "table",
        head: ["", "A plan", "Credits"],
        rows: [
          ["Decides", "How many lorries at once, and until when", "What each look costs"],
          ["Charged", "Once, for the whole term — not per month", "Whenever you top up"],
          ["Runs out", "On its end date", "Never — except a trial's"],
        ],
      },
      {
        kind: "p",
        text: "You need both. A plan with an empty balance checks nothing. Credits with no plan still search by hand.",
      },
      { kind: "h", text: "Which one do you buy when you run short" },
      {
        kind: "bullets",
        items: [
          "Checks being refused, or every lorry paused saying No credits left, means you need credits. Top up.",
          "The app will not let you add another lorry, which means you need a bigger plan.",
          "Your plan has ended, which means renewing is the only thing that brings automatic checking back. Credits alone will not.",
        ],
      },
      { kind: "h", text: "Credits are spent on execution, never on outcome" },
      {
        kind: "p",
        text: "The credit goes the moment a check is made. It does not depend on whether the lorry moved, whether an alert was raised, whether Telegram delivered it, or whether anything was found at all. A new crossing, nothing new since last time, the portal failing to answer, an alert that could not be delivered — all four cost the same one credit.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "So the beat is the bill",
        text: "How often you look is the whole cost of the product. One lorry on a fifteen-minute beat is 96 checks a day and 96 credits a day, whether it moves or not. Pausing a lorry that is parked is the largest saving available to you.",
      },
      { kind: "h", text: "Do credits expire" },
      {
        kind: "p",
        text: "Credits you have paid for never expire. They survive your plan ending, they survive a renewal, and they are still there months later. The one exception is the free trial: trial credits are cleared when the trial ends.",
      },
      { kind: "cta", href: "/portal/credits", label: "See your credit history", hint: "Every credit in and out, with dates" },
    ],
    faqs: [
      {
        q: "Do more alerts on one lorry cost more?",
        a: "No. A credit is charged per lorry per check, not per alert. Several alerts due on the same lorry at the same moment share one charge. A faster beat costs more; more rules on the same beat do not.",
      },
      {
        q: "I have credits but my plan ended. Can I still use them?",
        a: "For searching by hand, yes — that is the point of credits never expiring. For automatic tracking, no: that needs a plan that is still running.",
      },
      {
        q: "Does an alert or a Telegram message cost anything?",
        a: "No. Raising an alert and sending it are free. Only the looking costs.",
      },
    ],
  },

  /* ======================================================================== */
  /* trucks                                                                    */
  /* ======================================================================== */
  {
    slug: "add-a-truck",
    title: "Add a lorry",
    summary:
      "The number, an optional remark, its first alert, and the three limits that stop it by itself. Adding costs nothing.",
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
          "Type the registration number. Spaces and capitals do not matter — `GJ01AB1234` and `gj 01 ab 1234` are the same lorry.",
          "Add a remark if it helps you recognise it later, such as the transporter or the route. Only you see it.",
          "Choose its first alert and how often to look. This is the part that decides what it costs.",
          "Save. Adding the lorry costs nothing; the checking is what costs.",
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
        title: "A lorry with no alert is never checked",
        text: "That is why the alert is on the add form and not a step you can leave for later. With no alert switched on, the lorry sits on your list costing nothing and telling you nothing.",
      },
      { kind: "h", text: "When it stops by itself" },
      {
        kind: "p",
        text: "The add form has three optional limits, all of them there to stop a forgotten lorry quietly spending credits. You can leave every one of them blank and change them later on the lorry's own page.",
      },
      {
        kind: "bullets",
        items: [
          "Stop checking after — an end time. Checking stops there even if you forget about it.",
          "Stop checking after this many failures — how many unanswered checks in a row before it pauses. Leave it blank to follow the platform default, which the field shows you.",
          "Pause if it stops moving for — how long a lorry may sit still before checking pauses. Leave it blank to follow the platform default, which the field shows you.",
        ],
      },
      { kind: "h", text: "Slots" },
      {
        kind: "p",
        text: "Your plan caps how many lorries may be watched at once. My trucks tells you how many slots are free. A paused lorry does not use a slot, so pausing one you are not watching frees room for another.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Go to My trucks" },
    ],
    faqs: [
      {
        q: "I typed the number wrong. What happens?",
        a: "The portal cannot answer for a number that does not exist, so the checks fail — and a failed check costs a credit like any other. After five failures in a row we message you, and at the failure limit the lorry pauses. Fix the number on the lorry's own page before going live again.",
      },
      {
        q: "Can I add the same lorry twice?",
        a: "There is no reason to. One lorry may carry one alert of each kind, and a plaza alert for each named plaza, which covers every question you would otherwise add a second copy for.",
      },
      {
        q: "Does removing a lorry delete its history?",
        a: "No. Its alerts go and its slot is freed, but every toll crossing on record is kept.",
      },
    ],
  },

  {
    slug: "my-trucks-and-the-truck-page",
    title: "My trucks, and a lorry's own page",
    summary:
      "What each row on the list tells you, and what is on the page behind it: the route, the alerts, and every check with its cost.",
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
          "Live tracking — being checked automatically, and spending credits.",
          "Watchlist — on your list, not being checked and not spending credits.",
        ],
      },
      {
        kind: "p",
        text: "A lorry moves between the two with the switch on its row. Nothing is deleted either way, and nothing is re-added when it comes back.",
      },
      { kind: "h", text: "What a row tells you" },
      {
        kind: "table",
        head: ["On the row", "What it means"],
        rows: [
          ["The registration number", "Tap it to open the lorry's own page"],
          ["A badge", "Whether it is running, or which stop paused it"],
          ["The switch", "What starts and stops the spending on this lorry"],
          ["What it has done lately", "Its last crossing, and how often it is checked"],
        ],
      },
      {
        kind: "figure",
        name: "truck-row",
        caption: "One row: the number, its badge, the switch, and how often it is looked at.",
      },
      { kind: "h", text: "The lorry's own page" },
      {
        kind: "p",
        text: "Tap the number to open it. From top to bottom the page holds:",
      },
      {
        kind: "bullets",
        items: [
          "The number, its badge, and the exact time it was last checked. If it is paused, the badge has an (i) that says paused since when and why.",
          "Check now — one look, straight away, for one credit. Useful when you do not want to wait for the beat.",
          "Pause and Go live — the same switch as the list, with a fuller explanation.",
          "Alerts on this truck — every rule, its beat, and whether it is switched on.",
          "Route — every toll crossing on record, newest first.",
          "Alerts raised — what was sent about this lorry, and whether it was delivered.",
          "Every check, and its cost — opens [your activity](/portal/activity) narrowed to this lorry, so you can see exactly what it has spent.",
          "Settings — the remark, the tracking switch, the three stop limits, and Remove.",
        ],
      },
      {
        kind: "figure",
        name: "truck-detail",
        caption: "A lorry's page: last checked, where it was last recorded, and what to do next.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Only movements are stored",
        text: "A reading that reports the plaza the lorry is already at is never written to the route. So a short route list does not mean checks are missing — it means the lorry has not moved between plazas. The complete list of checks, including the quiet ones, is on the activity page.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Open My trucks" },
    ],
    faqs: [
      {
        q: "The route is empty but the balance is going down. Is something broken?",
        a: "Probably not. Checks are charged whether or not they find anything, and only movements are written to the route. Look at the last-checked time: if it is recent, the checking is working and the lorry has not crossed a plaza.",
      },
      {
        q: "What does Check now cost?",
        a: "One credit, the same as a search you type. The button says the figure before you press it.",
      },
      {
        q: "Can I read several lorries together?",
        a: "Yes. Put them in a group on [Groups](/portal/cases) and their crossings appear on one combined timeline. A group checks nothing of its own and costs nothing.",
      },
    ],
  },

  {
    slug: "going-live-and-pausing",
    title: "Going live, switching off, and every reason a lorry pauses",
    summary:
      "Pausing is the main lever you have on your bill. Seven things stop a lorry being checked; four of them you can undo yourself.",
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
        text: "The switch on a lorry's row, and the Pause and Go live buttons on its own page, are the same control. Live means it is being checked and spending credits. Paused means it is not being checked and not spending anything.",
      },
      {
        kind: "note",
        tone: "good",
        title: "Nothing is lost by pausing",
        text: "Paused lorries keep their history but do not consume tracking credits. Resume anytime when tracking is needed again. Its alerts, its settings and every crossing it recorded are all still there, and its slot is free for another lorry meanwhile.",
      },
      {
        kind: "p",
        text: "A lorry parked in a yard answers every check with yesterday's crossing, at a credit a check. Pausing it is not tidying up — it is the largest saving available to you.",
      },
      { kind: "h", text: "The seven reasons a lorry stops being checked" },
      {
        kind: "table",
        head: ["The badge you see", "What happened", "Can you switch it back on yourself"],
        rows: [
          ["Paused by you", "You paused it", "Yes, whenever you like"],
          [
            "Tracking period ended",
            "The end time you set for it arrived",
            "Yes — and set a new end time at the same moment",
          ],
          [
            "No movement detected",
            "No toll crossing arrived for as long as this lorry allows",
            "Yes, when it is back on the road",
          ],
          [
            "Portal not responding",
            "Too many checks in a row could not be answered for this number",
            "Yes, but check the number for a typo first",
          ],
          [
            "No credits left",
            "Your balance could not cover another check, so every live lorry stopped at once",
            "No — top up first, then take them live",
          ],
          [
            "Plan ended",
            "The plan ran out and the days to renew in have passed, so every lorry was switched off",
            "No — renew first, then take them live",
          ],
          [
            "Account suspended",
            "This account is switched off, so nothing on it is checked",
            "No — contact support",
          ],
        ],
      },
      {
        kind: "figure",
        name: "pause-badges",
        caption: "Each badge says what happened, and whether it is your own doing or the platform's.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "The last three do not respond to the switch",
        text: "With an empty balance, a lapsed plan or a suspended account, a lorry taken live would be refused at its very next check and paused again. The switch would appear to work and then undo itself. Fix the account first — top up, renew, or write to us — and then take each lorry live.",
      },
      { kind: "h", text: "Renewing and topping up do not switch anything back on" },
      {
        kind: "p",
        text: "This surprises people, so it is worth stating plainly. Buying credits clears the refusal, and renewing a plan brings automatic checking back — but neither takes a lorry live by itself. You go to [My trucks](/portal/trucks) and switch on the ones you still need. That is deliberate: an account that comes back should not immediately start spending on forty lorries it may no longer be watching.",
      },
      { kind: "h", text: "The no-movement stop, exactly" },
      {
        kind: "p",
        text: "The clock is counted from the later of the last crossing and the moment the lorry went live — not from a crossing that was already old when you added it. So a lorry that has been standing still for a week still gets a full window of being watched from the moment you switch it on. A crossing mid-journey resets the clock. The window itself is the Pause if it stops moving for field in the lorry's Settings, and the field shows the platform default it follows when you leave it blank.",
      },
      { kind: "h", text: "The failure stop, exactly" },
      {
        kind: "p",
        text: "A check fails when the portal cannot answer for that number. After five failures in a row we message you once. At the lorry's failure limit it pauses, because a failed check costs a credit like any other and retrying a number the portal will not answer only buys errors. The usual cause is a typo. You are allowed to go live again after fixing the number — a run of failures can be retried — but nothing will change if the number is still wrong.",
      },
      {
        kind: "note",
        tone: "info",
        title: "No farewell charge",
        text: "A lorry that reaches one of its stops is not charged for a last check. The stop is worked out before any credit is spent.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Review what is live", hint: "The Live tracking tab is what is spending" },
    ],
    faqs: [
      {
        q: "Does pausing lose my alerts or my history?",
        a: "No. The alerts stay attached with their settings, and every crossing on record is kept. Going live carries on where it stopped.",
      },
      {
        q: "My lorry paused itself and I did not do anything. Why?",
        a: "It says which reason applied, on the row and on its own page. The commonest are no movement for long enough, an end time you set arriving, and an empty balance.",
      },
      {
        q: "Does a paused lorry use a slot on my plan?",
        a: "No. Only lorries being checked use slots, so pausing one frees room for another.",
      },
      {
        q: "I renewed my plan. Why is nothing being checked?",
        a: "Because renewing does not switch the lorries back on. Open [My trucks](/portal/trucks) and take live the ones you need.",
      },
    ],
  },

  {
    slug: "how-often-we-look",
    title: "How often we look, and what that costs",
    summary:
      "The beat you choose is your bill. This is the one table worth reading before you switch a lorry on.",
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
        text: "Every alert carries its own interval — how often we look at that lorry. Every look is one credit, so the number of looks a day is the spend a day, per lorry.",
      },
      {
        kind: "table",
        head: ["Look every", "Times a day", "Credits a day, per lorry"],
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
        text: "Two lorries on the same beat cost twice this. Ten lorries on a fifteen-minute beat spend about 960 credits a day without you touching the phone.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "No plan's included credits cover its own term on the fastest beat",
        text: "That is not a fault, it is the shape of the product. A plan sets how many lorries and for how long; the credits set how closely. Pick a slower beat and the same credits go much further. Topping up is expected.",
      },
      { kind: "h", text: "Choosing a beat" },
      {
        kind: "bullets",
        items: [
          "A consignment you are actively waiting on: 15 or 30 minutes, and pause it the moment it arrives.",
          "A lorry you want a daily picture of: 3, 6 or 12 hours.",
          "A lorry you only want to hear about if it reaches one particular plaza: a slow beat is usually enough, because the plaza is not going anywhere.",
          "A lorry parked in a yard: paused. Not a slow beat — paused.",
        ],
      },
      {
        kind: "p",
        text: "The field takes minutes or hours, and the line under it says how many times a day that is before you save. You can change it any time from the lorry's own page without re-adding anything.",
      },
      { kind: "h", text: "More rules do not mean more cost" },
      {
        kind: "p",
        text: "A credit is charged per lorry per check, not per alert. Two alerts due on the same lorry at the same moment share one charge. But two alerts on different beats produce checks at both beats, and the two only coincide sometimes — which is how a lorry ends up looked at more often than you meant. That is why one lorry may carry only one alert of each kind.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Only when it moves is not cheaper",
        text: "All the alert kinds look just as often. Choosing Only when it moves makes your phone quieter, not your bill smaller. Only a slower beat does that.",
      },
      { kind: "cta", href: "/portal/activity", label: "See what your beats are actually spending" },
    ],
    faqs: [
      {
        q: "What is the fastest beat I can set?",
        a: "The field accepts short intervals, but nothing is checked more often than the platform's own sweep, and a fast beat is the most expensive thing on the product. Start at an hour and speed it up only for a lorry you are actively waiting on.",
      },
      {
        q: "If a lorry does not move, do I still pay?",
        a: "Yes. The credit is spent when the check runs, whatever it finds. That is what the no-movement auto-pause exists to limit.",
      },
      {
        q: "Can I set a different beat for a night run?",
        a: "Not on a schedule. Change the interval on the lorry's page when you need it, or pause the lorry and take it live again when the run starts.",
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
      "Three kinds of alert, one of each per lorry. What lands on your phone is the difference between them — not what it costs.",
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
        text: "An alert is what makes a lorry get checked at all, and it decides what reaches your phone. Add one from the lorry's own page under Alerts on this truck.",
      },
      {
        kind: "table",
        head: ["Alert", "What reaches your phone", "Example message"],
        rows: [
          [
            "Every time we look",
            "A message on every check, saying which plaza the lorry is at, even if it has not moved",
            "`GJ02AT8546 is at Nadiad Toll Plaza`",
          ],
          [
            "Only when it moves",
            "We look just as often, but you only hear when it reaches a different plaza",
            "`GJ02AT8546 moved to Nadiad Toll Plaza`",
          ],
          [
            "When it reaches a plaza",
            "Name one plaza. You hear the first time the lorry is recorded there",
            "`GJ02AT8546 reached Nadiad Toll Plaza`",
          ],
        ],
      },
      {
        kind: "figure",
        name: "alert-rules",
        caption: "Picking a kind and a beat. The line under the field says how many looks a day that is.",
      },
      {
        kind: "p",
        text: "Only when it moves is the sensible default and the one the form lands on. Every time we look is for a lorry you want a running log of, and it will message you a lot.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "All three cost the same",
        text: "They all look just as often, so they all spend the same. Only when it moves makes your phone quieter, not your bill smaller. The beat is what sets the cost — see [how often we look](/guide/trucks/how-often-we-look).",
      },
      { kind: "h", text: "One alert of each kind per lorry" },
      {
        kind: "p",
        text: "You may have one switched-on alert of each kind on a lorry, plus one for each named plaza on the plaza rule. That is a money rule, not tidiness: two Only when it moves rules on different beats would look at the same lorry at both beats and charge for both, to answer one question twice.",
      },
      { kind: "h", text: "The toll-plaza rule, and typing a plaza name" },
      {
        kind: "p",
        text: "When it reaches a plaza needs one plaza named. The picker helps you two ways:",
      },
      {
        kind: "bullets",
        items: [
          "It offers plazas ahead of this lorry, worked out from its own last crossing and the direction of its last leg. If it has only one crossing on record there is no direction to work from, so it offers the nearest plazas instead and says so. The distances are straight-line, so they always read shorter than the road.",
          "If you type instead, a spelling mistake still finds the plaza. Pick the suggestion rather than leaving what you typed: the alert fires on an exact match against the name the toll record produces, so a near miss never fires.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Two different plazas are two different alerts",
        text: "Tell me when it reaches Nadiad and tell me when it reaches Malvan are separate questions, so both are allowed on one lorry. Both are still one look at a time when their beats coincide.",
      },
      { kind: "h", text: "Switching an alert off" },
      {
        kind: "p",
        text: "A switched-off alert makes no check and spends nothing, and it is worth keeping rather than deleting: it holds the beat you chose and the last plaza it reported, which is what stops it messaging you about a crossing you were already told about when you switch it back on.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Open a lorry and add an alert" },
    ],
    faqs: [
      {
        q: "Can I get an alert when a lorry leaves a state, or enters a city?",
        a: "Not as its own rule. The three kinds above are what the app offers. Use When it reaches a plaza on a plaza on that route, or Only when it moves and read the plaza names as they arrive.",
      },
      {
        q: "I added a plaza alert and heard nothing when the lorry passed it.",
        a: "Check the plaza name is one you picked from the suggestions rather than typed freehand. The alert fires on an exact match with the name in the toll record. Also check that the lorry is on the Live tracking tab.",
      },
      {
        q: "Why can I not add two Only when it moves rules?",
        a: "Because they would answer one question twice and charge you for both. Change the beat on the rule you already have instead.",
      },
    ],
  },

  {
    slug: "telegram-alerts",
    title: "Where alerts are delivered, and setting up Telegram",
    summary:
      "Alerts reach you on Telegram, and only on Telegram. Save your chat id before you switch any tracking on — this is the most expensive step to skip.",
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
        text: "Alerts reach you as a Telegram message. They also always appear on the bell inside the app. WhatsApp is shown as coming soon and sends nothing today.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Read this twice",
        text: "If no Telegram chat id is saved, or one is saved but the switch is off, the alert is recorded in the app and never sent to anybody — and the credit is spent all the same. From the outside it looks like the product is working: rows appear on the bell, the balance goes down, and your phone stays silent. Nothing tells you at the moment it happens. Connect Telegram before you switch any tracking on.",
      },
      { kind: "h", text: "Find your chat id" },
      {
        kind: "steps",
        items: [
          `Open [@${ID_BOT_USERNAME}](${ID_BOT_START_URL}) in Telegram and press Start. It replies with a plain number - that is your chat id.`,
          "Press Start. It replies with an Id, which is a plain number.",
          "Copy that number.",
        ],
      },
      { kind: "h", text: "Save it and prove it works" },
      {
        kind: "steps",
        items: [
          "Paste the number into the Chat id field in [Settings](/portal/settings) and save.",
          "Turn Send me alerts on Telegram on. A saved id with the switch off sends nothing.",
          "Press Send test. If the test message arrives, alerts will arrive.",
          `If it does not arrive, open [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) and send it a \`/start\`, then test again. Telegram forbids a bot from messaging anyone who has not started it, so this one step is the difference between a saved chat id and a silent phone.`,
        ],
      },
      {
        kind: "figure",
        name: "telegram-setup",
        caption: "The chat id field, the switch under it, and Send test — all three have to be right.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Why two bots",
        text: "The first bot only tells you your own id. It is a public utility and sends you nothing afterwards. The alerts themselves come from our own bot, which is why that one needs its own `/start`. Send test is the only reliable way to know both halves are done.",
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
          "The chat id is saved and the switch under it is on.",
          `You have sent [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) a \`/start\`.`,
          "Send test reports connected.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "The bell is not a notification",
        text: "The bell at the top of the screen is this app's own list of the same alerts. It is there to look at, not to interrupt you — the interrupting is Telegram's job. Adding this app to your home screen opens it full screen; it does not make the icon buzz.",
      },
      { kind: "cta", href: "/portal/settings", label: "Set up Telegram now", hint: "Before you take a lorry live" },
    ],
    faqs: [
      {
        q: "An alert says it was not delivered. Do I get the credit back?",
        a: "No. The credit paid for the check, which ran. Delivery is separate and free. The alert is kept in the app with the reason it failed, so nothing is lost except the message.",
      },
      {
        q: "Can I send alerts to a group or to my team?",
        a: "You save one chat id. A Telegram group has its own id, so a group chat can be used — get its id the same way and paste that instead.",
      },
      {
        q: "Can I get alerts by SMS or WhatsApp?",
        a: "Not today. WhatsApp is shown in Settings as coming soon and sends nothing. Telegram is the only delivery there is.",
      },
      {
        q: "Will my old alerts be sent once I connect Telegram?",
        a: "No. Alerts raised while it was not connected were recorded and not sent, and they stay that way. They are still readable on the bell and on the lorry's own page.",
      },
    ],
  },

  /* ======================================================================== */
  /* credits                                                                   */
  /* ======================================================================== */
  {
    slug: "what-spends-a-credit",
    title: "What spends a credit, and what does not",
    summary:
      "Two things cost credits and both cost one. Everything else on the platform is free, including the alerts themselves.",
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
          ["A search you type on [Search](/portal/search)", "1 credit"],
          ["Check now on a lorry's own page", "1 credit"],
          ["One automatic check of a lorry you are watching", "1 credit"],
          ["An alert being raised", "Free"],
          ["The Telegram message", "Free"],
          ["Adding or removing a lorry", "Free"],
          ["Adding, editing or switching off an alert", "Free"],
          ["Making a group and reading it", "Free"],
          ["Pausing a lorry", "Free, and it stops the spending"],
          ["Opening any screen in the app", "Free"],
        ],
      },
      { kind: "h", text: "The credit is spent when the check runs" },
      {
        kind: "p",
        text: "Not when it finds something. The charge does not depend on whether the lorry moved, whether the plaza changed, whether an alert was raised, whether Telegram delivered it, or whether anything was found at all. All four of these cost the same one credit:",
      },
      {
        kind: "bullets",
        items: [
          "A new crossing was recorded.",
          "Nothing new since last time.",
          "The portal did not answer.",
          "The alert could not be delivered.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "An empty result still costs a credit",
        text: "It is a real answer: nothing has been recorded for that number recently. The asking is what costs, so it is charged like any other look.",
      },
      { kind: "h", text: "Per lorry per check, not per alert" },
      {
        kind: "p",
        text: "Several alerts due on the same lorry at the same moment share one charge. A faster beat costs more; more rules on the same beat do not.",
      },
      { kind: "cta", href: "/portal/activity", label: "See every charge on your account", hint: "Grouped by lorry, with dates" },
    ],
    faqs: [
      {
        q: "The portal failed. Why was I charged?",
        a: "Because the check ran. That is also why a lorry pauses itself after a run of failures — so a wrong number cannot keep buying errors.",
      },
      {
        q: "Does a bigger plan make each look cheaper?",
        a: "No. A plan decides how many lorries and for how long. The rate for a look is the same on every plan. Bigger top-ups are what give you better value per credit.",
      },
      {
        q: "Where can I see exactly what was charged?",
        a: "[Activity](/portal/activity) lists every charge and can be narrowed to one lorry. [Credit history](/portal/credits) reconciles the same charges against your balance.",
      },
    ],
  },

  {
    slug: "credit-history-and-running-out",
    title: "Your credit history, and running out",
    summary:
      "Where to read what came in and what went out, and exactly what stops when the balance reaches nothing.",
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
      { kind: "h", text: "Two screens, two questions" },
      {
        kind: "bullets",
        items: [
          "[Credit history](/portal/credits) is the statement: how your balance got to the number it shows. It has two sides, Credits added and Credits used.",
          "[Activity](/portal/activity) is the spending in detail: every look, what it cost, and which lorry it was for. It can be narrowed to one lorry from that lorry's own page.",
        ],
      },
      {
        kind: "figure",
        name: "credit-ledger",
        caption: "The statement: what came in, what went out, and the balance they add up to.",
      },
      {
        kind: "p",
        text: "Spending is shown one row per day, because a day is the unit a balance is read in. Tap a day to open the individual looks inside it.",
      },
      { kind: "h", text: "The lines you will see under Credits added" },
      {
        kind: "bullets",
        items: [
          "Purchased — a top-up you paid for.",
          "Included with plan — the credits a plan brought with it.",
          "Free trial credits — the trial pot.",
          "Credit code redeemed — a code worth credits.",
          "Referral reward and Welcome bonus — the two halves of an invite that paid out.",
          "Added by administrator and Adjusted by administrator — a correction or a grant made by hand, with a note saying why.",
        ],
      },
      { kind: "h", text: "What stops when the balance reaches nothing" },
      {
        kind: "p",
        text: "Everything that costs a credit, which is both kinds of look:",
      },
      {
        kind: "bullets",
        items: [
          "Searching by hand is refused.",
          "Automatic checking is refused, and every lorry that was live is paused with the badge No credits left rather than left on the list claiming to be watched.",
        ],
      },
      {
        kind: "note",
        tone: "good",
        title: "That is the point at which it stops costing you anything",
        text: "Nothing is checked, nothing is spent, and nothing is lost. The lorries, their alerts and every crossing they recorded are all still there.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Topping up does not take the lorries live again",
        text: "Buying credits clears the refusal, so the switch works again as soon as the balance covers a check. But you take each lorry live yourself from [My trucks](/portal/trucks). Switching one on before topping up will not hold — the next check would be refused for the same reason and pause it again.",
      },
      { kind: "h", text: "Before it happens" },
      {
        kind: "p",
        text: "The app warns you while there is still work left in the balance, measured in searches at today's rate rather than in a bare number. When you see that warning, either top up or pause the lorries you are not actively waiting on.",
      },
      { kind: "cta", href: "/portal/credits", label: "Open your credit history" },
    ],
    faqs: [
      {
        q: "My balance dropped and I did not search anything.",
        a: "Automatic checks are almost always the bigger number. One lorry on a fifteen-minute beat is 96 checks a day whether or not it moves. Open [Activity](/portal/activity) and look at the spending grouped by lorry.",
      },
      {
        q: "Can my balance go negative?",
        a: "No. A check that the balance cannot cover is refused rather than charged.",
      },
      {
        q: "I topped up but a lorry is still paused.",
        a: "That is expected. Renewing and topping up never switch a lorry back on. Take it live from [My trucks](/portal/trucks).",
      },
      {
        q: "A top-up is not showing in my history.",
        a: "Check [Payment history](/portal/payments) first. A payment that has not been confirmed adds nothing until it is. See [my payment did not add credits](/guide/trouble/payment-did-not-add-credits).",
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
      "A plan is charged once for its whole term. It decides how many lorries you may watch at once, for how long, and how many credits it starts you with.",
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
        text: "The live prices, terms, included credits and lorry limits are on [the pricing page](/pricing) and on your own [Plan and credits](/portal/plan) page. They are not repeated here, because they change without this page being rewritten.",
      },
      { kind: "h", text: "What a plan decides" },
      {
        kind: "bullets",
        items: [
          "How many lorries may be watched at once. This is a cap on lorries being checked, not on lorries on your list — a paused lorry uses no slot.",
          "Until when. The price shown is for the whole plan and is charged once. It is not a monthly price and there is nothing to multiply it by.",
          "How many credits it starts you with.",
          "Whether you may buy more credits at all. A top-up needs an active, paid plan.",
        ],
      },
      {
        kind: "figure",
        name: "plan-cards",
        caption: "Each card shows the whole price, the term, the credits included, and the lorry limit.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A plan's credits are a start, not a budget for its term",
        text: "No plan's included credits cover its own term for one lorry on the fastest beat. A lorry checked every fifteen minutes spends 96 credits a day. The plan sets how many lorries and for how long; the credits set how closely you watch them, and topping up is expected. A slower beat makes the same credits go much further.",
      },
      { kind: "h", text: "The free trial as a plan" },
      {
        kind: "p",
        text: "The trial is a plan too, with three differences: it is free, it is once per account, and it cannot be topped up. Its credits are cleared when it ends. See [claim the free trial](/guide/start/the-free-trial).",
      },
      { kind: "h", text: "Choosing one" },
      {
        kind: "bullets",
        items: [
          "Count the lorries you need watched at the same time, not the lorries you have. That is the number the plan caps.",
          "Pick the term you can actually use. A plan is charged once and expires on its end date.",
          "Assume you will top up. The credits included are what gets you going.",
        ],
      },
      { kind: "cta", href: "/portal/plan", label: "See the plans on your account" },
    ],
    faqs: [
      {
        q: "Is the price monthly?",
        a: "No. The price shown is for the whole plan, charged once, and the card says how long the plan runs for.",
      },
      {
        q: "Can I upgrade part-way through?",
        a: "Buy the plan you want from [Plan and credits](/portal/plan). Your credits are unaffected either way — they are a separate balance that never expires.",
      },
      {
        q: "Do I lose my lorries if I move to a smaller plan?",
        a: "Nothing is deleted. But only as many lorries as the new plan allows may be checked at once, so you choose which ones stay live and pause the rest.",
      },
      {
        q: "What happens to unused credits when a plan ends?",
        a: "Purchased credits stay. They never expire, and they still pay for searching by hand. Only trial credits die with the trial.",
      },
    ],
  },

  {
    slug: "plan-states-and-renewing",
    title: "Active, expired, or no plan — and renewing",
    summary:
      "The one table nobody guesses right. A lapsed plan is not a dead account, but it does stop automatic tracking and it blocks top-ups.",
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
        head: ["Your account", "Search by hand", "Automatic tracking", "Top up credits"],
        rows: [
          ["Paid plan, running", "Yes", "Yes", "Yes"],
          ["Free trial, running", "Yes", "Yes", "No — a top-up needs a paid plan"],
          [
            "Plan expired, or never bought one",
            "Yes — credits never expire",
            "No",
            "No — renew first",
          ],
          ["Free trial finished", "No — its credits went with it", "No", "No — choose a plan"],
          [
            "No credits left",
            "No",
            "No — every lorry is paused",
            "Yes, if a paid plan is running",
          ],
        ],
      },
      {
        kind: "p",
        text: "The row nobody guesses right is the third. A lapsed plan is not a dead account: the credits are still there and they still search. What a lapsed plan stops is the automatic side — the checking, and the alerts that come out of it — and buying more credits.",
      },
      { kind: "h", text: "What happens the day a plan ends" },
      {
        kind: "steps",
        items: [
          "Automatic checking stops that day. Nothing is checked and nothing is spent on checking.",
          "Your lorries stay on the list for a short renewal window, switched on but not checked, so a renewal in that window carries on exactly where it stopped. Your [Plan and credits](/portal/plan) page counts the days down for you.",
          "After that window every lorry is switched off and marked Plan ended. Nothing is deleted — the lorries, their alerts and every crossing they recorded are all still there.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Renewing does not switch your lorries back on",
        text: "Once they have been switched off, a renewal brings automatic checking back but takes nothing live by itself. You go to [My trucks](/portal/trucks) and switch on the ones you still need. Deliberate: an account coming back should not immediately start spending on lorries it may no longer be watching.",
      },
      { kind: "h", text: "Renewing" },
      {
        kind: "p",
        text: "Buy a plan again from [Plan and credits](/portal/plan). It brings its own credits, and you can add a top-up to the same payment. Then take your lorries live.",
      },
      {
        kind: "note",
        tone: "info",
        title: "A suspended account is a different thing",
        text: "Suspension stops every lorry at once and only support can lift it. It is not something renewing or topping up fixes — write to us from [the contact page](/contact).",
      },
      { kind: "cta", href: "/portal/plan", label: "Check or renew your plan" },
    ],
    faqs: [
      {
        q: "My plan ended. Can I still search?",
        a: "Yes, as long as you have credits. That is the point of credits never expiring. Automatic tracking is the part that needs a plan.",
      },
      {
        q: "Can I buy credits instead of renewing, to keep tracking going?",
        a: "No, twice over. A top-up needs an active, paid plan, so it would be refused — and credits alone would not restore automatic tracking anyway. Renewing is the only thing that brings it back.",
      },
      {
        q: "Will I lose my alerts and settings if I renew late?",
        a: "No. The lorries, their alerts, their beats and their history are all kept. What you have to do yourself is take each lorry live again.",
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
      "Top-ups add credits and change nothing else. They need an active, paid plan — which catches people out on the trial and after a plan ends.",
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
        text: "Open [Plan and credits](/portal/plan) and go to the Top up credits panel. Pick a pack, or name your own amount on the open tier. Bigger rungs are better value per credit, and the panel shows the rate for each.",
      },
      {
        kind: "p",
        text: "A top-up adds credits and changes nothing else — not your plan, not its end date, not how many lorries you may watch. Credits you buy never expire.",
      },
      {
        kind: "figure",
        name: "checkout",
        caption: "The top-up panel: the packs, what each buys, and the discount code box.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A top-up needs a paid plan that is running right now",
        text: "If your plan has expired, if you are on the free trial, or if you have never bought a plan, a top-up is refused. Buy or renew a plan first — and a plan brings credits of its own, so that is often the only purchase you needed. Buying a plan and a top-up together in one payment is fine.",
      },
      { kind: "h", text: "Paying" },
      {
        kind: "steps",
        items: [
          "Choose the pack or type an amount. The panel shows the credits before you pay.",
          "Add a discount code if you have one, in the Discount code box on the same panel.",
          "Press the button. A Razorpay window opens with your name and contact details already filled in.",
          "Pay by whatever method Razorpay offers you. We never see or hold your card or bank details.",
          "Wait on the page for a few seconds. Credits are added when Razorpay confirms the payment, not when the window closes.",
        ],
      },
      { kind: "h", text: "Two kinds of code, and they go in different places" },
      {
        kind: "table",
        head: ["Kind of code", "Where it goes", "What it does"],
        rows: [
          [
            "A code worth credits",
            "Have a credit code? on [Plan and credits](/portal/plan)",
            "Adds credits on its own. No purchase needed",
          ],
          [
            "A discount code",
            "The Discount code box on the buying panel",
            "Takes rupees off the price",
          ],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "A discount reduces what you pay, not what you get",
        text: "The credits are worked out from the price before the discount, so a discount code is the same goods for less money. A credit code is the other way round: it reduces nothing and simply grants credits, so it is refused at a checkout and has its own box.",
      },
      { kind: "cta", href: "/portal/plan", label: "Top up credits" },
    ],
    faqs: [
      {
        q: "Why is my top-up being refused?",
        a: "A top-up needs an active, paid plan. On an expired plan, on the trial, or with no plan ever bought, buy or renew a plan instead — it brings credits with it.",
      },
      {
        q: "Can I buy a plan and credits in one payment?",
        a: "Yes. The buying panel lets you attach a top-up to a plan purchase, and it is charged once. Your receipt shows both halves separately.",
      },
      {
        q: "Do bought credits expire if I stop using the account?",
        a: "No. Purchased credits are yours indefinitely and still pay for searching by hand even with no plan.",
      },
      {
        q: "Is there a minimum on the open tier?",
        a: "Yes, and the panel shows it. Below the minimum there is nothing to sell, so the amount is refused.",
      },
    ],
  },

  {
    slug: "payments-and-receipts",
    title: "Your payment history and receipts",
    summary:
      "Every payment, what it bought, what it added to your balance, and the reference to quote if something went wrong.",
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
        text: "[Payment history](/portal/payments) lists every payment on the account. Each row carries the date and time, its status, what you bought, the method, the price, what you actually paid after any discount, the credits it added, and a reference.",
      },
      {
        kind: "figure",
        name: "payment-history",
        caption: "The list, and the full receipt for whichever payment you open.",
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
            "Give it a few seconds and reload the page",
          ],
          [
            "Did not go through",
            "Razorpay refused it. Nothing was charged and nothing was added",
            "Try again whenever you like",
          ],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "If money left your account and the payment is not confirmed",
        text: "Open the payment on [Payment history](/portal/payments), copy the reference, and write to us from [the contact page](/contact) with it. Do not pay again first.",
      },
      { kind: "h", text: "The receipt" },
      {
        kind: "p",
        text: "Tap a row to open its full receipt at the top of the page. It shows what was bought, what was paid, any discount, every kind of credit the payment granted, and the references to quote. A payment that bought a plan with a top-up attached lists both halves separately, so you can see which credits were included and which were bought.",
      },
      {
        kind: "note",
        tone: "info",
        title: "A payment recorded by hand has no gateway reference",
        text: "If an administrator entered a payment for you, its receipt deliberately shows no order or payment id, because Razorpay never saw it and quoting one would send somebody hunting for a payment that does not exist.",
      },
      { kind: "cta", href: "/portal/payments", label: "Open your payment history" },
    ],
    faqs: [
      {
        q: "Can I get a GST invoice?",
        a: "The receipt on [Payment history](/portal/payments) is what the app produces. For anything more, write to us from [the contact page](/contact) with the payment reference.",
      },
      {
        q: "Where do I see what a payment did to my balance?",
        a: "The receipt states the credits it added, and [Credit history](/portal/credits) shows the same movement in your statement.",
      },
      {
        q: "A payment failed. Was I charged?",
        a: "No. A refused payment charges nothing and adds nothing. If your bank shows a debit anyway, quote the reference to us.",
      },
    ],
  },

  /* ======================================================================== */
  /* rewards                                                                   */
  /* ======================================================================== */
  {
    slug: "refer-and-earn",
    title: "Refer and earn",
    summary:
      "Share your link. When somebody who joined on it pays for their first plan, and again when they first top up, you both get credits. A sign-up on its own earns nothing.",
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
        text: "Your invite link is on [Invite and earn](/portal/referrals), with buttons to copy it and to share it. Anybody who signs up through it is attached to you.",
      },
      {
        kind: "figure",
        name: "referral-share",
        caption: "Your link, what it has earned so far, and everybody who has used it.",
      },
      { kind: "h", text: "How it pays" },
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
        text: "The two percentages in force are shown on [Invite and earn](/portal/referrals), which works them into credits for you. They are settings, so they are not printed here.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A sign-up earns nobody anything",
        text: "The reward is paid when money arrives, not when somebody registers. Two events, each paying once per person ever: their first plan, and their first top-up. After both have paid out, that invite is finished.",
      },
      { kind: "h", text: "If they buy a plan and credits in one payment" },
      {
        kind: "p",
        text: "It pays once, on the whole amount, and closes both events. Buying the two together therefore pays exactly what buying them a fortnight apart would have paid.",
      },
      { kind: "h", text: "What the badges on your list mean" },
      {
        kind: "table",
        head: ["Badge", "What it means"],
        rows: [
          ["Waiting", "Signed up, has not paid — earns you nothing yet"],
          ["Part paid", "One of the two rewards has landed; the other is still to come"],
          ["Both paid", "Plan and top-up — everything this invite is worth is yours"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "The credits are ordinary credits",
        text: "They land on the same balance as anything you buy, they never expire, and they show up in [your credit history](/portal/credits) as a referral reward or a welcome bonus.",
      },
      { kind: "h", text: "Codes worth credits" },
      {
        kind: "p",
        text: "If we send you a code that is worth credits, redeem it in the Have a credit code? box on [Plan and credits](/portal/plan). It needs no purchase. A discount code is a different thing and goes in the Discount code box on the buying panel instead — see [buying credits](/guide/payments/buying-credits).",
      },
      { kind: "cta", href: "/portal/referrals", label: "Get your invite link" },
    ],
    faqs: [
      {
        q: "When exactly do the credits arrive?",
        a: "On the same payment that triggered them, as soon as it is confirmed. If a friend has paid and nothing has landed, check whether their payment is confirmed on their side, then write to us.",
      },
      {
        q: "Can I invite myself with a second account?",
        a: "No. The scheme pays on real payments and the checks are on the account, the mailbox and the mobile number. It is not worth the trouble.",
      },
      {
        q: "Somebody signed up without my link. Can it be attached now?",
        a: "Not by you. Write to us with both email addresses and we will look at it.",
      },
      {
        q: "Is there a bonus for bringing several people?",
        a: "There is a milestone bonus, and [Invite and earn](/portal/referrals) shows whether it is running and what it takes to reach it.",
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
      "What you can change yourself, what only we can change, how the app behaves on an Android phone, and how to reach a person.",
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
        text: "Everything about you is in the My profile panel on [Settings](/portal/settings): your name, your mobile number, and optionally your job title, your company, your city and your state. You can change any of these yourself. The panel also shows your sign-in email, your password and the date you joined.",
      },
      {
        kind: "bullets",
        items: [
          "Keep the mobile number current. It is how we reach you if a payment goes wrong.",
          "Your sign-in email is not a field you can edit. Write to us to change it — the address is what your receipts, your password reset and your trial all hang on.",
          "Change your password from the same panel. If you have forgotten it, use [forgot password](/forgot-password) instead.",
          "Sign out from the menu at the top of the screen.",
        ],
      },
      { kind: "h", text: "Where alerts go, and where the app does not notify you" },
      {
        kind: "p",
        text: "Alerts arrive as Telegram messages, so it is Telegram that has to be allowed to notify you — not this app. The bell at the top of the screen is this app's own list of the same alerts; it is there to look at, not to interrupt you. Set Telegram up in [Settings](/portal/settings) and read [Telegram alerts](/guide/alerts/telegram-alerts) if the phone is silent.",
      },
      { kind: "h", text: "Putting Rahdari on your home screen" },
      {
        kind: "p",
        text: "Your phone will offer to add Rahdari to your home screen, and it is worth doing: it opens full screen, loads faster on a slow connection, and shows a plain notice instead of a browser error when the signal drops. It does not make the icon buzz — the interrupting is Telegram's job.",
      },
      { kind: "h", text: "Keeping your own copy of the history" },
      {
        kind: "p",
        text: "The Backup to your Google Sheet panel on [Settings](/portal/settings) copies your crossings, your alerts, your searches and a usage summary into a sheet you own. Share the sheet with the address shown on that panel as an Editor, paste the link, and test the connection. A sheet that stops working never stops your tracking.",
      },
      { kind: "h", text: "Getting help" },
      {
        kind: "steps",
        items: [
          "Look at [the support page](/support) first. It answers the questions that come up most.",
          "Look through this guide — [the help centre](/guide) is organised by what you are trying to do.",
          "If neither has it, write to us from [the contact page](/contact) with your account email and roughly when the problem happened. A person reads it.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "What to include when you write",
        text: "The registration number if it is about one lorry, the payment reference if it is about money, and the time you noticed it. That is usually enough to answer without a second email.",
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
        a: "There are no separate logins under one account today. Sharing a sign-in means sharing the balance and the alerts, so use one Telegram chat that you both read.",
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
    title: "My lorry is not being checked",
    summary:
      "Work down this list in order. Four of the five causes are on the lorry's own page, and the app has already written down which one it was.",
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
          "Open the lorry on [My trucks](/portal/trucks). If it is on the Watchlist tab it is not being checked at all — that is what that tab means.",
          "Look at its badge. If it is paused, the badge says which of the seven stops applied, and the (i) beside it says since when. See [every reason a lorry pauses](/guide/trucks/going-live-and-pausing).",
          "Check it has an alert switched on. A lorry with no switched-on alert is never checked, whatever the switch says.",
          "Check your balance on [Credit history](/portal/credits). With nothing in it, nothing is checked and every live lorry is paused.",
          "Check your plan on [Plan and credits](/portal/plan). Automatic checking needs a plan that is still running. An expired plan searches but does not track.",
          "Read the last-checked time on the lorry's own page. If it is recent, the checking is working — and what you are missing is a message, not a check. Go to [I got no alert](/guide/trouble/no-alert-arrived).",
        ],
      },
      { kind: "h", text: "The commonest causes, in order" },
      {
        kind: "table",
        head: ["What you see", "What it is", "The fix"],
        rows: [
          [
            "No alert on the lorry",
            "It was added and the alert step was skipped",
            "Add one alert on the lorry's own page",
          ],
          [
            "Badge says No credits left",
            "The balance could not pay for another check",
            "Top up, then take each lorry live yourself",
          ],
          [
            "Badge says Plan ended",
            "The plan lapsed and the renewal window passed",
            "Renew, then take each lorry live yourself",
          ],
          [
            "Badge says No movement detected",
            "No crossing arrived for as long as this lorry allows. Usually a parked lorry",
            "Go live when it is back on the road, or lengthen the window in its Settings",
          ],
          [
            "Badge says Portal not responding",
            "The portal could not answer for this number enough times in a row",
            "Check the number for a typo, fix it, then go live again",
          ],
          [
            "Badge says Tracking period ended",
            "The end time you set arrived",
            "Go live, and set a new end time at the same moment",
          ],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Three of them will not hold if you just flip the switch",
        text: "An empty balance, a lapsed plan and a suspended account all refuse the very next check, so the lorry would pause again within one beat. Fix the account first.",
      },
      {
        kind: "note",
        tone: "info",
        title: "An empty route is not a fault",
        text: "Only movements are written to the route, so a lorry that has not crossed a plaza shows nothing new however often it is checked. And a lorry off the tolled highways produces nothing at all — that is the data, not the app.",
      },
      { kind: "cta", href: "/portal/trucks", label: "Open My trucks" },
    ],
    faqs: [
      {
        q: "It says it was checked, but there is nothing new.",
        a: "Then the lorry has not been recorded at a new plaza. The check ran and cost its credit, and there was nothing to report. Nothing found means nothing was recorded.",
      },
      {
        q: "I switched it on and it switched itself off again.",
        a: "That is the empty balance or the lapsed plan refusing the next check. The badge will say which. Fix that first, then go live.",
      },
      {
        q: "Can I force a check right now?",
        a: "Yes. Check now on the lorry's own page does one look immediately for one credit.",
      },
    ],
  },

  {
    slug: "no-alert-arrived",
    title: "I got no alert",
    summary:
      "If the balance is going down and your phone is silent, this is almost always Telegram. Check it in this order.",
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
        title: "The most expensive mistake on the platform",
        text: "If no Telegram chat id is saved, or one is saved but the switch is off, alerts are recorded in the app and never sent to anybody — and the credit is spent all the same. Rows appear on the bell, the balance goes down, and the phone stays silent. Nothing tells you at the moment it happens.",
      },
      {
        kind: "steps",
        items: [
          "Open [Settings](/portal/settings). Confirm a chat id is saved and the switch under it is on.",
          "Press Send test. If the test arrives, alerts will arrive.",
          `If it does not arrive, open [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) and send it a \`/start\`. Telegram forbids a bot from messaging anyone who has not started it. Then test again.`,
          "Check Telegram itself is installed, signed in and allowed to notify you on that phone.",
          "Open the lorry's page and look at Alerts raised. If alerts are listed and marked undelivered, the checking is fine and delivery is the problem.",
        ],
      },
      { kind: "h", text: "If no alerts are being raised at all" },
      {
        kind: "bullets",
        items: [
          "On the Only when it moves rule, a lorry that has not reached a different plaza produces no message. That is the rule working, not a fault.",
          "On a plaza rule, the plaza name has to match the toll record exactly. Pick it from the suggestions rather than typing it freehand.",
          "A switched-off alert raises nothing. Check the alert itself is on, not just the lorry.",
          "If the lorry is not being checked at all, start with [my lorry is not being checked](/guide/trouble/truck-not-being-checked) instead.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "The app itself does not notify you",
        text: "The bell inside the app is a list to look at. Adding Rahdari to your home screen opens it full screen; it does not make the icon buzz. The interrupting is Telegram's job.",
      },
      { kind: "cta", href: "/portal/settings", label: "Check your Telegram setup" },
    ],
    faqs: [
      {
        q: "Will the alerts I missed be sent now that Telegram is connected?",
        a: "No. They were recorded and not sent, and they stay that way. You can still read them on the bell and on each lorry's page.",
      },
      {
        q: "Do I get the credits back for alerts that were never delivered?",
        a: "No. The credit paid for the check, which ran. Delivery is free and separate.",
      },
      {
        q: "The test message arrives but real alerts do not.",
        a: "Then delivery works and nothing is being raised. Check the alert is switched on, check the lorry is on the Live tracking tab, and remember that Only when it moves says nothing until the lorry reaches a different plaza.",
      },
    ],
  },

  {
    slug: "payment-did-not-add-credits",
    title: "My payment did not add credits",
    summary:
      "Check the status first. A payment adds nothing until Razorpay confirms it, and a refused payment charges nothing.",
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
          "Open [Payment history](/portal/payments) and find the payment. Its status is the answer.",
          "Waiting for confirmation means Razorpay has not confirmed it yet and nothing has been added. Give it a few seconds and reload.",
          "Did not go through means it was refused. Nothing was charged and nothing was added, and you can try again whenever you like.",
          "Paid means it landed. Check [Credit history](/portal/credits) for the matching line, and the receipt for what it added.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "If money left your account and the payment is not confirmed",
        text: "Do not pay again. Open the payment on [Payment history](/portal/payments), copy the reference, and write to us from [the contact page](/contact) with it and the time you paid.",
      },
      { kind: "h", text: "If the top-up was refused before you paid" },
      {
        kind: "p",
        text: "That is a different thing. A top-up needs an active, paid plan. On an expired plan, on the free trial, or with no plan ever bought, buying credits is refused — buy or renew a plan instead, and it brings credits with it. See [buying credits](/guide/payments/buying-credits).",
      },
      { kind: "h", text: "If the credits landed but nothing is being checked" },
      {
        kind: "p",
        text: "Expected. Topping up clears the refusal but never takes a lorry live by itself. Go to [My trucks](/portal/trucks) and switch on the ones you need.",
      },
      { kind: "cta", href: "/portal/payments", label: "Check your payment history" },
    ],
    faqs: [
      {
        q: "I paid for a plan and a top-up together. Only half the credits show.",
        a: "Open the receipt. A combined payment lists the plan's included credits and the bought credits separately, and the total is what landed on your balance.",
      },
      {
        q: "How long should I wait before writing to you?",
        a: "A confirmation normally takes seconds. If a payment is still unconfirmed after a few minutes and your bank shows a debit, write to us with the reference.",
      },
      {
        q: "Can I get a refund?",
        a: "Write to us from [the contact page](/contact) with the payment reference and what happened. Refunds are not something the app does by itself.",
      },
    ],
  },

  {
    slug: "cannot-sign-in",
    title: "I cannot sign in, or reset my password",
    summary:
      "Reset it yourself from the sign-in page. If the mail does not arrive, there are three things to check before writing to us.",
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
          "Open [forgot password](/forgot-password) and enter the address you registered with. We send a link to choose a new one.",
          "Check the spam and promotions folders. This is where the mail usually is.",
          "Check you are using the address you actually registered with. The mail goes wherever that says, and nowhere else.",
          "Wait a minute and try once more. A link that has expired needs a fresh send.",
          "Still nothing? Write to us from [the contact page](/contact), from the address you registered with, and say roughly when you tried.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Two different emails",
        text: "A password reset sends a link. Confirming your email address sends a six-digit code, which is a different thing and only needed before the free trial. Buying a plan or credits never asks for a code.",
      },
      { kind: "h", text: "If your password works but you are turned away" },
      {
        kind: "bullets",
        items: [
          "A suspended account cannot reach the app, and every lorry on it is stopped. Only support can switch it back on — write to us from [the contact page](/contact).",
          "If you can sign in but nothing is being checked, the account is fine and the problem is the plan, the balance or a paused lorry. Start with [my lorry is not being checked](/guide/trouble/truck-not-being-checked).",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Do not open a second account",
        text: "The free trial is once per account, mailbox and mobile number, and a new account starts with nothing — no lorries, no history, no credits. Recovering the one you have is always the shorter route.",
      },
      { kind: "cta", href: "/login", label: "Go to the sign-in page" },
    ],
    faqs: [
      {
        q: "Can I change the email I sign in with?",
        a: "Not yourself. Write to us — the address is what your receipts, your reset link and your trial all hang on.",
      },
      {
        q: "Is my data still there if I have not signed in for months?",
        a: "Yes. Your lorries, their alerts and your purchased credits are all kept. Automatic checking will need a plan that is still running, and you take each lorry live yourself.",
      },
      {
        q: "The reset link says it has expired.",
        a: "Send a fresh one from [forgot password](/forgot-password). Each link can be used once and does not last long.",
      },
    ],
  },
];
