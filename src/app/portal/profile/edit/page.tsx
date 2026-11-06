import Link from "next/link";
import { ArrowLeft, KeyRound, UserRound } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { Field, FormActions, FormGrid, Input } from "@/components/form";
import { PhoneField } from "@/components/PhoneInput";
import { InfoTip } from "@/components/InfoTip";
import { DescRow, PageHeader, Panel } from "@/components/ui";
import { requirePortalSession } from "@/lib/officer";
import { publicSettings } from "@/components/SiteFooter";
import { fmtDate } from "@/lib/format";
import { updateMyProfile } from "../../settings/actions";
export const metadata = { title: "Edit profile — Rahdari" };
export default async function EditProfilePage() {
 const [{profile,email},{supportEmail}] = await Promise.all([requirePortalSession(),publicSettings()]);
 return <div className="account-workspace edit-profile-workspace"><Link href="/portal/profile" className="app-back-link"><ArrowLeft size={17}/>Profile</Link><PageHeader icon={<UserRound size={22}/>} title="Edit profile" subtitle="Your details, just the way you want them."/>
        <Panel id="profile" title="My profile" className="scroll-mt-20">
          <ActionForm action={updateMyProfile} closeOnSuccess={false}>
            <div className="space-y-4">
              <Field label="Full name" name="full_name">
                <Input
                  name="full_name"
                  required
                  maxLength={80}
                  defaultValue={profile.full_name ?? ""}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </Field>


              <PhoneField label="Mobile number" value={profile.phone} />


              <Disclosure
                title="Company and location"

                hint="Optional. Used when you call us."
                className="border-line/70 bg-raised/40 [box-shadow:none]"
                bodyClassName="border-t border-divider px-3 py-3.5"
              >
                <div className="space-y-4">
                  <FormGrid cols={2}>
                    <Field label="Job title" name="designation">
                      <Input
                        name="designation"
                        maxLength={60}
                        defaultValue={profile.designation ?? ""}
                        placeholder="Fleet manager"
                        autoComplete="organization-title"
                      />
                    </Field>
                    <Field label="Company or organisation" name="office">
                      <Input
                        name="office"
                        maxLength={120}
                        defaultValue={profile.office ?? ""}
                        placeholder="Patel Roadlines"
                        autoComplete="organization"
                      />
                    </Field>
                  </FormGrid>
                  <FormGrid cols={2}>
                    <Field label="City or district" name="district">
                      <Input
                        name="district"
                        maxLength={60}
                        defaultValue={profile.district ?? ""}
                        placeholder="Ahmedabad"
                        autoComplete="address-level2"
                      />
                    </Field>
                    <Field label="State" name="state">
                      <Input
                        name="state"
                        maxLength={60}
                        defaultValue={profile.state ?? ""}
                        placeholder="Gujarat"
                        autoComplete="address-level1"
                      />
                    </Field>
                  </FormGrid>
                </div>
              </Disclosure>
            </div>

            <FormActions>
              <SubmitButton>Save changes</SubmitButton>
            </FormActions>
          </ActionForm>


          <div className="mt-5 border-t border-divider pt-4">

            <InfoTip
              label="changing your sign-in email"
              info={
                <p>
                  Your email is how you sign in, so it is not changed from here.
                  {supportEmail ? (
                    <>
                      {" "}
                      Write to{" "}
                      <a href={`mailto:${supportEmail}`} className="text-brand-500 hover:underline">
                        {supportEmail}
                      </a>{" "}
                      to move the account to a new address.
                    </>
                  ) : (
                    " Contact support to move the account to a new address."
                  )}
                </p>
              }
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                <KeyRound size={12} />
                Sign-in
              </p>
            </InfoTip>
            <dl className="mt-2">
              <DescRow label="Email">
                <span className="break-all">{email}</span>
              </DescRow>
              <DescRow label="Password">
                <Link href="/forgot-password" className="font-medium text-brand-500 hover:underline">
                  Send me a reset link
                </Link>
              </DescRow>
              <DescRow label="Member since">{fmtDate(profile.created_at)}</DescRow>
            </dl>
          </div>
        </Panel></div>;
}
