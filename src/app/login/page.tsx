import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";

import { LoginForm } from "./LoginForm";
import { AuthCard, PublicShell, publicSettings } from "@/components/SiteFooter";
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
    <PublicShell auth
      action={signupEnabled ? { href: "/signup", label: "Create account" } : null}
      mainClassName="flex flex-1 items-center px-4 py-10"
    >
      <AuthCard
        icon={<Truck size={22} />}
        title={`Sign in to ${brandName}`}
        intro="Welcome back. Pick up where you left off."
        footer={
          signupEnabled ? (
            <>
              New here?{" "}
              <Link href="/signup" className="font-medium text-brand-500 hover:text-brand-600">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Not registered yet?{" "}
              <Link href="/pricing" className="font-medium text-brand-500 hover:text-brand-600">
                See what it costs
              </Link>
            </>
          )
        }
      >
        <LoginForm />
      </AuthCard>
    </PublicShell>
  );
}
