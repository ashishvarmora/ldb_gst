import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";

import { SignupForm } from "./SignupForm";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";
import { LinkButton } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `Create an account — ${brandName}` };
}

export default async function SignupPage() {
  const session = await getSessionUser();
  if (session?.profile.status === "active") {
    redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
  }

  const { brandName, signupEnabled, supportEmail } = await publicSettings();

  return (
    <div className="theme-light flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <Link
              href="/"
              className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/12 text-brand-400 transition hover:bg-brand-500/18"
              aria-label={`${brandName} home`}
            >
              <Truck size={22} />
            </Link>
            <h1 className="text-xl font-semibold text-strong">
              {signupEnabled ? `Create your ${brandName} account` : "Registration is closed"}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {signupEnabled
                ? "It takes a minute. You choose a plan once you are in."
                : "New accounts are not being opened at the moment."}
            </p>
          </div>

          <div className="panel p-6">
            {signupEnabled ? (
              <SignupForm />
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
          </div>

          {signupEnabled ? (
            <p className="mt-6 text-center text-sm text-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-brand-500 hover:text-brand-600">
                Sign in
              </Link>
            </p>
          ) : null}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
