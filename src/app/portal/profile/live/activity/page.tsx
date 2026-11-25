import { redirect } from "next/navigation";

/* v5: activity moved to /live/activity (per trip; driver day view). */
export default async function OldLiveActivity({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string }> }) {
  const sp = await searchParams;
  const id = sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) ? sp.id : null;
  if (id && sp.tab === "drivers") redirect(`/live/activity?driver=${id}&view=day`);
  if (id && sp.tab === "trucks") redirect(`/live/activity?truck=${id}`);
  if (id && sp.tab === "warehouses") redirect(`/live/activity?place=${id}`);
  redirect("/live/activity");
}
