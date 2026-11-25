import Link from "next/link";
import { ChevronRight, Receipt, Truck, UserRound, Warehouse } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { SignOutButton } from "@/components/SignOutButton";
import { loadLiveProfile, loadPlaces, ownerLabelOf, requireLiveSession } from "@/lib/live/server";
import { BUSINESS_TYPE_LABEL, OWN_SITE_KINDS, type BusinessType } from "@/lib/live/shared";
import { indianMobileDigits } from "@/lib/phone";

import { saveLiveProfile } from "../actions";

export const metadata = { title: "Live tracking - Profile" };
export const dynamic = "force-dynamic";

/**
 * Profile: who you are (shown to drivers and customers on their links), the
 * defaults that shape every trip, notifications, and the way to the masters.
 * Login, plan and password stay in the Toll app's profile (same account).
 */
export default async function LiveProfilePage() {
  const live = await requireLiveSession();
  const [profile, places] = await Promise.all([loadLiveProfile(live.ownerId), loadPlaces(live.ownerId)]);
  const sites = places.filter((p) => OWN_SITE_KINDS.includes(p.kind));

  return (
    <div className="live-page mx-auto max-w-2xl space-y-4">
      <header className="live-page-head">
        <div>
          <h1>Profile</h1>
          <p>{live.session.email || ownerLabelOf(live.session)}</p>
        </div>
      </header>

      <ActionForm action={saveLiveProfile} closeOnSuccess={false} refresh={false} className="space-y-3">
        <section className="panel live-form-block">
          <h2>Business</h2>
          <p className="-mt-1 mb-3 text-xs text-muted">Drivers and customers see this name on their links.</p>
          <div className="live-form-grid">
            <Field label="Business / company name" name="business_name">
              <Input name="business_name" maxLength={120} defaultValue={profile.business_name ?? ownerLabelOf(live.session)} />
            </Field>
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
            <Field label="GSTIN" name="gstin" hint="Optional.">
              <Input name="gstin" maxLength={15} autoCapitalize="characters" defaultValue={profile.gstin ?? ""} className="font-mono uppercase" />
            </Field>
            <Field label="Contact person" name="contact_name">
              <Input name="contact_name" defaultValue={profile.contact_name ?? ""} />
            </Field>
            <Field label="Contact mobile" name="contact_phone">
              <Input name="contact_phone" inputMode="tel" defaultValue={indianMobileDigits(profile.contact_phone) ?? ""} />
            </Field>
            <Field label="Default warehouse" name="default_place_id" hint="Pre-filled as From on new trips.">
              <Select name="default_place_id" defaultValue={profile.default_place_id ?? ""}>
                <option value="">None</option>
                {sites.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section className="panel live-form-block">
          <h2>Sharing</h2>
          <Field
            label="One-time drivers: stop sharing after the trip by"
            name="one_time_expire_hours"
            hint="Dealer / supplier drivers. Own drivers share until they stop it themselves."
          >
            <Select name="one_time_expire_hours" defaultValue={String(profile.one_time_expire_hours)}>
              {[1, 2, 4, 8, 24].map((h) => (
                <option key={h} value={h}>
                  {h} hour{h === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
          </Field>
        </section>

        <section className="panel live-form-block">
          <h2>Notifications</h2>
          <p className="-mt-1 mb-2 text-xs text-muted">App push and Telegram (if set up in the Toll app). Never WhatsApp.</p>
          <label className="live-check">
            <input type="checkbox" name="notify_status" defaultChecked={profile.notify_status} className="size-4" />
            <span>
              <strong>Trip moves by the driver</strong>
              <small>Started, reached, delivered.</small>
            </span>
          </label>
          <label className="live-check">
            <input type="checkbox" name="notify_alerts" defaultChecked={profile.notify_alerts} className="size-4" />
            <span>
              <strong>Problems</strong>
              <small>Likely late, no GPS 30+ min, e-way bill expiring, long stop.</small>
            </span>
          </label>
        </section>

        <div className="live-form-actions">
          <SubmitButton className="w-full sm:w-auto">Save profile</SubmitButton>
        </div>
      </ActionForm>

      <nav className="live-menu" aria-label="Masters">
        {[
          { href: "/live/places", icon: Warehouse, title: "Warehouses & places" },
          { href: "/live/masters/trucks", icon: Truck, title: "Trucks" },
          { href: "/live/masters/drivers", icon: UserRound, title: "Drivers" },
        ].map((i) => (
          <Link key={i.href} href={i.href}>
            <span className="live-list-icon">
              <i.icon size={18} />
            </span>
            <strong className="flex-1">{i.title}</strong>
            <ChevronRight size={16} className="text-faint" />
          </Link>
        ))}
      </nav>

      <nav className="live-menu" aria-label="Account">
        <Link href="/portal/profile">
          <span className="live-list-icon">
            <Receipt size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <strong>Account, plan and login</strong>
            <small>In the Toll tracking app (same account)</small>
          </span>
          <ChevronRight size={16} className="text-faint" />
        </Link>
      </nav>
      <div className="pb-2 lg:hidden">
        <SignOutButton variant="ghost" className="w-full" />
      </div>
    </div>
  );
}
