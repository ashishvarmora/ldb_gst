import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { PageHeader } from "@/components/ui";
import { saveLiveProfile } from "@/app/live/actions";
import { liveSchema84, loadLiveProfile, loadPlaces, ownerLabelOf, requireLiveSession } from "@/lib/live/server";

import { BackLink } from "../../BackLink";
import { BUSINESS_TYPE_LABEL, OWN_SITE_KINDS, type BusinessType } from "@/lib/live/shared";
import { indianMobileDigits } from "@/lib/phone";

export const metadata = { title: "Live tracking - Business settings" };
export const dynamic = "force-dynamic";

/**
 * Live profile > Business settings (v5: moved from /portal/profile/live).
 * Sections are an accordion (one open at a time, v4); less-used fields sit under "View more".
 */
export default async function LiveSettingsPage() {
  const live = await requireLiveSession();
  if (!live.enabled) redirect("/live");
  const [profile, places, has84] = await Promise.all([loadLiveProfile(live.ownerId), loadPlaces(live.ownerId), liveSchema84()]);
  const sites = places.filter((p) => OWN_SITE_KINDS.includes(p.kind));

  const sec = "panel overflow-hidden";
  const sum = "flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-strong";
  const body = "space-y-3 border-t border-divider px-4 py-3";

  return (
    <div className="account-workspace space-y-3">
      <BackLink href="/live/profile" label="Profile" />
      <PageHeader icon={<Building2 size={20} />} title="Business settings" subtitle="Business details, trip defaults and the customer page." />

      <ActionForm action={saveLiveProfile} closeOnSuccess={false} refresh={false} className="space-y-3">
        <details className={sec} name="live-settings" open>
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

        <details className={sec} name="live-settings">
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
              label="Temporary driver's link stops after the trip by"
              name="one_time_expire_hours"
              hint="Drivers typed on a trip (not from masters). Reopening the trip before then keeps the link; after it the temporary driver is removed. Your own drivers share until they stop."
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

        <details className={sec} name="live-settings">
          <summary className={sum}>
            Customer page <span className="text-xs font-normal text-muted">what /track links show</span>
          </summary>
          <div className={body}>
            {has84 ? (
              <>
                <input type="hidden" name="track_present" value="1" />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="track_show_driver" defaultChecked={profile.track_show_driver !== false} className="mt-0.5 size-4" />
                  <span>
                    <strong className="block text-strong">Show driver name</strong>
                    <small className="text-xs text-muted">First name only.</small>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="track_call_driver" defaultChecked={profile.track_call_driver === true} className="mt-0.5 size-4" />
                  <span>
                    <strong className="block text-strong">Show a Call driver button</strong>
                    <small className="text-xs text-muted">Off by default: the customer then calls you, not the driver.</small>
                  </span>
                </label>
              </>
            ) : (
              <p className="text-xs text-muted">Needs database update 0084.</p>
            )}
            <p className="text-xs text-muted">Never shown: invoice value, freight, e-way bill, notes, activity.</p>
          </div>
        </details>

        <SubmitButton className="w-full sm:w-auto">Save</SubmitButton>
      </ActionForm>

    </div>
  );
}
