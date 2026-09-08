import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, Mail } from "lucide-react";

import { VerifyEmailForm } from "./VerifyEmailForm";
import { HelpNote } from "@/components/Disclosure";
import { Badge, PageHeader, Panel, buttonClass } from "@/components/ui";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Verify your email — Rahdari" };

/**
 * One screen, one job: prove the mailbox so the free trial can be claimed.
 *
 * It exists as its own route rather than as a step inside the plan page because
 * the plan page is where somebody chooses what to buy, and a paying customer
 * never needs this at all - only the trial is gated on it. Making it a route
 * also means the trial button can simply link here when it is refused, and the
 * link back is the only thing either screen needs to know about the other.
 *
 * Why the trial is gated and a purchase is not: a card is its own proof of a
 * real person. A free trial hands over credits and a tracking slot for nothing,
 * and the only cost of manufacturing another one is another mailbox - which is
 * free and infinite unless somebody has to read it.
 */
export default async function VerifyEmailPage() {
  const { overview, email } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  /*
   * Somebody who already has a plan has nothing to prove, verified or not.
   *
   * email_is_verified() gates exactly one thing in this product - the free
   * trial, in start_free_trial() - so a plan-holder who reaches this route has
   * nothing to gain by finishing it. This read `isVerified && plan_id`, which
   * meant an unverified plan-holder was shown the full code flow and asked to
   * prove a mailbox for no reason, on a screen whose own footer says only the
   * trial needs it. Checked before the RPC, so that case does not pay for a
   * round trip on its way to a redirect.
   */
  if (overview.plan_id) redirect("/portal/plan");

  const { data: verified } = await admin.rpc("email_is_verified", { p_user: overview.id });

  /*
   * Nothing to do here once it is done, and nothing to gain from letting
   * somebody re-verify - so the screen stands down rather than offering a
   * button that would only rate-limit them.
   */
  const isVerified = verified === true;

  return (
    <>
      <PageHeader title="Verify your email" />

      <Panel className="max-w-xl">
        {isVerified ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-ink">
              <BadgeCheck size={16} className="shrink-0 text-good-500" />
              <span>
                <span className="font-medium">{email}</span> is verified.
              </span>
            </p>
            {/* "Continue to" and not "Start": this navigates, and the button
                that actually claims the trial is on the card it lands on.
                Labelling a link with the thing it does not itself do is how a
                reader ends up tapping twice and believing the first tap
                failed. */}
            <Link href="/portal/plan" className={buttonClass("primary", "md")}>
              Continue to the free trial
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-muted">
              <Mail size={16} className="mt-0.5 shrink-0 text-faint" />
              <span>
                We will email a six-digit code to{" "}
                <span className="font-medium text-ink">{email}</span>. Enter it below to start the
                free trial.
              </span>
            </p>

            {/* The address is read from the profile, never from this form -
                otherwise the gate proves a mailbox somebody typed rather than
                one they own. Changing it is a profile edit, deliberately. */}
            <p className="text-xs text-faint">
              Wrong address?{" "}
              <Link href="/portal/settings#profile" className="text-brand-500 hover:underline">
                Change it on your profile
              </Link>{" "}
              first — the code goes wherever that says.
            </p>

            <VerifyEmailForm />

            {/*
              THE NOTE THE OWNER ASKED FOR, and the reason it is folded rather
              than printed under the button.

              Mail from this deployment does land in spam - the sending domain
              is not the brand's and carries no enforcing DMARC policy, which is
              the owner's to fix and not this screen's. Until it is, the person
              most likely to give up is the one who sees "code sent" and an empty
              inbox, so the answer has to be on this screen. But it is only
              needed by somebody whose code has not arrived, and standing open
              it would read as us expecting our own email to fail.

              Asking them to mark it "not spam" is not filler: it is the one
              thing a reader can do that improves delivery of every later
              message to that mailbox, including the alerts they are here to buy.
            */}
            <HelpNote title="The code has not arrived">
              <p>
                Look in your spam or junk folder — a first message from a new sender is often filed
                there. If you find it, mark it as not spam so later emails from us reach your inbox.
              </p>
              <p className="mt-2">
                Codes can take a minute to arrive, and each one can be used once. If it has expired
                or never came, use the button above to send a fresh one.
              </p>
            </HelpNote>
          </div>
        )}
      </Panel>

      <Panel className="mt-4 max-w-xl" bodyClassName="py-3">
        <p className="text-xs leading-relaxed text-faint">
          Only the free trial needs this. <Badge tone="neutral">One trial per account</Badge> and per
          email address — buying a plan or credits never asks for a code.
        </p>
      </Panel>
    </>
  );
}
