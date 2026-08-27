import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

import { AdminMobileNav, AdminSidebar } from "@/components/AdminNav";
import { SignOutButton } from "@/components/SignOutButton";
import { Avatar } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { initials } from "@/lib/format";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperAdmin();

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <AdminMobileNav />
            <span className="hidden text-xs text-ink-500 sm:inline">
              Super admin console — you manage every officer account from here.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/portal"
              className="hidden items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 sm:inline-flex"
            >
              <LayoutDashboard size={13} />
              Officer view
            </Link>
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-ink-100">
                {session.profile.full_name ?? "Administrator"}
              </p>
              <p className="text-[11px] text-ink-500">{session.email}</p>
            </div>
            <Avatar text={initials(session.profile.full_name, session.email)} />
            <SignOutButton />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
