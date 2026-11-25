import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadOpenTrips, logLive, requireLiveSession, safeReturn } from "@/lib/live/server";
import { formatIndianMobile } from "@/lib/phone";
import { tripNo, type LiveDriver } from "@/lib/live/shared";

import { saveDriver } from "../../actions";
import { BackLink } from "../../BackLink";
import { DriverSignalPill } from "../../parts";
import { CustomFieldsEditor } from "../../ui";

export const metadata = { title: "Live tracking - Drivers" };
export const dynamic = "force-dynamic";

/**
 * Drivers master (0082): our own drivers only, with live status and last seen.
 * The only place to add / edit / archive a driver. ?add=1&return=<path> opens
 * the form and, after saving, goes back there with the new driver picked.
 * Trip-only drivers (receiving trips) are not listed; they live on their trip.
 */
export default async function DriversMaster({ searchParams }: { searchParams: Promise<{ archived?: string; add?: string; return?: string }> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const showArchived = sp.archived === "1";
  const back = safeReturn(sp.return);
  let q = getSupabaseAdmin().from("live_drivers").select("*").eq("owner_id", ownerId).eq("kind", "own").order("name").limit(500);
  q = showArchived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const [{ data, error }, open] = await Promise.all([q, loadOpenTrips(ownerId)]);
  if (error) logLive("drivers master", error);
  const drivers = (data ?? []) as LiveDriver[];
  const onTrip = new Map(open.filter((t) => t.driver_id).map((t) => [t.driver_id!, t]));
  const now = Date.now();

  return (
    <div className="live-page mx-auto max-w-3xl space-y-3">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-page-head">
        <div>
          <h1>Drivers</h1>
          <p>Your own drivers. One mobile = one driver; his tracking link is made now and reused on every trip.</p>
        </div>
      </header>

      <details className="panel live-form-block" open={Boolean(sp.add) || (drivers.length === 0 && !showArchived)}>
        <summary className="live-h2 cursor-pointer">+ Add a driver</summary>
        <ActionForm action={saveDriver} closeOnSuccess={false} resetOnSuccess refresh={false} className="mt-3">
          {back ? <input type="hidden" name="return" value={back} /> : null}
          <div className="live-form-grid">
            <Field label="Name" name="name" required>
              <Input name="name" required maxLength={80} autoComplete="off" />
            </Field>
            <Field label="Mobile" name="phone" required hint="His tracking link goes to this number on WhatsApp.">
              <Input name="phone" required inputMode="tel" placeholder="98765 43210" autoComplete="off" />
            </Field>
          </div>
          <p className="field-label mt-3">Your fields (optional)</p>
          <CustomFieldsEditor initial={[]} />
          <div className="mt-3">
            <SubmitButton size="sm">{back ? "Save and go back" : "Save driver"}</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <nav className="live-tabs" aria-label="Filter">
        <Link href="/live/masters/drivers" aria-current={!showArchived ? "page" : undefined}>
          Active
        </Link>
        <Link href="/live/masters/drivers?archived=1" aria-current={showArchived ? "page" : undefined}>
          Archived
        </Link>
      </nav>

      <div className="live-menu">
        {drivers.map((d) => {
          const t = onTrip.get(d.id);
          return (
            <Link key={d.id} href={`/live/drivers/${d.id}`}>
              <span className="min-w-0 flex-1">
                <strong>{d.name}</strong>
                <small className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>{d.phone ? formatIndianMobile(d.phone) : "No mobile"}</span>
                  {showArchived ? null : <DriverSignalPill driver={d} now={now} />}
                  {t ? <span>On {tripNo(t.trip_seq)}</span> : null}
                </small>
              </span>
              <ChevronRight size={16} className="text-faint" />
            </Link>
          );
        })}
        {drivers.length === 0 ? <p className="live-empty">{showArchived ? "No archived drivers." : "No drivers yet."}</p> : null}
      </div>
    </div>
  );
}
