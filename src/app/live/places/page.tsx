import Link from "next/link";
import { Archive, Building2, ExternalLink, History, MapPin, Pencil, Phone, Plus, Store, Trash2, Warehouse } from "lucide-react";

import { ActionForm } from "@/components/ActionForm";
import { loadPlaces, requireLiveSession, safeReturn } from "@/lib/live/server";
import { mapsHref, siteTypeLabel, type PlaceKind } from "@/lib/live/shared";
import { formatIndianMobile } from "@/lib/phone";

import { archivePlace, deletePlace } from "../actions";
import { BackLink } from "../BackLink";
import { Sheet } from "../blocks";
import { IconSubmit } from "../ui";
import { PlaceForm } from "./PlaceForm";

export const metadata = { title: "Live tracking - Warehouses" };
export const dynamic = "force-dynamic";

const BASE = "/live/places";
const ICON: Record<PlaceKind, typeof MapPin> = { factory: Building2, warehouse: Warehouse, branch: Building2, customer: Store, other: MapPin };

/** Warehouses master (v5): compact rows, icon actions, add / edit in a sheet. */
export default async function PlacesPage({ searchParams }: { searchParams: Promise<{ add?: string; edit?: string; return?: string }> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const places = await loadPlaces(ownerId);
  const back = safeReturn(sp.return);
  const editing = sp.edit ? (places.find((p) => p.id === sp.edit) ?? null) : null;

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-mhead">
        <h1>Warehouses</h1>
        <span className="flex-1" />
        <Link href={`${BASE}?add=1${back ? `&return=${encodeURIComponent(back)}` : ""}`} className="live-ib live-ib-brand" aria-label="Add warehouse" title="Add warehouse" scroll={false}>
          <Plus size={16} />
        </Link>
      </header>

      <ul className="live-rows">
        {places.map((p) => {
          const Icon = ICON[p.kind] ?? MapPin;
          const pin = p.lat != null && p.lng != null ? mapsHref(p.lat, p.lng) : (p.maps_url ?? null);
          return (
            <li key={p.id} className="live-row">
              <span className="live-row-icon" aria-hidden>
                <Icon size={15} />
              </span>
              <div className="live-row-main">
                <strong>{p.name}</strong>
                <small>
                  {[siteTypeLabel(p), p.contact_name, p.address || p.city].filter(Boolean).join(" · ")}
                  {p.lat == null ? <span className="text-warn-500"> · no pin</span> : null}
                </small>
              </div>
              <div className="live-ibar">
                {p.contact_phone ? (
                  <a href={`tel:${p.contact_phone}`} className="live-ib" aria-label={`Call ${formatIndianMobile(p.contact_phone)}`} title={formatIndianMobile(p.contact_phone)}>
                    <Phone size={15} />
                  </a>
                ) : null}
                {pin ? (
                  <a href={pin} target="_blank" rel="noopener noreferrer" className="live-ib" aria-label="Open in Maps" title="Open in Maps">
                    <ExternalLink size={15} />
                  </a>
                ) : null}
                <Link href={`/live/history?place=${p.id}&range=all`} className="live-ib" aria-label="Trips" title="Trips">
                  <History size={15} />
                </Link>
                <Link href={`${BASE}?edit=${p.id}`} className="live-ib" aria-label={`Edit ${p.name}`} title="Edit" scroll={false}>
                  <Pencil size={15} />
                </Link>
                <ActionForm action={archivePlace} closeOnSuccess={false}>
                  <input type="hidden" name="id" value={p.id} />
                  <IconSubmit label="Archive" confirm={`Archive ${p.name}? It leaves the pickers; old trips keep it.`}>
                    <Archive size={15} />
                  </IconSubmit>
                </ActionForm>
                <ActionForm action={deletePlace} closeOnSuccess={false}>
                  <input type="hidden" name="id" value={p.id} />
                  <IconSubmit label="Delete" tone="bad" confirm={`Delete ${p.name} for good? Old trips keep its name and location. This cannot be undone.`}>
                    <Trash2 size={15} />
                  </IconSubmit>
                </ActionForm>
              </div>
            </li>
          );
        })}
        {places.length === 0 ? <li className="live-empty">No warehouses yet. Tap + to add one.</li> : null}
      </ul>
      <p className="text-xs text-faint">Picked as From / To on trips. A pin enables automatic arrive / leave and ETA.</p>

      {sp.add || editing ? (
        <Sheet title={editing ? `Edit ${editing.name}` : "Add warehouse"} closeHref={back && !editing ? back : BASE}>
          <PlaceForm key={editing?.id ?? "new"} place={editing} back={back} after={BASE} />
        </Sheet>
      ) : null}
    </div>
  );
}
