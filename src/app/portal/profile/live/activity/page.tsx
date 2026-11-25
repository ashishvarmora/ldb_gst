import { redirect } from "next/navigation";

/* v5: activity moved to /live; v6: it is the Logbook (per trip, truck, driver, warehouse). */
export default async function OldActivity({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string }> }) {
  const sp = await searchParams;
  const id = sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) ? sp.id : null;
  if (id && sp.tab === "drivers") redirect(`/live/logbook/drivers/${id}?view=day`);
  if (id && sp.tab === "trucks") redirect(`/live/logbook/trucks/${id}`);
  if (id && sp.tab === "warehouses") redirect(`/live/logbook/warehouses/${id}`);
  redirect("/live/logbook/trips");
}
