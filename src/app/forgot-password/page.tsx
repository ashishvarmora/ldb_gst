import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";

import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { AuthCard, PublicShell, publicSettings } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `Forgot password — ${brandName}` };
}

/*
 * Rendered per request, not at build. Nothing on this page reads a cookie, so
 * Next would happily prerender it - and then the brand name in the header and
 * footer would be whatever it was on the day of the last deploy, while every
 * neighbouring page showed the name the admin has since set.
 */
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <PublicShell
      action={{ href: "/login", label: "Sign in" }}
      mainClassName="flex flex-1 items-center px-4 py-10"
    >
      <AuthCard
        icon={<KeyRound size={22} />}
        title="Forgot your password?"
        intro="Tell us your email address and we will send you a link to choose a new one."
        footer={
          <>
            Remembered it?{" "}
            <Link href="/login" className="font-medium text-brand-500 hover:text-brand-600">
              Back to sign in
            </Link>
          </>
        }
      >
        <ForgotPasswordForm />
      </AuthCard>
    </PublicShell>
  );
}
