import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { SignOutButton } from "@/components/SignOutButton";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";
import { getSessionUser } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return { title: `No access — ${brandName}` };
}

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const [session, { supportEmail }] = await Promise.all([getSessionUser(), publicSettings()]);
  const suspended = reason === "suspended" || session?.profile.status === "suspended";

  return (
    <div className="theme-light flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="panel w-full max-w-md p-8 text-center">
          <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-warn-500/30 bg-warn-500/12 text-warn-500">
            <ShieldAlert size={22} />
          </span>

          <h1 className="text-lg font-semibold text-strong">
            {suspended ? "Account on hold" : "This account is not set up yet"}
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-muted">
            {suspended
              ? "Searching and tracking are switched off on this account for now. Get in touch and we will look into it."
              : "We could not find the details that go with this account, so there is nothing to show you yet. Get in touch and we will sort it out."}
          </p>

          {supportEmail ? (
            <p className="mt-3 text-sm text-muted">
              Write to{" "}
              <a href={`mailto:${supportEmail}`} className="link">
                {supportEmail}
              </a>
              .
            </p>
          ) : null}

          {session ? (
            <p className="mt-4 rounded-lg border border-line bg-raised/60 px-3 py-2 text-xs text-muted">
              {session.email}
            </p>
          ) : null}

          <div className="mt-6 flex justify-center">
            <SignOutButton variant="secondary" size="md" />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
