import Link from "next/link";
import { ArrowRight, Navigation, Receipt } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireLiveSession } from "@/lib/live/server";

import { enableLiveModuleForm } from "../live/actions";

/**
 * /apps - Rahdari's app launcher (0079), like Odoo's home: one tile per module.
 * Toll tracking is every account's; Live tracking switches on with one tap.
 * Later: roles decide which tiles a team member sees.
 */
export const metadata = { title: "Apps", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const live = await requireLiveSession();
  return (
    <main className="theme-light min-h-screen bg-page px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted">Rahdari</p>
        <h1 className="font-display text-2xl font-extrabold text-strong">Your apps</h1>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link href="/portal" className="panel flex min-h-36 flex-col gap-2 p-5 transition hover:-translate-y-0.5">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-[#edf4ff] text-[#1558b8]">
              <Receipt size={24} />
            </span>
            <strong className="text-lg text-strong">Toll tracking</strong>
            <span className="text-sm text-muted">Truck history and alerts from FASTag toll-plaza crossings.</span>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
              Open <ArrowRight size={15} />
            </span>
          </Link>
          <div className="panel flex min-h-36 flex-col gap-2 p-5">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-[#fff1e6] text-[#c2570c]">
              <Navigation size={24} />
            </span>
            <strong className="text-lg text-strong">Live tracking</strong>
            <span className="text-sm text-muted">Dispatch trips with live GPS from the driver&apos;s phone, e-way bill alerts and customer links.</span>
            {live.enabled ? (
              <Link href="/live" className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
                Open <ArrowRight size={15} />
              </Link>
            ) : live.available ? (
              <ActionForm action={enableLiveModuleForm} closeOnSuccess={false} className="mt-auto">
                <SubmitButton size="sm" pendingLabel="Switching on…">
                  Switch on - free
                </SubmitButton>
              </ActionForm>
            ) : (
              <span className="mt-auto text-xs text-muted">Coming in a moment (database update pending).</span>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
