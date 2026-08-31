import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { ResetPasswordForm } from "./ResetPasswordForm";
import { AuthCard, PublicShell, publicSettings } from "@/components/SiteFooter";

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
   set rather than the one baked in at the last deploy. */
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <PublicShell action={null} mainClassName="flex flex-1 items-center px-4 py-10">
      <AuthCard
        icon={<KeyRound size={22} />}
        title="Choose a new password"
        intro="Pick something you have not used here before."
      >
        <ResetPasswordForm />
      </AuthCard>
    </PublicShell>
  );
}
