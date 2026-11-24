import type { Metadata } from "next";
import { Link2Off, MapPin } from "lucide-react";

import { PublicShell, publicSettings } from "@/components/SiteFooter";
import { directionLabel } from "@/components/Timeline";
import { TripLine } from "@/components/TripLine";
import { Mono } from "@/components/ui";
import {
  destinationOf,
  maskPlate,
  tripProgress,
  type DestinationColumns,
} from "@/lib/destination";
import { fmtAgo, fmtWhen, fmtWhenAgo } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/*
 * PUBLIC, READ-ONLY TRIP PAGE - /t/<token> (owner, 24 Nov 2026; table
 * truck_shares from migration 0077).
 *
 * No sign-in: the random token IS the permission. The middleware only
 * refreshes a session cookie and gates nothing, so /t/* is reachable signed
 * out; the portal's own guards live in the portal layout, which this route is
 * not under.
 *
 * What is shown, and only this: the masked plate, the latest crossing, the
 * destination with distance left, and the last 10 crossings. Never the label,
 * the owner's name, phone, email, alerts or credits. Nothing here costs a
 * credit or sends a message - it only reads rows already stored.
 *
 * Kept out of search engines with noindex (robots.txt does not list /t on
 * purpose: a crawler must be allowed to fetch the page to see the noindex).
 */

export const dynamic = "force-dynamic";

const CROSSINGS = 10;

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Trip status — ${brandName}`,
    description: "Latest toll crossings for a shared truck trip.",
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: "no-referrer",
  };
}

type ShareRow = {
  tracked_truck_id: string;
  user_id: string;
  expires_at: string;
};

type TruckRow = { truck_number: string } & DestinationColumns;

type CrossingRow = {
  loc_name: string | null;
  lat: number | null;
  lng: number | null;
  direction: string | null;
  event_time: string | null;
};

async function loadTrip(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const admin = getSupabaseAdmin();

  const { data: share } = await admin
    .from("truck_shares")
    .select("tracked_truck_id,user_id,expires_at")
    .eq("token", token)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<ShareRow>();
  if (!share) return null;

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number,destination_name,destination_lat,destination_lng")
    .eq("id", share.tracked_truck_id)
    .eq("user_id", share.user_id)
    .maybeSingle<TruckRow>();
  if (!truck) return null;

  const { data: events } = await admin
    .from("truck_events")
    .select("loc_name,lat,lng,direction,event_time")
    .eq("user_id", share.user_id)
    .eq("truck_number", truck.truck_number)
    .order("event_time", { ascending: false, nullsFirst: false })
    .limit(CROSSINGS);

  return { share, truck, events: (events ?? []) as CrossingRow[] };
}

export default async function TripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const trip = await loadTrip(token);

  if (!trip) {
    return (
      <PublicShell mainClassName="px-4 py-10">
        <div className="trip-public">
          <div className="trip-public-card text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-line bg-raised text-muted">
              <Link2Off size={20} aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-strong">This trip link has ended</h1>
            <p className="mt-1.5 text-sm text-muted">
              It may have expired or been stopped by the person who shared it. Ask them for a new
              link.
            </p>
          </div>
        </div>
      </PublicShell>
    );
  }

  const { truck, events, share } = trip;
  const destination = destinationOf(truck);
  const progress = tripProgress(destination, events);
  const latest = events[0] ?? null;
  const heading = latest ? directionLabel(latest.direction) : null;

  return (
    <PublicShell mainClassName="px-0 py-4 sm:py-8">
      <div className="trip-public">
        <section className="trip-public-card" aria-label="Trip status">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Trip status</p>
          <h1 className="mt-1 text-xl font-semibold text-strong">
            <Mono className="tracking-wide">{maskPlate(truck.truck_number)}</Mono>
          </h1>

          <dl className="truck-facts">
            <div>
              <dt>Last crossing:</dt>
              <dd>
                {latest ? (
                  <>
                    <strong>{latest.loc_name ?? "Unnamed plaza"}</strong>
                    {heading ? ` (${heading})` : ""} · {fmtWhenAgo(latest.event_time)}
                  </>
                ) : (
                  "None recorded yet"
                )}
              </dd>
            </div>
          </dl>

          <TripLine destination={destination} progress={progress} className="mt-2" />
        </section>

        <section className="trip-public-card" aria-label="Recent toll crossings">
          <h2 className="mb-3 text-sm font-semibold text-strong">Recent toll crossings</h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted">No toll crossing recorded yet.</p>
          ) : (
            <ol className="trip-public-list">
              {events.map((event, index) => {
                const direction = directionLabel(event.direction);
                return (
                  <li key={`${event.event_time ?? "x"}-${index}`}>
                    <span className="min-w-0">
                      <MapPin size={12} aria-hidden className="mr-1 inline text-faint" />
                      <span className="font-medium text-ink">{event.loc_name ?? "Unnamed plaza"}</span>
                      {direction ? <span className="text-muted"> · {direction}</span> : null}
                    </span>
                    <span className="when">
                      {fmtWhen(event.event_time)}
                      <br />
                      {fmtAgo(event.event_time)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <p className="mt-4 px-1 text-xs leading-relaxed text-muted">
          Positions come from FASTag toll crossings, so the truck is seen only when it passes a toll
          plaza. Shared read-only by the truck&rsquo;s owner; this link works until{" "}
          {fmtWhen(share.expires_at)}.
        </p>
      </div>
    </PublicShell>
  );
}
