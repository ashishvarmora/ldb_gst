import { loadTrip, requireLiveSession, UUID_RE } from "@/lib/live/server";
import { tripDirection, tripNo } from "@/lib/live/shared";

import { BackLink } from "../../BackLink";
import { NewTripForm } from "./NewTripForm";

export const metadata = { title: "Live tracking - New trip" };
export const dynamic = "force-dynamic";

/**
 * /live/trips/new - step 1: sending or receiving, and the trip name. The trip
 * number is given now and never changes. Step 2 (driver, truck, details) is
 * the setup screen. ?copy=<tripId> = same route again; ?dir=incoming preselects.
 */
export default async function NewTripPage({ searchParams }: { searchParams: Promise<{ copy?: string; dir?: string }> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const copy = sp.copy && UUID_RE.test(sp.copy) ? await loadTrip(ownerId, sp.copy) : null;
  const dir = copy ? tripDirection(copy) : sp.dir === "incoming" ? "incoming" : "outgoing";
  return (
    <div className="live-page mx-auto max-w-xl space-y-3">
      <BackLink href="/live/trips" label="Trips" />
      <header className="live-page-head">
        <div>
          <h1>New trip</h1>
          <p>{copy ? `Same route as ${tripNo(copy.trip_seq)}.` : "Name it first. Driver and details come next."}</p>
        </div>
      </header>
      <NewTripForm defaultDirection={dir} copyId={copy?.id ?? null} />
    </div>
  );
}
