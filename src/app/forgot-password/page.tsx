import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";

import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `Forgot password — ${brandName}` };
}

export default function ForgotPasswordPage() {
  return (
    <div className="theme-light flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
              <KeyRound size={22} />
            </span>
            <h1 className="text-xl font-semibold text-strong">Forgot your password?</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Tell us your email address and we will send you a link to choose a new one.
            </p>
          </div>

          <div className="panel p-6">
            <ForgotPasswordForm />
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            Remembered it?{" "}
            <Link href="/login" className="font-medium text-brand-500 hover:text-brand-600">
              Back to sign in
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
