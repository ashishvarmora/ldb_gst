import Link from "next/link";
import { Archive, ArchiveRestore, History, Pencil, Plus, Trash2 } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadOpenTrips, loadVehicles, logLive, requireLiveSession, safeReturn } from "@/lib/live/server";
import { ACTIVE_STATUSES, VEHICLE_TYPES, customFieldsOf, prettyVehicle, tripNo, type LiveVehicle } from "@/lib/live/shared";

import { archiveVehicle, deleteVehicle, restoreVehicle, saveVehicle } from "../../actions";
import { BackLink } from "../../BackLink";
import { Sheet } from "../../blocks";
import { CustomFieldsEditor, IconSubmit, PresetOrOther, SegU } from "../../ui";

export const metadata = { title: "Live tracking - Trucks" };
export const dynamic = "force-dynamic";

const BASE = "/live/masters/trucks";

function TruckForm({ v, back }: { v: LiveVehicle | null; back: string | null }) {
  const own = (v?.owner_type ?? "own") === "own";
  return (
    <ActionForm action={saveVehicle} closeOnSuccess={false} refresh={false} className="live-form">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      {!v && back ? <input type="hidden" name="return" value={back} /> : <input type="hidden" name="after" value={BASE} />}
      <div className="live-f">
        <label className="live-mini-label" htmlFor="t-no">
          Registration no.
        </label>
        <input id="t-no" name="number" required defaultValue={v?.number ?? ""} autoCapitalize="characters" placeholder="GJ36X1234" className="field live-field-sm w-full font-mono uppercase" />
      </div>
      <PresetOrOther name="vehicle_type" customName="vehicle_type_custom" presets={VEHICLE_TYPES} value={v?.vehicle_type} label="Vehicle type" placeholder="e.g. Reefer" />
      <div className="live-f">
        <span className="live-mini-label">Ownership</span>
        <SegU
          name="owner_type"
          label="Ownership"
          initial={own ? "own" : "transporter"}
          options={[
            { v: "own", label: "Own" },
            { v: "transporter", label: "Hired" },
          ]}
        />
      </div>
      <div className="live-form-2">
        <div className="live-f">
          <label className="live-mini-label" htmlFor="t-tr">
            Transporter (hired)
          </label>
          <input id="t-tr" name="transporter" maxLength={120} defaultValue={v?.transporter ?? ""} className="field live-field-sm w-full" />
        </div>
        <div className="live-f">
          <label className="live-mini-label" htmlFor="t-cap">
            Capacity (t)
          </label>
          <input id="t-cap" name="capacity_t" inputMode="decimal" placeholder="Optional" defaultValue={v?.capacity_kg != null ? String(v.capacity_kg / 1000) : ""} className="field live-field-sm w-full" />
        </div>
      </div>
      <div className="live-f">
        <span className="live-mini-label">Your fields</span>
        <CustomFieldsEditor initial={customFieldsOf(v?.custom_fields)} />
      </div>
      <SubmitButton size="sm" className="w-full">
        {v ? "Save" : back ? "Save and go back" : "Add truck"}
      </SubmitButton>
    </ActionForm>
  );
}

/** Trucks master (v5): compact rows, icon actions, add / edit in a sheet. */
export default async function TrucksMaster({ searchParams }: { searchParams: Promise<{ archived?: string; edit?: string; add?: string; return?: string }> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const showArchived = sp.archived === "1";
  const back = safeReturn(sp.return);
  const [vehicles, open, archived] = await Promise.all([
    loadVehicles(ownerId),
    loadOpenTrips(ownerId),
    showArchived
      ? getSupabaseAdmin()
          .from("live_vehicles")
          .select("*")
          .eq("owner_id", ownerId)
          .not("archived_at", "is", null)
          .order("number")
          .limit(500)
          .then(({ data, error }) => {
            if (error) logLive("archived trucks", error);
            return (data ?? []) as LiveVehicle[];
          })
      : Promise.resolve([] as LiveVehicle[]),
  ]);
  const onTrip = new Map(open.filter((t) => t.vehicle_id).map((t) => [t.vehicle_id!, t]));
  const list = showArchived ? archived : vehicles;
  const editing = sp.edit ? (vehicles.find((v) => v.id === sp.edit) ?? null) : null;
  const listHref = showArchived ? `${BASE}?archived=1` : BASE;

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-mhead">
        <h1>Trucks</h1>
        <nav className="live-seg-xs" aria-label="Filter">
          <Link href={BASE} aria-current={!showArchived ? "page" : undefined}>
            Active
          </Link>
          <Link href={`${BASE}?archived=1`} aria-current={showArchived ? "page" : undefined}>
            Archived
          </Link>
        </nav>
        <Link href={`${BASE}?add=1${back ? `&return=${encodeURIComponent(back)}` : ""}`} className="live-ib live-ib-brand" aria-label="Add truck" title="Add truck" scroll={false}>
          <Plus size={16} />
        </Link>
      </header>

      <ul className="live-rows">
        {list.map((v) => {
          const t = onTrip.get(v.id);
          const meta = [
            v.vehicle_type,
            v.owner_type === "own" || !v.owner_type ? "Own" : `Hired${v.transporter ? ` · ${v.transporter}` : ""}`,
            v.capacity_kg != null ? `${v.capacity_kg / 1000} t` : null,
            ...customFieldsOf(v.custom_fields).map(([k, x]) => `${k}: ${x}`),
          ].filter(Boolean);
          return (
            <li key={v.id} className="live-row">
              <div className="live-row-main">
                <strong className="font-mono">{prettyVehicle(v.number)}</strong>
                <small>
                  {meta.join(" · ")}
                  {!showArchived && t ? (
                    <>
                      {" · "}
                      <Link href={`/live/trips/${t.id}`} className="font-semibold text-brand-600">
                        {tripNo(t.trip_seq)} {ACTIVE_STATUSES.includes(t.status) ? "Active" : "Planned"}
                      </Link>
                    </>
                  ) : null}
                </small>
              </div>
              <div className="live-ibar">
                <Link href={`/live/history?truck=${v.id}&range=all`} className="live-ib" aria-label={`Trips of ${v.number}`} title="Trips">
                  <History size={15} />
                </Link>
                {showArchived ? (
                  <ActionForm action={restoreVehicle} closeOnSuccess={false} refresh={false}>
                    <input type="hidden" name="id" value={v.id} />
                    <IconSubmit label="Restore">
                      <ArchiveRestore size={15} />
                    </IconSubmit>
                  </ActionForm>
                ) : (
                  <>
                    <Link href={`${BASE}?edit=${v.id}`} className="live-ib" aria-label={`Edit ${v.number}`} title="Edit" scroll={false}>
                      <Pencil size={15} />
                    </Link>
                    <ActionForm action={archiveVehicle} closeOnSuccess={false} refresh={false}>
                      <input type="hidden" name="id" value={v.id} />
                      <IconSubmit label="Archive" confirm="Archive this truck? Its trips keep their history.">
                        <Archive size={15} />
                      </IconSubmit>
                    </ActionForm>
                  </>
                )}
                <ActionForm action={deleteVehicle} closeOnSuccess={false} refresh={false}>
                  <input type="hidden" name="id" value={v.id} />
                  <IconSubmit label="Delete" tone="bad" confirm={`Delete ${prettyVehicle(v.number)} for good? Old trips keep the number. This cannot be undone.`}>
                    <Trash2 size={15} />
                  </IconSubmit>
                </ActionForm>
              </div>
            </li>
          );
        })}
        {list.length === 0 ? <li className="live-empty">{showArchived ? "No archived trucks." : "No trucks yet. Tap + to add one."}</li> : null}
      </ul>

      {sp.add || editing ? (
        <Sheet title={editing ? `Edit ${prettyVehicle(editing.number)}` : "Add truck"} closeHref={back && !editing ? back : listHref}>
          <TruckForm key={editing?.id ?? "new"} v={editing} back={back} />
        </Sheet>
      ) : null}
    </div>
  );
}
