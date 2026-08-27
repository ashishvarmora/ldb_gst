import { redirect } from "next/navigation";
import { Truck } from "lucide-react";

import { LoginForm } from "./LoginForm";
import { getSessionUser } from "@/lib/auth";

export const metadata = { title: "Sign in — GST Truck Intelligence" };

export default async function LoginPage() {
  const session = await getSessionUser();
  if (session?.profile.status === "active") {
    redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
            <Truck size={22} />
          </span>
          <h1 className="text-xl font-semibold text-white">GST Truck Intelligence</h1>
          <p className="mt-1 text-sm text-ink-400">Sign in to your dashboard</p>
        </div>

        <div className="panel p-6">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Officer accounts are created by the administrator.
          <br />
          If you cannot sign in, contact your administrator.
        </p>
      </div>
    </main>
  );
}
