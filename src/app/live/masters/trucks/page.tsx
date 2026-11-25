import Link from "next/link";
import { Pencil, Trash2, Truck } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadOpenTrips, loadVehicles, logLive, requireLiveSession, safeReturn } from "@/lib/live/server";
import { ACTIVE_STATUSES, VEHICLE_OWNER_LABEL, customFieldsOf, prettyVehicle, tripNo, type LiveVehicle } from "@/lib/live/shared";

import { archiveVehicle, deleteVehicle, restoreVehicle, saveVehicle } from "../../actions";
import { BackLink } from "../../BackLink";
import { CustomFieldsEditor } from "../../ui";

export const metadata = { title: "Live tracking - Trucks" };
export const dynamic = "force-dynamic";

function TruckForm({ v, back }: { v: LiveVehicle | null; back?: string | null }) {
  const own = (v?.owner_type ?? "own") === "own";
  return (
    <ActionForm action={saveVehicle} closeOnSuccess={false} resetOnSuccess={!v} refresh={false} className="mt-3">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      {!v && back ? <input type="hidden" name="return" value={back} /> : null}
      <div className="live-form-grid">
        <Field label="Truck number" name="number" required>
          <Input name="number" required defaultValue={v?.number ?? ""} autoCapitalize="characters" placeholder="GJ36X1234" className="font-mono uppercase" />
        </Field>
        <div>
          <span className="field-label">Truck is</span>
          <div className="live-chips" role="radiogroup" aria-label="Truck owner">
            <label className="live-chip-radio">
              <input type="radio" name="owner_type" value="own" defaultChecked={own} />
              <span>Our own</span>
            </label>
            <label className="live-chip-radio">
              <input type="radio" name="owner_type" value="transporter" defaultChecked={!own} />
              <span>Hired</span>
            </label>
          </div>
        </div>
        <Field label="Transporter (if hired)" name="transporter">
          <Input name="transporter" defaultValue={v?.transporter ?? ""} />
        </Field>
      </div>
      <p className="field-label mt-3">Your fields</p>
      <CustomFieldsEditor initial={customFieldsOf(v?.custom_fields)} />
      <div className="mt-3">
        <SubmitButton size="sm">{v ? "Save truck" : back ? "Save and go back" : "Add truck"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

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
  const editing = sp.edit ? vehicles.find((v) => v.id === sp.edit) ?? null : null;

  return (
    <div className="live-page mx-auto max-w-3xl space-y-3">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-page-head">
        <div>
          <h1>Trucks</h1>
          <p>Pick a truck on a trip; no standing driver. Old trips keep the number even after delete.</p>
        </div>
      </header>

      <details className="panel live-form-block" open={Boolean(editing) || Boolean(sp.add) || (vehicles.length === 0 && !showArchived)} id="truck-form">
        <summary className="live-h2 cursor-pointer">{editing ? `Edit ${prettyVehicle(editing.number)}` : "+ Add a truck"}</summary>
        <TruckForm key={editing?.id ?? "new"} v={editing} back={back} />
      </details>

      <nav className="live-tabs" aria-label="Filter">
        <Link href="/live/masters/trucks" aria-current={!showArchived ? "page" : undefined}>
          Active
        </Link>
        <Link href="/live/masters/trucks?archived=1" aria-current={showArchived ? "page" : undefined}>
          Archived
        </Link>
      </nav>

      <div className="live-list">
        {list.map((v) => {
          const t = onTrip.get(v.id);
          const cf = customFieldsOf(v.custom_fields);
          return (
            <div key={v.id} className="panel live-list-row">
              <span className="live-list-icon">
                <Truck size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold text-strong">{prettyVehicle(v.number)}</p>
                <p className="text-xs text-muted">
                  {[v.owner_type === "own" ? "Own" : v.owner_type ? `Hired (${VEHICLE_OWNER_LABEL[v.owner_type]})` : null, v.transporter, ...cf.map(([k, x]) => `${k}: ${x}`)].filter(Boolean).join(" · ") || "-"}
                </p>
                {!showArchived && t ? (
                  <p className="text-xs text-ink">
                    <Link href={`/live/trips/${t.id}`} className="font-semibold text-brand-600">
                      On {tripNo(t.trip_seq)}
                    </Link>
                    {ACTIVE_STATUSES.includes(t.status) ? " · Active" : " · Planned"}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                {showArchived ? (
                  <ActionForm action={restoreVehicle} closeOnSuccess={false} refresh={false}>
                    <input type="hidden" name="id" value={v.id} />
                    <SubmitButton variant="secondary" size="sm">
                      Restore
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <>
                    <Link href={`/live/masters/trucks?edit=${v.id}#truck-form`} className={buttonClass("ghost", "sm")} aria-label={`Edit ${v.number}`}>
                      <Pencil size={14} />
                    </Link>
                    <ActionForm action={archiveVehicle} closeOnSuccess={false} refresh={false}>
                      <input type="hidden" name="id" value={v.id} />
                      <ConfirmSubmitButton message="Archive this truck? Its trips keep their history." variant="ghost" size="sm">
                        Archive
                      </ConfirmSubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteVehicle} closeOnSuccess={false} refresh={false}>
                      <input type="hidden" name="id" value={v.id} />
                      <ConfirmSubmitButton message={`Delete ${prettyVehicle(v.number)} for good? Old trips keep the number. This cannot be undone.`} variant="ghost" size="sm">
                        <Trash2 size={14} />
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {list.length === 0 ? <p className="live-empty">{showArchived ? "No archived trucks." : "No trucks yet."}</p> : null}
      </div>
    </div>
  );
}
