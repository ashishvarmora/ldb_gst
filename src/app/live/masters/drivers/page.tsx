import Link from "next/link";
import { Archive, ArchiveRestore, MoreVertical, Pencil, Phone, Plus, Trash2 } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { cx } from "@/components/ui";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadOpenTrips, logLive, requireLiveSession, safeReturn } from "@/lib/live/server";
import { formatIndianMobile, indianMobileDigits } from "@/lib/phone";
import { ACTIVE_STATUSES, customFieldsOf, type LiveDriver } from "@/lib/live/shared";

import { archiveDriver, deleteDriver, restoreDriver, saveDriver } from "../../actions";
import { BackLink } from "../../BackLink";
import { Sheet } from "../../blocks";
import { DriverSignalPill } from "../../parts";
import { CustomFieldsEditor, IconSubmit } from "../../ui";

export const metadata = { title: "Live tracking - Drivers" };
export const dynamic = "force-dynamic";

const BASE = "/live/masters/drivers";

function DriverForm({ d, back }: { d: LiveDriver | null; back: string | null }) {
  return (
    <ActionForm action={saveDriver} closeOnSuccess={false} refresh={false} className="live-form">
      {d ? <input type="hidden" name="id" value={d.id} /> : null}
      {!d && back ? <input type="hidden" name="return" value={back} /> : <input type="hidden" name="after" value={BASE} />}
      <div className="live-f">
        <label className="live-mini-label" htmlFor="d-name">
          Full name
        </label>
        <input id="d-name" name="name" required maxLength={80} defaultValue={d?.name ?? ""} autoComplete="off" className="field live-field-sm w-full" />
      </div>
      <div className="live-f">
        <label className="live-mini-label" htmlFor="d-phone">
          Mobile
        </label>
        <input id="d-phone" name="phone" required={!d} inputMode="tel" placeholder="98765 43210" defaultValue={indianMobileDigits(d?.phone) ?? ""} autoComplete="off" className="field live-field-sm w-full" />
      </div>
      <div className="live-f">
        <span className="live-mini-label">Your fields</span>
        <CustomFieldsEditor initial={customFieldsOf(d?.custom_fields)} />
      </div>
      <SubmitButton size="sm" className="w-full">
        {d ? "Save" : back ? "Save and go back" : "Add driver"}
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Drivers master (v5): compact rows, icon actions, add / edit in a sheet.
 * Our own drivers only; temporary drivers live on their trip.
 */
export default async function DriversMaster({ searchParams }: { searchParams: Promise<{ archived?: string; add?: string; edit?: string; return?: string }> }) {
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
  const editing = sp.edit ? (drivers.find((d) => d.id === sp.edit) ?? null) : null;
  const listHref = showArchived ? `${BASE}?archived=1` : BASE;

  return (
    <div className="live-page mx-auto max-w-2xl space-y-2.5">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-mhead">
        <h1>Drivers</h1>
        <nav className="live-seg-xs" aria-label="Filter">
          <Link href={BASE} aria-current={!showArchived ? "page" : undefined}>
            Active
          </Link>
          <Link href={`${BASE}?archived=1`} aria-current={showArchived ? "page" : undefined}>
            Archived
          </Link>
        </nav>
        <Link href={`${BASE}?add=1${back ? `&return=${encodeURIComponent(back)}` : ""}`} className="live-ib live-ib-brand" aria-label="Add driver" title="Add driver" scroll={false}>
          <Plus size={16} />
        </Link>
      </header>

      <ul className="lv-drows">
        {drivers.map((d) => {
          const t = onTrip.get(d.id);
          const active = t ? ACTIVE_STATUSES.includes(t.status) : false;
          return (
            <li key={d.id} className="lv-drow">
              <Link href={`/live/drivers/${d.id}`} className="lv-drow-main">
                <span className="lv-drow-av" aria-hidden>
                  {d.name.trim().charAt(0).toUpperCase() || "D"}
                </span>
                <span className="min-w-0 flex-1">
                  <strong>{d.name}</strong>
                  <small>
                    {d.phone ? formatIndianMobile(d.phone) : "No mobile"}
                    {showArchived ? null : <DriverSignalPill driver={d} now={now} />}
                  </small>
                </span>
                {t ? <span className={cx("lv-chip", active ? "lv-t-brand" : "lv-t-neutral")}>{active ? "On trip" : "Planned"}</span> : null}
              </Link>
              <div className="lv-drow-acts">
                {showArchived ? (
                  <ActionForm action={restoreDriver} closeOnSuccess={false} refresh={false}>
                    <input type="hidden" name="id" value={d.id} />
                    <IconSubmit label={`Restore ${d.name}`}>
                      <ArchiveRestore size={15} />
                    </IconSubmit>
                  </ActionForm>
                ) : (
                  <>
                    {d.phone ? (
                      <a href={`tel:${d.phone}`} className="live-ib" aria-label={`Call ${d.name}`} title="Call">
                        <Phone size={15} />
                      </a>
                    ) : null}
                    <Link href={`${BASE}?edit=${d.id}`} className="live-ib" aria-label={`Edit ${d.name}`} title="Edit" scroll={false}>
                      <Pencil size={15} />
                    </Link>
                  </>
                )}
                <details name="driver-menu" className="lv-menu">
                  <summary className="live-ib" aria-label={`More for ${d.name}`} title="More">
                    <MoreVertical size={15} />
                  </summary>
                  <div className="lv-menu-pop">
                    {showArchived ? null : (
                      <ActionForm action={archiveDriver} closeOnSuccess={false} refresh={false}>
                        <input type="hidden" name="id" value={d.id} />
                        <ConfirmSubmitButton message={`Archive ${d.name}? His link stops; trips and history stay. You can restore him.`} variant="ghost" size="sm" className="lv-menu-item">
                          <Archive size={14} /> Archive
                        </ConfirmSubmitButton>
                      </ActionForm>
                    )}
                    <ActionForm action={deleteDriver} closeOnSuccess={false} refresh={false}>
                      <input type="hidden" name="id" value={d.id} />
                      <ConfirmSubmitButton message={`Delete ${d.name} for good? His link stops. Old trips keep his name and mobile. This cannot be undone.`} variant="ghost" size="sm" className="lv-menu-item is-bad">
                        <Trash2 size={14} /> Delete
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </div>
                </details>
              </div>
            </li>
          );
        })}
        {drivers.length === 0 ? <li className="live-empty">{showArchived ? "No archived drivers." : "No drivers yet. Tap + to add one."}</li> : null}
      </ul>
      <p className="text-xs text-faint">One mobile = one driver. His personal tracking link is made now and reused on every trip.</p>

      {sp.add || editing ? (
        <Sheet title={editing ? `Edit ${editing.name}` : "Add driver"} closeHref={back && !editing ? back : listHref}>
          <DriverForm key={editing?.id ?? "new"} d={editing} back={back} />
        </Sheet>
      ) : null}
    </div>
  );
}
