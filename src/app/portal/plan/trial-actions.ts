"use server";

import { revalidatePath } from "next/cache";

import { formatCredits } from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { done, fail } from "@/lib/forms";
import { assertPortalUser } from "@/lib/officer";
import { rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, TrialVerdict } from "@/lib/types";

/**
 * Starting the free trial.
 *
 * IT IS A CLAIM, NOT A SIGN-UP BONUS. The trial could have been handed over
 * automatically the moment an account was created, and it deliberately is not:
 * the seven days would then start on the day somebody registered, which for
 * most people is the day before they had time to look at it. A button means the
 * clock starts when they are ready.
 *
 * NOTHING IS DECIDED HERE. Every rule - has this account had one, has this
 * mailbox had one, has this mobile had one, is there a trial on sale at all -
 * lives inside start_free_trial() and is enforced by unique indexes on
 * trial_claims. This action reads the session, throttles it, and turns a
 * verdict into a sentence. That split is the point: a rule in a Server Action is
 * a rule anybody who can reach the endpoint may argue with, and the endpoint is
 * reachable by every signed-in customer.
 *
 * The user id comes from the session and never from the form. It is the only
 * argument the RPC takes, and a posted one would let any signed-in customer
 * spend somebody else's one and only trial.
 */
export async function startFreeTrial(
  _prev: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult> {
  try {
    const session = await assertPortalUser();

    /*
     * Throttled even though the database refuses a second claim outright.
     *
     * The refusals below distinguish "you have had one" from "this account is
     * suspended" from "there is no trial", which makes this a small oracle
     * about other people's accounts if it could be called freely against a
     * guessed id - and it cannot, because the id comes from the session, but
     * the cheap limit is worth having anyway on the one endpoint that hands out
     * something for nothing.
     */
    const throttle = await rateLimit("checkout:user", session.id);
    if (!throttle.allowed) return fail(rateLimitMessage(throttle, "requests"));

    const { data, error } = await getSupabaseAdmin().rpc("start_free_trial", {
      p_user: session.id,
    });

    if (error) {
      return fail(reportError("start_free_trial rpc failed", error, "The trial could not be started just now. Please try again in a moment."));
    }

    const verdict = (data ?? { ok: false, reason: "no_trial" }) as TrialVerdict;

    if (!verdict.ok) {
      switch (verdict.reason) {
        case "has_plan":
          return fail("You already have a plan running. Nothing more to do.");
        case "email_unverified":
          /*
           * The one refusal that names its own remedy, and the only one that
           * should. The other three are deliberately vague - saying which
           * detail already claimed a trial tells somebody which detail to
           * change - but this one is not a refusal, it is a step the officer
           * has not taken yet, and hiding the way forward would just look
           * broken.
           *
           * A BACKSTOP NOW, not the normal route. The plan page reads
           * email_is_verified() before it draws the card and offers the verify
           * screen in place of this button, so reaching this means the answer
           * changed between the render and the tap. It said "open Verify your
           * email from the link on this page" while no such link existed
           * anywhere under /portal - a remedy nobody could follow - so it now
           * names the one thing that is certain to produce the link.
           */
          return fail(
            "Verify your email address first — we will send a six-digit code. Reload this page and the trial card will show a Verify your email button.",
          );
        case "already_claimed":
        case "had_plan":
        case "has_paid":
          /*
           * One sentence for all three, on purpose.
           *
           * They are different facts - this account has had a trial, this
           * mailbox has, this mobile has, this account has paid before - and
           * saying which would tell somebody exactly which detail to change to
           * get another one. "Contact us" is also the honest answer: an
           * administrator can grant credits by hand if there is a real reason.
           */
          return fail(
            "This account has already had its free trial. Choose a plan below, or contact us if you think that is wrong.",
          );
        case "account_suspended":
          return fail("This account is suspended. Contact support and they will look into it.");
        case "no_trial":
          return fail("There is no free trial at the moment. Choose a plan below to get started.");
        default:
          return fail("The free trial could not be started. Choose a plan below, or contact us.");
      }
    }

    // The truck limit and the balance gate every other portal page, so the
    // whole shell is stale the moment a trial starts.
    revalidatePath("/portal", "layout");
    revalidatePath("/portal/plan");

    return done(
      `Your free trial is running for ${verdict.trial_days} day${
        verdict.trial_days === 1 ? "" : "s"
      }, with ${formatCredits(verdict.credits)} credits to spend.`,
    );
  } catch (error) {
    return fail(reportError("startFreeTrial crashed", error));
  }
}
