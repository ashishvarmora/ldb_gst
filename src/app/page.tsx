import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BellRing, MapPin, Search, Truck, Wallet } from "lucide-react";

import { LogoBadge } from "@/components/Logo";
import { PublicShell, publicSettings } from "@/components/SiteFooter";
import { Badge, LinkButton } from "@/components/ui";
import { formatCredits, planChargeInr, planTermSuffix } from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import type { AlertRuleTemplate, Plan } from "@/lib/types";

/** Plans in the teaser. Three fit a phone screen; the rest are on /pricing. */
const TEASER_PLANS = 3;

/**
 * The landing page, for someone who has never seen this before.
 *
 * Everything on it is either true of the code as it stands or read out of the
 * database, and nothing else is on it. No customer counts, no uptime figures,
 * no testimonials: this is a small product and the honest description of it is
 * a better argument than an invented one.
 *
 * Signed-in visitors never see it - the server decides where they belong and
 * sends them there, which is also what the sign-in form relies on.
 */
export default async function Home() {
  const session = await getSessionUser();
  if (session) {
    if (session.profile.status !== "active") redirect("/no-access?reason=suspended");
    redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
  }

  // Read alongside the settings rather than after them: neither depends on the
  // other, and a landing page waiting on two round trips in series is a slow one.
  const [{ brandName, signupEnabled }, { plans, alertRules }] = await Promise.all([
    publicSettings(),
    loadCatalogue(),
  ]);

  const capabilities = [
    {
      icon: Search,
      title: "Look up any number plate",
      body: "Type a registration number and see the toll plazas that truck has been recorded at, newest first, with the time and the lane direction of each crossing.",
    },
    {
      icon: MapPin,
      title: "Keep the ones that matter under watch",
      body: "Add a truck to your list and it is checked for you in the background. Every new crossing is kept, so its route builds up and you can reopen it whenever you like.",
    },
    {
      icon: BellRing,
      title: "Be told on Telegram",
      body: "Connect a Telegram chat and the alert arrives on your phone the moment a check finds something new. Nothing to sit in front of and refresh.",
    },
  ];

  return (
    <PublicShell action={{ href: "/login", label: "Sign in" }} mainClassName="flex-1">
      {/* ------------------------------- hero ------------------------------ */}
      <section className="px-4 pt-12 pb-10 text-center sm:pt-16">
        <div className="mx-auto max-w-2xl">
          <LogoBadge size="lg" />

          <h1 className="mt-5 text-3xl leading-tight font-semibold tracking-tight text-strong sm:text-4xl">
            Follow a lorry by its registration number
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted">
            {brandName} looks a truck up on the toll network, shows you the plazas it has passed,
            and sends you a Telegram message when one you are watching moves.
          </p>

          <div className="mt-7 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center">
            {signupEnabled ? (
              <>
                <LinkButton href="/signup" variant="primary">
                  Create an account
                </LinkButton>
                <LinkButton href="/pricing" variant="secondary">
                  See what it costs
                </LinkButton>
              </>
            ) : (
              <>
                <LinkButton href="/login" variant="primary">
                  Sign in
                </LinkButton>
                <LinkButton href="/pricing" variant="secondary">
                  See what it costs
                </LinkButton>
              </>
            )}
          </div>
        </div>
      </section>

      {/* --------------------------- what it does -------------------------- */}
      <section className="px-4 py-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-xl font-semibold tracking-tight text-strong">
            What it actually does
          </h2>

          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {capabilities.map(({ icon: Icon, title, body }) => (
              <li key={title} className="panel p-5">
                <span className="inline-flex size-9 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
                  <Icon size={17} />
                </span>
                <p className="mt-3 text-sm font-semibold text-strong">{title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------- how it works ------------------------- */}
      <section className="px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-xl font-semibold tracking-tight text-strong">
            Three steps to your first message
          </h2>

          <ol className="panel mt-6 divide-y divide-divider">
            <Step n={1} title="Add a truck">
              Search a registration number, then add it to your list. Your plan decides how many
              trucks can be under watch at once.
            </Step>
            <Step n={2} title="Give it an alert">
              Pick a rule and how often it should run. A truck is only checked when one of its
              alerts is due, so nothing is spent watching a truck you have not asked about.
            </Step>
            <Step n={3} title="Get the messages">
              Anything a check turns up reaches your Telegram chat and is kept in your records, so
              the history is there whether or not you read the message.
            </Step>
          </ol>

          {/* The rules are the admin's catalogue, not a fixed list, so they are
              read rather than written into this page. */}
          {alertRules.length > 0 ? (
            <div className="mt-4">
              <p className="text-center text-sm font-medium text-ink">
                The alerts you can switch on today
              </p>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {alertRules.map((rule) => (
                  <li key={rule.id} className="panel p-4">
                    <p className="text-sm font-medium text-strong">{rule.name}</p>
                    {rule.description ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted">{rule.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-faint">
                      As often as every {rule.min_interval_minutes} minutes
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {/* --------------------------- pricing teaser ------------------------ */}
      <section className="px-4 py-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-xl font-semibold tracking-tight text-strong">
            A plan, and credits to spend
          </h2>
          {/* The full explanation of why the price has two halves lives on
              /pricing, which this section already links to. Repeating it here
              gave the same paragraph three homes and meant a visitor read it
              before reaching a single figure. A teaser teases. */}
          <p className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-muted">
            A plan sets how many trucks you can watch. Credits pay for each search and check.
          </p>

          {plans.length > 0 ? (
            <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {plans.map((plan) => (
                <li key={plan.id} className="panel flex flex-col p-5">
                  <p className="text-sm font-semibold text-strong">{plan.name}</p>
                  {plan.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted">{plan.description}</p>
                  ) : null}

                  {/* The whole price, and the term it buys beside it. This
                      said "a month" under every figure, which was wrong for the
                      three plans that run ninety days - the teaser told a
                      visitor a third of the truth and the pricing page then
                      corrected it. planTermSuffix() reads duration_days. */}
                  <p className="mt-3 text-2xl font-semibold tabular-nums text-strong">
                    {fmtRupees(planChargeInr(plan))}
                    <span className="ml-1 text-xs font-normal text-muted">
                      {planTermSuffix(plan)}
                    </span>
                  </p>

                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    <li>
                      <Badge tone="neutral">
                        <Truck size={11} />
                        {plan.truck_limit === -1
                          ? "Unlimited trucks"
                          : `${plan.truck_limit} truck${plan.truck_limit === 1 ? "" : "s"}`}
                      </Badge>
                    </li>
                    <li>
                      <Badge tone="brand">
                        <Wallet size={11} />
                        {formatCredits(plan.included_credits)} credits
                      </Badge>
                    </li>
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 flex justify-center">
            <LinkButton href="/pricing" variant="secondary">
              Full pricing, credits and rates
              <ArrowRight size={14} />
            </LinkButton>
          </div>
        </div>
      </section>

      {/* ------------------------------- close ----------------------------- */}
      <section className="px-4 pt-4 pb-14">
        <div className="panel mx-auto flex max-w-3xl flex-col items-center gap-4 p-6 text-center sm:p-8">
          <h2 className="text-lg font-semibold tracking-tight text-strong">
            {signupEnabled ? "Ready to watch your first truck?" : "Already have an account?"}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {signupEnabled
              ? "Registering takes a minute. You choose a plan once you are in, and nothing is charged before that."
              : "New accounts are not being opened at the moment, but existing ones work as usual."}
          </p>

          <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
            {signupEnabled ? (
              <LinkButton href="/signup" variant="primary">
                Create an account
              </LinkButton>
            ) : null}
            <LinkButton href="/login" variant={signupEnabled ? "secondary" : "primary"}>
              Sign in
            </LinkButton>
          </div>

          <p className="text-xs text-muted">
            Not sure yet?{" "}
            <Link href="/pricing" className="font-medium text-brand-500 hover:text-brand-600">
              Read the pricing first
            </Link>
            .
          </p>
        </div>
      </section>
    </PublicShell>
  );
}

/**
 * The two lists this page reads out of the database - the plans it teases, and
 * the alert rules the admin currently offers.
 *
 * Failure is answered with empty lists rather than an exception. This is the
 * page a stranger sees first, and it still says everything true about the
 * product with its pricing teaser missing; an error page says nothing at all.
 */
async function loadCatalogue(): Promise<{ plans: Plan[]; alertRules: AlertRuleTemplate[] }> {
  try {
    const admin = getSupabaseAdmin();
    const [planResult, alertResult] = await Promise.all([
      admin
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("price_inr")
        .limit(TEASER_PLANS),
      admin.from("alert_rule_templates").select("*").eq("is_active", true).order("sort_order"),
    ]);

    return {
      plans: (planResult.data ?? []) as Plan[],
      alertRules: (alertResult.data ?? []) as AlertRuleTemplate[],
    };
  } catch (error) {
    reportError("Landing page: plans and alert rules", error);
    return { plans: [], alertRules: [] };
  }
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5 px-5 py-4">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-xs font-semibold tabular-nums text-brand-500">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-strong">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  );
}
