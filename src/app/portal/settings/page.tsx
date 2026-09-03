import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MessageCircle,
  Send,
  Sheet,
  User,
} from "lucide-react";

import { CopyAddress } from "./CopyAddress";
import { saveMySheet, saveMyTelegram, testMyTelegram, updateMyProfile } from "./actions";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, FormGrid, Input } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import { PhoneField } from "@/components/PhoneInput";
import { publicSettings } from "@/components/SiteFooter";
import { TelegramChatIdInfo } from "@/components/TelegramChatIdInfo";
import { Badge, DescRow, PageHeader, Panel } from "@/components/ui";
import { env, integrationHealth } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtDate, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { SHEET_TABS } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { GoogleSheetConfig, TelegramConfig } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Settings — ${brandName}` };
}

/** The three sections, for the jump row a phone reads before it scrolls. */
const SECTIONS = [
  { href: "#profile", label: "Profile", icon: User },
  { href: "#alerts", label: "Alerts", icon: Bell },
  { href: "#backup", label: "Backup", icon: Sheet },
] as const;

/**
 * Three things and nothing else: who you are, where alerts go, and where your
 * history is kept.
 *
 * What used to be here as well: a copy of the plan panel, a copy of the
 * referral card, and a read-only list of details with no way to change them.
 * The first two are one tap away in the profile menu, on every screen, and the
 * third is now the form at the top. A settings page that restates other pages
 * is a page whose numbers can disagree with them.
 */
export default async function PortalSettingsPage() {
  const { overview, email, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ supportEmail }, { data: telegram }, { data: sheet }] = await Promise.all([
    publicSettings(),
    admin.from("telegram_configs").select("*").eq("user_id", overview.id).maybeSingle<TelegramConfig>(),
    admin
      .from("google_sheet_configs")
      .select("*")
      .eq("user_id", overview.id)
      .maybeSingle<GoogleSheetConfig>(),
  ]);

  const connected = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);

  const sheetId = sheet?.spreadsheet_id ?? null;
  const sheetOn = Boolean(sheetId) && (sheet?.is_enabled ?? false);
  /**
   * Whether copying to sheets works at all. Without it there is no address to
   * share and nothing is written anywhere, which is worth saying rather than
   * showing a form that quietly does nothing.
   */
  const sheetsReady = integrationHealth().googleSheets && Boolean(env.googleServiceAccountEmail);

  return (
    <>
      <PageHeader title="Settings" subtitle="Your details, where alerts reach you, and where your history is kept." />

      {/* Three sections is a long scroll on a phone and a short one everywhere
          else, so the jump row is a phone-only affordance. */}
      <nav aria-label="Sections" className="mb-4 flex gap-2 lg:hidden">
        {SECTIONS.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel text-xs font-medium text-muted transition active:bg-sunken"
          >
            <Icon size={13} />
            {label}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {/* ================= who you are ================= */}
        <div className="lg:order-2">
          <Panel
            id="profile"
            title="My profile"
            description="How your account is named on screen and in anything we send you."
            className="scroll-mt-20"
          >
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

                <FormGrid cols={2}>
                  {/* Was a free-text 20-character box that accepted a
                      landline, a five-digit number and a foreign number - none
                      of which sign-up allows, so one account could hold a
                      format another refused. Same field as every other form
                      now, and compulsory: this is the number we ring when
                      somebody cannot get into their account, which is exactly
                      when they cannot use the app to tell us a better one. */}
                  <PhoneField
                    label="Mobile number"
                    hint="How we reach you if something goes wrong with your account."
                    value={profile.phone}
                  />
                  <Field label="Job title" name="designation">
                    <Input
                      name="designation"
                      maxLength={60}
                      defaultValue={profile.designation ?? ""}
                      placeholder="Fleet manager"
                      autoComplete="organization-title"
                    />
                  </Field>
                </FormGrid>

                <Field label="Company or organisation" name="office">
                  <Input
                    name="office"
                    maxLength={120}
                    defaultValue={profile.office ?? ""}
                    placeholder="Patel Roadlines"
                    autoComplete="organization"
                  />
                </Field>

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

              <FormActions>
                <SubmitButton>Save changes</SubmitButton>
              </FormActions>
            </ActionForm>

            {/*
              Sign-in sits inside the profile panel rather than in one of its
              own: it is the same subject, and the reason it is read-only is
              only clear next to the boxes that are not.
            */}
            <div className="mt-5 border-t border-divider pt-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
                <KeyRound size={12} />
                Sign-in
              </p>
              <dl className="mt-2">
                <DescRow label="Email">
                  <span className="break-all">{email}</span>
                </DescRow>
                <DescRow label="Password">
                  <Link
                    href="/forgot-password"
                    className="font-medium text-brand-500 hover:underline"
                  >
                    Send me a reset link
                  </Link>
                </DescRow>
                <DescRow label="Member since">{fmtDate(profile.created_at)}</DescRow>
              </dl>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">
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
            </div>
          </Panel>
        </div>

        <div className="space-y-4 lg:order-1">
          {/* ================= where alerts go ================= */}
          <Panel
            id="alerts"
            title="Telegram alerts"
            description="The only place an alert reaches you outside the app."
            className="scroll-mt-20"
            actions={
              connected ? (
                <Badge tone="good">
                  <CheckCircle2 size={10} />
                  connected
                </Badge>
              ) : (
                <Badge tone="warn">not connected</Badge>
              )
            }
          >
            <ActionForm action={saveMyTelegram} closeOnSuccess={false}>
              <div className="space-y-4">
                {/* The steps used to be a Disclosure under the whole panel,
                    which put the answer three rows below the question and left
                    a heading of prose on screen for everyone who already knew.
                    Behind the (i) beside the field it is in reach of the box it
                    describes, and invisible until asked for. */}
                <div>
                  <LabelWithInfo
                    label="Chat id"
                    htmlFor="chat_id"
                    info={<TelegramChatIdInfo />}
                  />
                  <Input
                    id="chat_id"
                    name="chat_id"
                    defaultValue={telegram?.chat_id ?? ""}
                    inputMode="numeric"
                    placeholder="e.g. 123456789"
                    className="mt-1.5 font-mono"
                  />
                  <p className="field-hint">A plain number. Your phone number is never used.</p>
                </div>
                <Checkbox
                  name="is_enabled"
                  label="Send me alerts on Telegram"
                  defaultChecked={telegram?.is_enabled ?? true}
                />
              </div>
              <FormActions>
                <SubmitButton>Save</SubmitButton>
              </FormActions>
            </ActionForm>

            {/* The button and what it last reported, on one row. Three stacked
                notes used to say this, two of them usually empty. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <InlineActionForm action={testMyTelegram} className="items-start">
                <SubmitButton variant="secondary" size="sm" pendingLabel="Sending...">
                  <Send size={13} />
                  Send test
                </SubmitButton>
              </InlineActionForm>

              <p className="min-w-0 flex-1 text-xs leading-relaxed">
                {telegram?.last_error ? (
                  <span className="text-bad-500">{friendlyError(telegram.last_error)}</span>
                ) : telegram?.verified_at ? (
                  <span className="text-good-500">
                    Last verified {fmtRelative(telegram.verified_at)}.
                  </span>
                ) : (
                  <span className="text-faint">
                    Not verified yet — save your chat id, then send a test.
                  </span>
                )}
                {!env.telegramBotToken ? (
                  /* Ours to fix, not the reader's, so this says what it means
                     for them and where to ask - never who to chase. */
                  <span className="mt-1 block text-warn-500">
                    Telegram delivery is not switched on yet, so a test will fail.
                    {supportEmail ? (
                      <>
                        {" "}
                        Let us know at{" "}
                        <a href={`mailto:${supportEmail}`} className="underline">
                          {supportEmail}
                        </a>
                        .
                      </>
                    ) : null}
                  </span>
                ) : null}
              </p>
            </div>

            {/*
              The second channel, visible and unusable.
              It is built and switched off - there is no WhatsApp account behind
              it yet - and saying so is better than either hiding it, which
              turns "can I get these on WhatsApp?" into a support email, or
              offering a switch that silently sends nothing.
            */}
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
                <MessageCircle size={14} className="shrink-0 text-faint" />
                WhatsApp alerts
              </span>
              <Badge tone="neutral">coming soon</Badge>
            </div>
          </Panel>

          {/* ================= where history is kept ================= */}
          <Panel
            id="backup"
            title="Backup to your Google Sheet"
            description="Your own copy of every row, before the app clears its own."
            className="scroll-mt-20"
            actions={
              /* A sheet that stopped working is the whole reason this badge is
                 here - it is the only place the failure is visible. */
              sheet?.last_error ? (
                <Badge tone="bad">not working</Badge>
              ) : sheetOn ? (
                <Badge tone="good">
                  <CheckCircle2 size={10} />
                  connected
                </Badge>
              ) : (
                <Badge tone="neutral">not set</Badge>
              )
            }
          >
            {/* Nothing can be written to a sheet that was never shared, so the
                address comes before the box asking for the link. */}
            <div className="rounded-xl border border-line bg-raised px-3 py-3">
              <p className="text-xs font-semibold text-ink">1. Share your sheet with this address</p>
              <p className="mt-0.5 mb-2.5 text-xs leading-relaxed text-muted">
                In your sheet tap <strong className="text-ink">Share</strong>, paste this in and set
                it to <strong className="text-ink">Editor</strong>. Anything less and rows cannot be
                added.
              </p>

              {sheetsReady ? (
                <CopyAddress address={env.googleServiceAccountEmail} />
              ) : (
                /* Ours to fix, not the reader's. */
                <p className="text-xs leading-relaxed text-warn-500">
                  Copying to sheets is not switched on yet, so there is no address to share and
                  nothing is being written to any sheet.
                  {supportEmail ? (
                    <>
                      {" "}
                      Let us know at{" "}
                      <a href={`mailto:${supportEmail}`} className="underline">
                        {supportEmail}
                      </a>
                      .
                    </>
                  ) : null}
                </p>
              )}
            </div>

            <ActionForm action={saveMySheet} closeOnSuccess={false} className="mt-4">
              <div className="space-y-4">
                <Field
                  label="2. Paste the link to your sheet"
                  name="sheet_url"
                  hint="Blank is a fine answer — the copy is kept on our side instead."
                >
                  <Input
                    name="sheet_url"
                    // Not type="url": a bare sheet id is accepted too, and the
                    // browser would refuse to submit one.
                    inputMode="url"
                    defaultValue={sheet?.sheet_url ?? ""}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="font-mono text-xs"
                  />
                </Field>
                <Checkbox
                  name="is_enabled"
                  label="Copy my history to this sheet"
                  defaultChecked={sheet?.is_enabled ?? true}
                />
              </div>
              <FormActions>
                {sheet?.sheet_url ? (
                  <a
                    href={sheet.sheet_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mr-auto inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-brand-500 hover:underline"
                  >
                    Open my sheet
                    <ExternalLink size={12} />
                  </a>
                ) : null}
                <SubmitButton>Save</SubmitButton>
              </FormActions>
            </ActionForm>

            <p className="mt-3 text-xs leading-relaxed">
              {sheet?.last_error ? (
                <span className="text-bad-500">
                  The last copy did not go through, so nothing has been added since.{" "}
                  {friendlyError(sheet.last_error)} Check the sheet still exists and is shared as
                  Editor with the address above, then save again.
                </span>
              ) : sheet?.last_synced_at ? (
                <span className="text-muted">Last copied {fmtRelative(sheet.last_synced_at)}.</span>
              ) : sheetId ? (
                /* Not a fault: copying runs on a schedule, so a sheet named
                   this morning has nothing in it yet. */
                <span className="text-muted">
                  Nothing copied across yet — it runs on a schedule, not on save.
                </span>
              ) : (
                <span className="text-faint">No sheet of your own yet.</span>
              )}
            </p>

            <Disclosure title="What ends up in the sheet?" hint="One tab per kind of record." className="mt-4">
              {/* Straight from the exporter, so this list cannot promise a tab
                  that is never written. */}
              <ul className="grid grid-cols-1 gap-1.5 text-xs text-muted sm:grid-cols-2">
                {Object.values(SHEET_TABS).map((tab) => (
                  <li key={tab} className="flex items-center gap-1.5">
                    <span aria-hidden className="size-1 shrink-0 rounded-full bg-brand-500/60" />
                    {tab}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">
                Rows are only ever added to the end of a tab. Nothing in your sheet is read, changed
                or removed, so anything you write there yourself is safe.
              </p>
            </Disclosure>
          </Panel>
        </div>
      </div>
    </>
  );
}
