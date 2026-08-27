import { ShieldAlert } from "lucide-react";

import { SignOutButton } from "@/components/SignOutButton";
import { getSessionUser } from "@/lib/auth";

export const metadata = { title: "No access — GST Truck Intelligence" };

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const session = await getSessionUser();
  const suspended = reason === "suspended" || session?.profile.status === "suspended";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-md p-8 text-center">
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-warn-500/30 bg-warn-500/12 text-warn-500">
          <ShieldAlert size={22} />
        </span>

        <h1 className="text-lg font-semibold text-white">
          {suspended ? "Account suspended" : "No dashboard for this account"}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          {suspended
            ? "This account has been suspended, so searching and tracking are switched off. Contact your administrator to have it re-enabled."
            : "This account has no profile on the platform yet. Ask your administrator to set it up."}
        </p>

        {session ? (
          <p className="mt-4 rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2 text-xs text-ink-300">
            {session.email}
          </p>
        ) : null}

        <div className="mt-6 flex justify-center">
          <SignOutButton variant="secondary" size="md" />
        </div>
      </div>
    </main>
  );
}
