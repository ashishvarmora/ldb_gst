import Link from "next/link";
import { Archive, Building2, ExternalLink, MapPin, Pencil, Store, Trash2, Warehouse } from "lucide-react";

import { ActionForm, ConfirmSubmitButton } from "@/components/ActionForm";
import { buttonClass } from "@/components/ui";
import { loadPlaces, requireLiveSession, safeReturn } from "@/lib/live/server";
import { PLACE_KINDS, PLACE_KIND_LABEL, customFieldsOf, mapsHref, type PlaceKind } from "@/lib/live/shared";
import { formatIndianMobile } from "@/lib/phone";

import { archivePlace, deletePlace } from "../actions";
import { BackLink } from "../BackLink";
import { PlaceForm } from "./PlaceForm";

export const metadata = { title: "Live tracking - Warehouses" };
export const dynamic = "force-dynamic";

const ICON: Record<PlaceKind, typeof MapPin> = {
  factory: Building2,
  warehouse: Warehouse,
  branch: Building2,
  customer: Store,
  other: MapPin,
};

export default async function PlacesPage({ searchParams }: { searchParams: Promise<{ add?: string; edit?: string; return?: string }> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const places = await loadPlaces(ownerId);
  const back = safeReturn(sp.return);
  const editing = sp.edit ? places.find((p) => p.id === sp.edit) ?? null : null;
  const defaultKind: PlaceKind = PLACE_KINDS.includes(sp.add as PlaceKind) ? (sp.add as PlaceKind) : "warehouse";

  return (
    <div className="live-page mx-auto max-w-4xl space-y-3">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-page-head">
        <div>
          <h1>Warehouses</h1>
          <p>Our factories, godowns and branches - picked as From / To on trips. Customer places are typed on the trip, not saved here.</p>
        </div>
      </header>

      <details className="panel live-form-block" open={Boolean(editing || sp.add || places.length === 0)} id="place-form">
        <summary className="live-h2 cursor-pointer">{editing ? `Edit ${editing.name}` : "+ Add a warehouse"}</summary>
        <div className="mt-3">
          <PlaceForm key={editing?.id ?? `new-${defaultKind}`} place={editing} defaultKind={defaultKind} back={back} />
          {editing ? (
            <Link href="/live/places" className="mt-2 inline-block text-sm text-muted">
              Cancel edit
            </Link>
          ) : null}
        </div>
      </details>

      {PLACE_KINDS.map((kind) => {
        const list = places.filter((p) => p.kind === kind);
        if (!list.length) return null;
        const Icon = ICON[kind];
        return (
          <section key={kind}>
            <h2 className="live-section-title">
              <span>
                {kind === "customer" || kind === "other" ? `Older saved places: ${PLACE_KIND_LABEL[kind]}` : PLACE_KIND_LABEL[kind]} ({list.length})
              </span>
            </h2>
            <ul className="live-list">
              {list.map((p) => (
                <li key={p.id} className="panel live-list-row">
                  <span className="live-list-icon">
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-strong">{p.name}</p>
                    <p className="truncate text-xs text-muted">
                      {p.address || [p.city, p.state].filter(Boolean).join(", ") || "No address"}
                      {p.contact_phone ? ` · ${formatIndianMobile(p.contact_phone)}` : ""}
                      {customFieldsOf(p.custom_fields).map(([k, x]) => ` · ${k}: ${x}`).join("")}
                    </p>
                    <p className="text-xs text-muted">
                      {p.lat != null && p.lng != null ? (
                        <a href={mapsHref(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-600">
                          <ExternalLink size={11} /> On map · {p.radius_m} m geofence
                        </a>
                      ) : (
                        <span className="text-warn-500">No location - add it for auto arrive/leave</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                    <Link href={`/live/places?edit=${p.id}#place-form`} className={buttonClass("ghost", "sm")} aria-label={`Edit ${p.name}`}>
                      <Pencil size={14} />
                    </Link>
                    <ActionForm action={archivePlace} closeOnSuccess={false}>
                      <input type="hidden" name="id" value={p.id} />
                      <ConfirmSubmitButton message={`Archive ${p.name}? It leaves the pickers; old trips keep it.`} variant="ghost">
                        <Archive size={14} />
                      </ConfirmSubmitButton>
                    </ActionForm>
                    <ActionForm action={deletePlace} closeOnSuccess={false}>
                      <input type="hidden" name="id" value={p.id} />
                      <ConfirmSubmitButton message={`Delete ${p.name} for good? Old trips keep its name and location. This cannot be undone.`} variant="ghost">
                        <Trash2 size={14} />
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
