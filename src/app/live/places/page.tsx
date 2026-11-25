import Link from "next/link";
import { Building2, ExternalLink, MapPin, Pencil, Store, Warehouse } from "lucide-react";

import { ActionForm, ConfirmSubmitButton } from "@/components/ActionForm";
import { buttonClass } from "@/components/ui";
import { loadPlaces, requireLiveSession, safeReturn } from "@/lib/live/server";
import { PLACE_KINDS, PLACE_KIND_LABEL, mapsHref, type PlaceKind } from "@/lib/live/shared";
import { formatIndianMobile } from "@/lib/phone";

import { archivePlace } from "../actions";
import { BackLink } from "../BackLink";
import { PlaceForm } from "./PlaceForm";

export const metadata = { title: "Live tracking - Warehouses & places" };
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
  const defaultKind: PlaceKind = PLACE_KINDS.includes(sp.add as PlaceKind)
    ? (sp.add as PlaceKind)
    : places.some((p) => p.kind === "factory")
      ? "customer"
      : "factory";

  return (
    <div className="live-page mx-auto max-w-4xl space-y-3">
      <BackLink href={back ?? "/live/masters"} label={back ? "Back to trip" : "Masters"} />
      <header className="live-page-head">
        <div>
          <h1>Warehouses &amp; places</h1>
          <p>Our factories and godowns (picked as From / To on trips), plus saved customers.</p>
        </div>
      </header>

      <details className="panel live-form-block" open={Boolean(editing || sp.add || places.length === 0)} id="place-form">
        <summary className="live-h2 cursor-pointer">{editing ? `Edit ${editing.name}` : "+ Add a place"}</summary>
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
                {PLACE_KIND_LABEL[kind]} ({list.length})
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
                    <p className="truncate text-sm text-muted">
                      {[p.city, p.state].filter(Boolean).join(", ") || p.address || "No address"}
                      {p.contact_phone ? ` · ${formatIndianMobile(p.contact_phone)}` : ""}
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
                      <ConfirmSubmitButton message={`Remove ${p.name}? Old trips keep their history.`} variant="ghost">
                        Remove
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
