import Link from "next/link";
import { Pencil, Truck } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadDriverBoard, logLive, requireLiveSession, safeReturn } from "@/lib/live/server";
import { VEHICLE_OWNER_LABEL, prettyVehicle, type LiveVehicle, type VehicleOwnerType } from "@/lib/live/shared";

import { archiveVehicle, restoreVehicle, saveVehicle } from "../../actions";
import { BackLink } from "../../BackLink";

export const metadata = { title: "Live tracking - Trucks" };
export const dynamic = "force-dynamic";

function TruckForm({ v, back }: { v: LiveVehicle | null; back?: string | null }) {
  return (
    <ActionForm action={saveVehicle} closeOnSuccess={false} resetOnSuccess={!v} refresh={false} className="mt-3">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      {!v && back ? <input type="hidden" name="return" value={back} /> : null}
      <div className="live-form-grid">
        <Field label="Truck number" name="number" required>
          <Input name="number" required defaultValue={v?.number ?? ""} autoCapitalize="characters" placeholder="GJ36X1234" className="font-mono uppercase" />
        </Field>
        <Field label="Type" name="vehicle_type">
          <Input name="vehicle_type" defaultValue={v?.vehicle_type ?? ""} placeholder="e.g. 10-wheeler" />
        </Field>
        <Field label="Truck owner" name="owner_type">
          <Select name="owner_type" defaultValue={v?.owner_type ?? "own"}>
            {(Object.keys(VEHICLE_OWNER_LABEL) as VehicleOwnerType[]).map((o) => (
              <option key={o} value={o}>
                {VEHICLE_OWNER_LABEL[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner / transporter name" name="transporter">
          <Input name="transporter" defaultValue={v?.transporter ?? ""} />
        </Field>
        <Field label="Capacity (kg)" name="capacity_kg">
          <Input name="capacity_kg" inputMode="numeric" defaultValue={v?.capacity_kg ?? ""} />
        </Field>
        <Field label="Notes" name="notes">
          <Input name="notes" defaultValue={v?.notes ?? ""} />
        </Field>
      </div>
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
  const [{ rows, vehicles }, archived] = await Promise.all([
    loadDriverBoard(ownerId),
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
  const holder = new Map(rows.filter((r) => r.vehicle).map((r) => [r.vehicle!.id, r.driver]));
  const list = showArchived ? archived : vehicles;
  const editing = sp.edit ? vehicles.find((v) => v.id === sp.edit) ?? null : null;

  return (
    <div className="live-page mx-auto max-w-3xl space-y-3">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-page-head">
        <div>
          <h1>Trucks</h1>
          <p>Our trucks. A truck has one driver at a time; pick it on a trip.</p>
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
          const d = holder.get(v.id);
          return (
            <div key={v.id} className="panel live-list-row">
              <span className="live-list-icon">
                <Truck size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold text-strong">{prettyVehicle(v.number)}</p>
                <p className="text-xs text-muted">
                  {[v.owner_type ? VEHICLE_OWNER_LABEL[v.owner_type] : null, v.vehicle_type, v.transporter].filter(Boolean).join(" · ") || "-"}
                </p>
                {!showArchived ? (
                  <p className="text-xs text-ink">
                    {d ? (
                      <>
                        Driver: <Link href={`/live/drivers/${d.id}`} className="font-semibold text-brand-600">{d.name}</Link>
                      </>
                    ) : (
                      "No driver"
                    )}
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
