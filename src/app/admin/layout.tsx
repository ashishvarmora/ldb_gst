import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

import { AdminMobileNav, AdminSidebar } from "@/components/AdminNav";
import { NavProgress } from "@/components/NavProgress";
import { SignOutButton } from "@/components/SignOutButton";
import { Avatar } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { initials } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperAdmin();
  // The product names itself from a setting, so the console has to read it too
  // rather than carrying a second, drifting copy of the name.
  const { brandName } = await loadSettings(getSupabaseAdmin());

  return (
    <div className="theme-light flex min-h-screen">
      {/*
       * Mounted once, here, because it covers the navigations nobody
       * instrumented individually - a customer's name in a table row, "View
       * all" in a panel header, a sort link, a link card on the overview.
       * The per-control indicators in NavPending are better feedback where
       * they exist, since they say WHICH control you tapped; this is the floor
       * under everything else. It waits 150ms before showing, so a cached
       * route change never makes it blink.
       */}
      <NavProgress />

      <AdminSidebar brandName={brandName} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
         * The header is sticky vertically only. `position: sticky` takes no
         * horizontal inset, so it is exactly as wide as the viewport and it
         * scrolls sideways with the document - which means the moment anything
         * on the page below is wider than the screen, panning right carries the
         * whole header left and Sign out, the last thing in the row, leaves the
         * screen. That is what the owner photographed. Every control here is
         * therefore sized so the row itself can never be the thing that
         * overflows, and every page below keeps its wide content in its own
         * scroller.
         */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-divider bg-page/85 px-4 py-3 backdrop-blur">
          {/*
           * min-w-0 plus truncate on the strapline. It is prose, so it breaks
           * at spaces and never overflows - but without a cap it wraps to four
           * lines somewhere around 660px and drags the header, and the top of
           * every page under it, down with it.
           */}
          <div className="flex min-w-0 items-center gap-3">
            <AdminMobileNav brandName={brandName} />
            <span className="hidden min-w-0 truncate text-xs text-faint sm:block">
              Admin console — every account, plan and payment is managed here.
            </span>
          </div>

          {/*
           * shrink-0, because this half is all controls: squeezing it is what
           * clips a button rather than moving it. The strapline opposite gives
           * up its width instead, which costs nothing.
           */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              href="/portal"
              className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs whitespace-nowrap text-muted transition hover:bg-sunken hover:text-ink sm:inline-flex"
            >
              <LayoutDashboard size={13} />
              Officer view
            </Link>

            {/*
             * Who you are signed in as waits for lg, where the sidebar appears
             * and the header finally has desktop room. An email is a single
             * unbreakable token, so this block's min-content width is the whole
             * address: as a flex item it refuses to shrink below that, and at
             * tablet widths one long address was taking a third of the row and
             * pushing the controls beside it off the end. The cap and the
             * truncate mean it can no longer set the row's minimum width at
             * all, whatever the address is - and it is a label, not a control,
             * so trimming it hides nothing anyone has to reach.
             */}
            <div className="hidden max-w-44 text-right lg:block">
              <p className="truncate text-xs font-medium text-ink">
                {session.profile.full_name ?? "Administrator"}
              </p>
              <p className="truncate text-[11px] text-faint">{session.email}</p>
            </div>

            {/*
             * On a phone the row is down to what is genuinely needed: the way
             * into the navigation, and the way out of the console. The monogram
             * is decoration next to a name that is not shown at this width
             * anyway, so it goes rather than competing for the same 360px with
             * a control somebody has to be able to hit.
             */}
            <span className="hidden sm:block">
              <Avatar text={initials(session.profile.full_name, session.email)} />
            </span>

            {/* Never "Sign / out" over two lines: it is the widest thing in the
                row and wrapping it is what made the header three lines tall on
                a narrow screen. */}
            <SignOutButton className="whitespace-nowrap" />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
