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
import { Disclosure, HelpNote } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, FormGrid, Input } from "@/components/form";
import { InfoTip } from "@/components/InfoTip";
import { PhoneField } from "@/components/PhoneInput";
import { publicSettings } from "@/components/SiteFooter";
import { TelegramChatIdHelp } from "@/components/TelegramChatIdInfo";
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
 *
 * And nothing on it explains itself any more. Every panel here had grown a
 * description under its title and a hint under its inputs, all of it read once
 * and then scrolled past for ever, and on a phone it doubled the page. What is
 * left is the three forms, the state of each connection, and two dropdowns for
 * the two things nobody can do without being told how - getting a chat id, and
 * sharing a sheet. The rule for the rest: a detail somebody might want goes
 * behind an (i), and anything that only restated a label or reassured is gone.
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
      {/* No subtitle: it listed the three sections, which the jump row below
          and the three panel titles already are. */}
      <PageHeader title="Settings" />

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

                <FormGrid cols={2}>
                  {/* Was a free-text 20-character box that accepted a
                      landline, a five-digit number and a foreign number - none
                      of which sign-up allows, so one account could hold a
                      format another refused. Same field as every other form
                      now, and compulsory: this is the number we ring when
                      somebody cannot get into their account, which is exactly
                      when they cannot use the app to tell us a better one.

                      That reason no longer sits under the box, though, so
                      PhoneField's own "10 digits, no country code" comes back:
                      why we want the number is read once at sign-up, and the
                      format is what is wanted at the moment of typing. */}
                  <PhoneField label="Mobile number" value={profile.phone} />
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
              {/*
                An (i) and not a dropdown, deliberately: moving your account to
                a new address is a detail one reader in a hundred wants, not a
                task this screen is asking anybody to do. The line used to sit
                open under the rows, where it read as an apology for the one
                field that has no box.
              */}
              <InfoTip
                label="changing your sign-in email"
                info={
                  <p>
                    Your email is how you sign in, so it is not changed from here.
                    {supportEmail ? (
                      <>
                        {" "}
                        Write to{" "}
                        <a
                          href={`mailto:${supportEmail}`}
                          className="text-brand-500 hover:underline"
                        >
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
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
                  <KeyRound size={12} />
                  Sign-in
                </p>
              </InfoTip>
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
            </div>
          </Panel>
        </div>

        <div className="space-y-4 lg:order-1">
          {/* ================= where alerts go ================= */}
          {/* No description: it said Telegram is the only channel, which the
              "coming soon" row at the foot of this panel says better. */}
          <Panel
            id="alerts"
            title="Telegram alerts"
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
                {/*
                  The steps were behind an (i) beside this label, and on the
                  live page people did not find them - which is fatal here,
                  because nobody has a chat id until these three steps give
                  them one. A dropdown labelled with the question is a thing a
                  reader can see is there; an (i) is a thing you have to
                  already know about. See TelegramChatIdHelp.

                  The old hint under the box is gone with it: "a plain number"
                  is step 2, and "your phone number is never used" was
                  reassurance about a field nobody had filled in yet.
                */}
                <div>
                  <Field label="Chat id" name="chat_id">
                    <Input
                      name="chat_id"
                      defaultValue={telegram?.chat_id ?? ""}
                      inputMode="numeric"
                      placeholder="e.g. 123456789"
                      className="font-mono"
                    />
                  </Field>
                  <TelegramChatIdHelp className="mt-1.5" />
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
                  /* State, not instruction: the button that fixes it is on
                     this row, so the second half of this line was telling
                     somebody to press what their thumb is already on. */
                  <span className="text-faint">Not verified yet.</span>
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
          {/* The description - why anybody would want a copy - moved into the
              "What ends up in the sheet?" dropdown at the foot of this panel,
              which is where somebody weighing it up is already looking. */}
          <Panel
            id="backup"
            title="Backup to your Google Sheet"
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
              {/*
                "as Editor" is in the heading rather than in the dropdown with
                the rest of the steps: it is the one requirement that fails
                silently - a sheet shared as Viewer looks shared and takes no
                rows - so it stays where it cannot be missed. How to do the
                sharing is a task, and tasks go behind a labelled dropdown,
                the same call as the chat id above.
              */}
              <p className="text-xs font-semibold text-ink">
                1. Share your sheet with this address as <strong>Editor</strong>
              </p>

              {sheetsReady ? (
                <>
                  <div className="mt-2.5">
                    <CopyAddress address={env.googleServiceAccountEmail} />
                  </div>
                  <HelpNote title="How do I share it?" className="mt-1.5">
                    In your sheet tap <strong className="text-ink">Share</strong>, paste this
                    address in, set it to <strong className="text-ink">Editor</strong> and send.
                    Anything less and rows cannot be added.
                  </HelpNote>
                </>
              ) : (
                /* Ours to fix, not the reader's. */
                <p className="mt-1 text-xs leading-relaxed text-warn-500">
                  Copying to sheets is not switched on yet, so nothing is being written to any
                  sheet.
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
                {/* Hint gone: "blank is a fine answer" reassured somebody
                    about a box that is not marked required and refuses
                    nothing. */}
                <Field label="2. Paste the link to your sheet" name="sheet_url">
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
                /* One line, but it keeps the one thing to go and check: the
                   sharing is the cause nine times in ten. */
                <span className="text-bad-500">
                  Last copy failed — {friendlyError(sheet.last_error)} Check it is still shared as
                  Editor.
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
                or removed, so anything you write there yourself is safe. The app clears its own
                records in time; your sheet keeps them.
              </p>
            </Disclosure>
          </Panel>
        </div>
      </div>
    </>
  );
}
