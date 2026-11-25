import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, Navigation } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { PageHeader } from "@/components/ui";
import { saveLiveProfile } from "@/app/live/actions";
import { loadLiveProfile, loadPlaces, ownerLabelOf, requireLiveSession } from "@/lib/live/server";
import { BUSINESS_TYPE_LABEL, OWN_SITE_KINDS, type BusinessType } from "@/lib/live/shared";
import { indianMobileDigits } from "@/lib/phone";

export const metadata = { title: "Live tracking settings — Rahdari" };
export const dynamic = "force-dynamic";

/**
 * Live tracking section of the COMMON profile (0082). One account, one
 * profile for Toll and Live; this page holds only Live's business settings.
 * Sections fold (details/summary); the less-used fields sit under "View more".
 */
export default async function LiveSettingsPage() {
  const live = await requireLiveSession();
  if (!live.enabled) redirect("/live");
  const [profile, places] = await Promise.all([loadLiveProfile(live.ownerId), loadPlaces(live.ownerId)]);
  const sites = places.filter((p) => OWN_SITE_KINDS.includes(p.kind));

  const sec = "panel overflow-hidden";
  const sum = "flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-strong";
  const body = "space-y-3 border-t border-divider px-4 py-3";

  return (
    <div className="account-workspace space-y-3">
      <Link href="/portal/profile" className="app-back-link">
        <ArrowLeft size={17} />
        Profile
      </Link>
      <PageHeader icon={<Navigation size={20} />} title="Live tracking" subtitle="Business details and trip defaults for Live tracking." />

      <ActionForm action={saveLiveProfile} closeOnSuccess={false} refresh={false} className="space-y-3">
        <details className={sec} open>
          <summary className={sum}>
            Business <span className="text-xs font-normal text-muted">shown to drivers and customers</span>
          </summary>
          <div className={body}>
            <Field label="Business / company name" name="business_name">
              <Input name="business_name" maxLength={120} defaultValue={profile.business_name ?? ownerLabelOf(live.session)} />
            </Field>
            <Field label="GSTIN" name="gstin" hint="Optional.">
              <Input name="gstin" maxLength={15} autoCapitalize="characters" defaultValue={profile.gstin ?? ""} className="font-mono uppercase" />
            </Field>
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-brand-600">View more</summary>
              <div className="mt-3 space-y-3">
                <Field label="Business type" name="business_type">
                  <Select name="business_type" defaultValue={profile.business_type ?? ""}>
                    <option value="">Not set</option>
                    {(Object.keys(BUSINESS_TYPE_LABEL) as BusinessType[]).map((b) => (
                      <option key={b} value={b}>
                        {BUSINESS_TYPE_LABEL[b]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Contact person" name="contact_name">
                  <Input name="contact_name" defaultValue={profile.contact_name ?? ""} />
                </Field>
                <Field label="Contact mobile" name="contact_phone">
                  <Input name="contact_phone" inputMode="tel" defaultValue={indianMobileDigits(profile.contact_phone) ?? ""} />
                </Field>
              </div>
            </details>
          </div>
        </details>

        <details className={sec} open>
          <summary className={sum}>Trips</summary>
          <div className={body}>
            <Field label="Default warehouse" name="default_place_id" hint="Pre-filled as From when sending, and as To when receiving.">
              <Select name="default_place_id" defaultValue={profile.default_place_id ?? ""}>
                <option value="">None</option>
                {sites.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Receiving trips: driver's link stops after the trip by"
              name="one_time_expire_hours"
              hint="Supplier drivers typed on a receiving trip. Your own drivers share until they stop."
            >
              <Select name="one_time_expire_hours" defaultValue={String(profile.one_time_expire_hours)}>
                {[1, 2, 4, 8, 24].map((h) => (
                  <option key={h} value={h}>
                    {h} hour{h === 1 ? "" : "s"}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </details>

        <details className={sec}>
          <summary className={sum}>
            Notifications <span className="text-xs font-normal text-muted">app and Telegram</span>
          </summary>
          <div className={body}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="notify_status" defaultChecked={profile.notify_status} className="mt-0.5 size-4" />
              <span>
                <strong className="block text-strong">Trip moves by the driver</strong>
                <small className="text-xs text-muted">Started, reached, delivered.</small>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="notify_alerts" defaultChecked={profile.notify_alerts} className="mt-0.5 size-4" />
              <span>
                <strong className="block text-strong">Problems</strong>
                <small className="text-xs text-muted">Likely late, no GPS 30+ min, e-way bill expiring, long stop.</small>
              </span>
            </label>
          </div>
        </details>

        <SubmitButton className="w-full sm:w-auto">Save</SubmitButton>
      </ActionForm>

      <nav className="app-menu-list" aria-label="Live tracking">
        {[
          { href: "/live/masters", title: "Masters", detail: "Drivers, trucks, warehouses" },
          { href: "/live/trips", title: "Open Live tracking", detail: "Your trips" },
        ].map((i) => (
          <Link key={i.href} href={i.href}>
            <span>
              <strong>{i.title}</strong>
              <small>{i.detail}</small>
            </span>
            <ChevronRight size={17} />
          </Link>
        ))}
      </nav>
    </div>
  );
}
