import { redirect } from "next/navigation";
import { BellRing, MapPin, Search, Truck } from "lucide-react";

import { SiteFooter, publicSettings } from "@/components/SiteFooter";
import { LinkButton } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";

export default async function Home() {
  const session = await getSessionUser();
  if (session) {
    if (session.profile.status !== "active") redirect("/no-access?reason=suspended");
    redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
  }

  const { brandName, signupEnabled } = await publicSettings();

  const points = [
    {
      icon: Search,
      title: "Search by number plate",
      body: "Type a registration number and see where the truck was last picked up.",
    },
    {
      icon: MapPin,
      title: "Follow it as it moves",
      body: "Trucks you are watching are checked for you, and the route builds up over time.",
    },
    {
      icon: BellRing,
      title: "Told on Telegram",
      body: "A message when a truck moves, so you do not have to sit and refresh a page.",
    },
  ];

  return (
    <div className="theme-light flex min-h-screen flex-col">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl text-center">
          <span className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
            <Truck size={22} />
          </span>

          <h1 className="text-3xl font-semibold tracking-tight text-strong sm:text-4xl">
            {brandName}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-base leading-relaxed text-muted">
            Track a truck by its registration number, and get a message on Telegram when it moves.
          </p>

          <div className="mt-7 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center">
            {signupEnabled ? (
              <>
                <LinkButton href="/signup" variant="primary">
                  Create an account
                </LinkButton>
                <LinkButton href="/login" variant="secondary">
                  Sign in
                </LinkButton>
              </>
            ) : (
              <LinkButton href="/login" variant="primary">
                Sign in
              </LinkButton>
            )}
          </div>

          <ul className="mt-12 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {points.map(({ icon: Icon, title, body }) => (
              <li key={title} className="panel p-4">
                <span className="inline-flex text-brand-500">
                  <Icon size={18} />
                </span>
                <p className="mt-2.5 text-sm font-medium text-strong">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
