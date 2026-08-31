import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";

import { SignupForm } from "./SignupForm";
import { AuthCard, PublicShell, publicSettings } from "@/components/SiteFooter";
import { LinkButton } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { reportError } from "@/lib/errors";
import { resolveReferralCode } from "@/lib/referrals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `Create an account — ${brandName}` };
}

/** Longest code we will even look up. Anything beyond this is not a code. */
const MAX_CODE_LENGTH = 32;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const session = await getSessionUser();
  if (session?.profile.status === "active") {
    redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
  }

  const [{ brandName, signupEnabled, referralEnabled, supportEmail }, params] = await Promise.all([
    publicSettings(),
    searchParams,
  ]);

  /*
   * The invitation, if there is one. A repeated ?ref= arrives as an array, so
   * the first value is taken and the rest ignored rather than the whole thing
   * being thrown away.
   *
   * Nothing here can stop a registration. An unknown or malformed code resolves
   * to null, the acknowledgement is simply not shown, and the account is created
   * exactly as it would have been - a bad code earns nobody anything, which is
   * not the same as being a problem for the person typing their name in.
   */
  const rawCode = (Array.isArray(params.ref) ? params.ref[0] : params.ref)?.trim().toUpperCase();
  const referralCode =
    rawCode && rawCode.length <= MAX_CODE_LENGTH && /^[A-Z0-9-]+$/.test(rawCode) ? rawCode : null;

  /* Acknowledged on the form so an invitation does not look ignored. Only shown
     for a code that actually resolves, and only while referrals are running -
     promising a reward the platform is not paying would be worse than silence. */
  const inviter = referralEnabled && referralCode ? await inviterFor(referralCode) : null;
  const inviteNote = !inviter
    ? null
    : inviter.name
      ? `You were invited by ${inviter.name}.`
      : `You were invited by someone already using ${brandName}.`;

  return (
    <PublicShell
      action={{ href: "/login", label: "Sign in" }}
      mainClassName="flex flex-1 items-center px-4 py-10"
    >
      <AuthCard
        icon={<UserPlus size={22} />}
        title={signupEnabled ? `Create your ${brandName} account` : "Registration is closed"}
        intro={
          signupEnabled
            ? "It takes a minute. You choose a plan once you are in, and nothing is charged before that."
            : "New accounts are not being opened at the moment."
        }
        footer={
          signupEnabled ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-brand-500 hover:text-brand-600">
                Sign in
              </Link>
            </>
          ) : null
        }
      >
        {signupEnabled ? (
          <SignupForm referralCode={referralCode} inviteNote={inviteNote} />
        ) : (
          <div className="space-y-4 text-sm leading-relaxed text-muted">
            <p>
              Sign-up is switched off for now.
              {supportEmail ? (
                <>
                  {" "}
                  Write to{" "}
                  <a href={`mailto:${supportEmail}`} className="link">
                    {supportEmail}
                  </a>{" "}
                  if you would like an account.
                </>
              ) : null}
            </p>
            <LinkButton href="/login" variant="secondary" className="w-full">
              Go to sign in
            </LinkButton>
          </div>
        )}
      </AuthCard>
    </PublicShell>
  );
}

/**
 * Who is inviting, for the line on the form. null means the code matched
 * nobody, which is a different thing from a referrer who never filled in a
 * name - the first has nothing to acknowledge, the second has.
 *
 * Only the name is read. An email address would tell anyone who guessed a code
 * who owns it, and the acknowledgement does not need one.
 *
 * Swallows its own failures, like everything else on this page: the form has to
 * be on screen even when the database is not answering, and a missing line of
 * courtesy is not worth an error page to somebody trying to register.
 */
async function inviterFor(code: string): Promise<{ name: string | null } | null> {
  try {
    const admin = getSupabaseAdmin();
    const referrerId = await resolveReferralCode(admin, code);
    if (!referrerId) return null;

    const { data } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", referrerId)
      .maybeSingle<{ full_name: string | null }>();

    return { name: data?.full_name?.trim() || null };
  } catch (error) {
    reportError("Sign-up: resolving referral code", error);
    return null;
  }
}
