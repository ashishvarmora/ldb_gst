import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { ResetPasswordForm } from "./ResetPasswordForm";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `Choose a new password — ${brandName}` };
}

/*
 * No redirect for a signed-in visitor here, unlike the other public pages: the
 * recovery link signs the person in as its first act, so sending a signed-in
 * visitor away would bounce them out of the very flow they came for. Someone
 * arriving without a valid link is told so by the form itself.
 */
export default function ResetPasswordPage() {
  return (
    <div className="theme-light flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
              <KeyRound size={22} />
            </span>
            <h1 className="text-xl font-semibold text-strong">Choose a new password</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Pick something you have not used here before.
            </p>
          </div>

          <div className="panel p-6">
            <ResetPasswordForm />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
