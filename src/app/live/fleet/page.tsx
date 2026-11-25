import Link from "next/link";
import { Pencil, Truck, UserRound } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { buttonClass, cx } from "@/components/ui";
import { loadDrivers, loadVehicles, requireLiveSession } from "@/lib/live/server";
import { prettyVehicle } from "@/lib/live/shared";
import { formatIndianMobile, indianMobileDigits } from "@/lib/phone";

import { archiveDriver, archiveVehicle, saveDriver, saveVehicle } from "../actions";

export const metadata = { title: "Live tracking - Fleet" };
export const dynamic = "force-dynamic";

/**
 * Drivers and vehicles. Trips create them on the fly (find-or-create by
 * number / mobile), so this page is for tidying up and for regulars.
 */
export default async function FleetPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "drivers" ? "drivers" : "vehicles";
  const { ownerId } = await requireLiveSession();
  const [vehicles, drivers] = await Promise.all([loadVehicles(ownerId), loadDrivers(ownerId)]);
  const editV = tab === "vehicles" && sp.edit ? vehicles.find((v) => v.id === sp.edit) ?? null : null;
  const editD = tab === "drivers" && sp.edit ? drivers.find((d) => d.id === sp.edit) ?? null : null;

  return (
    <div className="live-page mx-auto max-w-4xl space-y-4">
      <header className="live-page-head">
        <div>
          <h1>Fleet</h1>
          <p>Vehicles and drivers. New ones are saved automatically when you create a trip.</p>
        </div>
      </header>

      <nav className="live-tabs" aria-label="Fleet">
        <Link href="/live/fleet" aria-current={tab === "vehicles" ? "page" : undefined}>
          Vehicles ({vehicles.length})
        </Link>
        <Link href="/live/fleet?tab=drivers" aria-current={tab === "drivers" ? "page" : undefined}>
          Drivers ({drivers.length})
        </Link>
      </nav>

      {tab === "vehicles" ? (
        <>
          <details className="panel live-form-block" open={Boolean(editV) || vehicles.length === 0} id="fleet-form">
            <summary className="live-h2 cursor-pointer">{editV ? `Edit ${prettyVehicle(editV.number)}` : "+ Add a vehicle"}</summary>
            <ActionForm key={editV?.id ?? "new"} action={saveVehicle} closeOnSuccess={false} resetOnSuccess={!editV} className="mt-3 space-y-3">
              {editV ? <input type="hidden" name="id" value={editV.id} /> : null}
              <div className="live-form-grid">
                <Field label="Vehicle number" name="number" required>
                  <Input name="number" required defaultValue={editV?.number} placeholder="GJ36X1234" className="font-mono uppercase" autoCapitalize="characters" />
                </Field>
                <Field label="Truck is" name="ownership">
                  <Select name="ownership" defaultValue={editV?.ownership ?? "market"}>
                    <option value="market">Market / hired</option>
                    <option value="own">Our own</option>
                  </Select>
                </Field>
                <Field label="Type" name="vehicle_type">
                  <Input name="vehicle_type" list="live-vtypes" defaultValue={editV?.vehicle_type ?? ""} />
                </Field>
                <datalist id="live-vtypes">
                  {["10 wheel", "12 wheel", "14 wheel", "Trailer", "Container", "Tempo / LCV"].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <Field label="Transporter" name="transporter">
                  <Input name="transporter" defaultValue={editV?.transporter ?? ""} />
                </Field>
                <Field label="Capacity (kg)" name="capacity_kg">
                  <Input name="capacity_kg" inputMode="numeric" defaultValue={editV?.capacity_kg ?? ""} />
                </Field>
              </div>
              <SubmitButton className="w-full sm:w-auto">{editV ? "Save vehicle" : "Add vehicle"}</SubmitButton>
            </ActionForm>
          </details>
          <ul className="live-list">
            {vehicles.map((v) => (
              <li key={v.id} className="panel live-list-row">
                <span className="live-list-icon">
                  <Truck size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-semibold text-strong">{prettyVehicle(v.number)}</p>
                  <p className="truncate text-sm text-muted">
                    {[v.ownership === "own" ? "Own" : "Market", v.vehicle_type, v.transporter, v.capacity_kg ? `${v.capacity_kg} kg` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Link href={`/live/trips?status=all&q=${v.number}`} className={buttonClass("ghost", "sm")}>
                  Trips
                </Link>
                <Link href={`/live/fleet?edit=${v.id}#fleet-form`} className={buttonClass("ghost", "sm")} aria-label="Edit">
                  <Pencil size={14} />
                </Link>
                <ActionForm action={archiveVehicle} closeOnSuccess={false}>
                  <input type="hidden" name="id" value={v.id} />
                  <ConfirmSubmitButton variant="ghost" message={`Remove ${prettyVehicle(v.number)} from the list? Trips keep it.`}>
                    Remove
                  </ConfirmSubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <details className="panel live-form-block" open={Boolean(editD) || drivers.length === 0} id="fleet-form">
            <summary className="live-h2 cursor-pointer">{editD ? `Edit ${editD.name}` : "+ Add a driver"}</summary>
            <ActionForm key={editD?.id ?? "new"} action={saveDriver} closeOnSuccess={false} resetOnSuccess={!editD} className="mt-3 space-y-3">
              {editD ? <input type="hidden" name="id" value={editD.id} /> : null}
              <div className="live-form-grid">
                <Field label="Name" name="name" required>
                  <Input name="name" required defaultValue={editD?.name} />
                </Field>
                <Field label="Mobile" name="phone" hint="Tracking links go here on WhatsApp.">
                  <Input name="phone" inputMode="tel" defaultValue={indianMobileDigits(editD?.phone) ?? ""} placeholder="98765 43210" />
                </Field>
                <Field label="Licence no." name="license_no">
                  <Input name="license_no" defaultValue={editD?.license_no ?? ""} />
                </Field>
              </div>
              <SubmitButton className="w-full sm:w-auto">{editD ? "Save driver" : "Add driver"}</SubmitButton>
            </ActionForm>
          </details>
          <ul className="live-list">
            {drivers.map((d) => (
              <li key={d.id} className="panel live-list-row">
                <span className="live-list-icon">
                  <UserRound size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-strong">{d.name}</p>
                  <p className={cx("truncate text-sm", d.phone ? "text-muted" : "text-warn-500")}>
                    {d.phone ? formatIndianMobile(d.phone) : "No mobile"}
                    {d.consent_at ? " · has shared location before" : ""}
                  </p>
                </div>
                {d.phone ? (
                  <a href={`tel:${d.phone}`} className={buttonClass("ghost", "sm")}>
                    Call
                  </a>
                ) : null}
                <Link href={`/live/fleet?tab=drivers&edit=${d.id}#fleet-form`} className={buttonClass("ghost", "sm")} aria-label="Edit">
                  <Pencil size={14} />
                </Link>
                <ActionForm action={archiveDriver} closeOnSuccess={false}>
                  <input type="hidden" name="id" value={d.id} />
                  <ConfirmSubmitButton variant="ghost" message={`Remove ${d.name} from the list?`}>
                    Remove
                  </ConfirmSubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
