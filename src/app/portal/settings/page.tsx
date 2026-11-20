import { LegacyProfileRedirect } from "@/components/LegacyProfileRedirect";
import { Settings as PageIcon } from "lucide-react";
import Link from "next/link";
import {
  BellRing,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  Send,
} from "lucide-react";

import { CopyAddress } from "./CopyAddress";
import { saveMySheet } from "./actions";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { AppDownload } from "@/components/AppDownload";
import { Disclosure, HelpNote } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { InfoTip } from "@/components/InfoTip";
import { publicSettings } from "@/components/SiteFooter";
import { TelegramChatIdHelp } from "@/components/TelegramChatIdInfo";
import { Badge, Mono, PageHeader, Panel } from "@/components/ui";
import { env, integrationHealth } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { SHEET_TABS } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ALERT_BOT_START_URL, ALERT_BOT_USERNAME } from "@/lib/telegram-bot";
import type { GoogleSheetConfig, TelegramConfig } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Settings — ${brandName}` };
}


export default async function PortalSettingsPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ supportEmail }, { data: sheet }] = await Promise.all([
    publicSettings(),
    admin
      .from("google_sheet_configs")
      .select("*")
      .eq("user_id", overview.id)
      .maybeSingle<GoogleSheetConfig>(),
  ]);

  const sheetId = sheet?.spreadsheet_id ?? null;
  const sheetOn = Boolean(sheetId) && (sheet?.is_enabled ?? false);

  const sheetsReady = integrationHealth().googleSheets && Boolean(env.googleServiceAccountEmail);

  return (
    <div className="account-workspace settings-workspace"><LegacyProfileRedirect/>

      <PageHeader
        icon={<PageIcon size={22} strokeWidth={2} />}
        title="Settings"
        subtitle="App download and your history backup."
      />


      <div className="settings-sections grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">




        <AppDownload signedIn className="lg:col-span-2" />

        {/* Alerts moved to Notifications (/portal/notifications). */}
        <Link href="/portal/notifications" className="panel flex items-center justify-between gap-3 px-4 py-3.5 text-sm">
          <span className="flex items-center gap-2 font-semibold text-ink"><BellRing size={16} />Notifications</span>
          <span className="text-xs text-muted">App, WhatsApp and Telegram alerts →</span>
        </Link>






        <div id="backup" className="scroll-mt-20 lg:col-span-2">

          <Disclosure
            title="Backup to your Google Sheet"
            defaultOpen={Boolean(sheet?.last_error)}
            badge={

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
            hint={
              sheet?.last_error ? (

                <span className="text-bad-500">
                  Last copy failed — {friendlyError(sheet.last_error)} Check it is still shared as
                  Editor.
                </span>
              ) : sheet?.last_synced_at ? (
                <>Last copied {fmtRelative(sheet.last_synced_at)}.</>
              ) : sheetId ? (

                <>No backup yet. Backups run on a schedule, not when you save.</>
              ) : (
                <>Keep your own copy of every record, in a sheet you own.</>
              )
            }
          >

            <div className="rounded-xl border border-line bg-raised px-3 py-3">

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
                    Rows cannot be added with any lower access.
                  </HelpNote>
                </>
              ) : (

                <p className="mt-1 text-xs leading-relaxed text-warn-500">
                  Sheet backup is temporarily unavailable, so nothing is being written to any
                  sheet.
                  {supportEmail ? (
                    <>
                      {" "}
                      For help, contact{" "}
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

            <Disclosure
              title="What ends up in the sheet?"
              hint="One tab per kind of record."
              className="mt-4 border-line/70 bg-raised/40 [box-shadow:none]"
              bodyClassName="border-t border-divider px-3 py-3.5"
            >

              <ul className="grid grid-cols-1 gap-1.5 text-xs text-muted sm:grid-cols-2">
                {Object.values(SHEET_TABS).map((tab) => (
                  <li key={tab} className="flex items-center gap-1.5">
                    <span aria-hidden className="size-1 shrink-0 rounded-full bg-brand-500/60" />
                    {tab}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">
                Rows are only added to the end of a tab. Nothing in your sheet is read, changed or
                removed, so anything you add yourself is safe. Your sheet keeps a permanent copy.
              </p>
            </Disclosure>
          </Disclosure>
        </div>
      </div>
    </div>
  );
}
