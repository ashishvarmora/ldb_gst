import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";

import { LoginForm } from "./LoginForm";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";
import { getSessionUser } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `Sign in — ${brandName}` };
}

export default async function LoginPage() {
  const session = await getSessionUser();
  if (session?.profile.status === "active") {
    redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
  }

  const { brandName, signupEnabled } = await publicSettings();

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
            <h1 className="text-xl font-semibold text-strong">{brandName}</h1>
            <p className="mt-1 text-sm text-muted">Sign in to your dashboard</p>
          </div>

          <div className="panel p-6">
            <LoginForm />
          </div>

          {signupEnabled ? (
            <p className="mt-6 text-center text-sm text-muted">
              New here?{" "}
              <Link href="/signup" className="font-medium text-brand-500 hover:text-brand-600">
                Create an account
              </Link>
            </p>
          ) : null}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
