import type { Metadata } from "next";
import { cookies } from "next/headers";
import { KeyRound } from "lucide-react";

import { ResetPasswordForm } from "./ResetPasswordForm";
import { AuthCard, PublicShell, publicSettings } from "@/components/SiteFooter";
import { RECOVERY_COOKIE, looksLikeRecoveryToken } from "@/lib/recovery";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `Choose a new password — ${brandName}` };
}

/*
 * No redirect for a signed-in visitor here, unlike the other public pages: the
 * recovery link signs the person in as its first act, so sending a signed-in
 * visitor away would bounce them out of the very flow they came for. Someone
 * arriving without a valid link is told so by the form itself.
 *
 * For the same reason the header carries no sign-in button. The reader already
 * has a session, so that button would take them out of the form mid-way through
 * changing the password they came here to change.
 */
/* Per request, so the brand in the header and footer is the one the admin has
   set rather than the one baked in at the last deploy - and now also because
   whether there is a form to show is read out of this browser's cookies. */
export const dynamic = "force-dynamic";

/**
 * WHETHER THE FORM APPEARS IS DECIDED HERE, on the server, before a byte of
 * HTML is sent. That is the whole point of the rewrite: the reader used to land
 * on a spinner that then went and asked Supabase whether their link was any
 * good. The token now arrives in a cookie set by /auth/recover, so its presence
 * is knowable for free, and the first paint is either the form or the reason
 * there isn't one.
 *
 * The cookie is only read, never spent. Nothing on this page tells Supabase
 * anything - see src/app/auth/recover/route.ts for why a GET must not consume a
 * one-time token.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const [store, params] = await Promise.all([cookies(), searchParams]);
  const hasToken = looksLikeRecoveryToken(store.get(RECOVERY_COOKIE)?.value);

  return (
    <PublicShell action={null} mainClassName="flex flex-1 items-center px-4 py-10">
      <AuthCard
        icon={<KeyRound size={22} />}
        title="Choose a new password"
        intro={
          hasToken
            ? "Pick something you have not used here before."
            : "This page needs the link from your reset email."
        }
      >
        <ResetPasswordForm hasToken={hasToken} linkBroken={params.link === "broken"} />
      </AuthCard>
    </PublicShell>
  );
}
