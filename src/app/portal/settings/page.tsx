import { LegacyProfileRedirect } from "@/components/LegacyProfileRedirect";
import { Settings as PageIcon } from "lucide-react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  Send,
} from "lucide-react";

import { CopyAddress } from "./CopyAddress";
import { PushSetup } from "./PushSetup";
import { saveMySheet, saveMyTelegram, saveMyWhatsApp, testMyTelegram, testMyWhatsApp } from "./actions";
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
import { formatIndianMobile } from "@/lib/phone";
import { whatsappConfigured } from "@/lib/whatsapp";

type WhatsAppConfig = {
  phone: string;
  is_enabled: boolean;
  verified_at: string | null;
  last_error: string | null;
};

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Settings — ${brandName}` };
}


export default async function PortalSettingsPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const waReady = whatsappConfigured();
  const [{ supportEmail }, { data: telegram }, { data: sheet }, { count: pushDevices }, { data: whatsapp }, { data: me }] =
    await Promise.all([
      publicSettings(),
      admin
        .from("telegram_configs")
        .select("*")
        .eq("user_id", overview.id)
        .maybeSingle<TelegramConfig>(),
      admin
        .from("google_sheet_configs")
        .select("*")
        .eq("user_id", overview.id)
        .maybeSingle<GoogleSheetConfig>(),

      admin
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", overview.id),
      // Before migration 0067 this errors and data is null: the form still shows.
      waReady
        ? admin
            .from("whatsapp_configs")
            .select("phone, is_enabled, verified_at, last_error")
            .eq("user_id", overview.id)
            .maybeSingle<WhatsAppConfig>()
        : Promise.resolve({ data: null }),
      admin.from("profiles").select("phone").eq("id", overview.id).maybeSingle<{ phone: string | null }>(),
    ]);

  const waOn = Boolean(whatsapp?.phone) && (whatsapp?.is_enabled ?? false);
  const waNumber = whatsapp?.phone ?? me?.phone ?? "";

  const connected = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);

  const sheetId = sheet?.spreadsheet_id ?? null;
  const sheetOn = Boolean(sheetId) && (sheet?.is_enabled ?? false);

  const sheetsReady = integrationHealth().googleSheets && Boolean(env.googleServiceAccountEmail);

  return (
    <div className="account-workspace settings-workspace"><LegacyProfileRedirect/>

      <PageHeader
        icon={<PageIcon size={22} strokeWidth={2} />}
        title="Settings"
        subtitle="Manage notifications, connections and your history backup."
      />


      <div className="settings-sections grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">




        <AppDownload signedIn className="lg:col-span-2" />

        <Panel id="alerts" title="Alerts" className="scroll-mt-20">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Send size={12} />
            Telegram
          </p>


          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              {connected ? (
                <Badge tone="good">
                  <CheckCircle2 size={10} />
                  connected
                </Badge>
              ) : (
                <Badge tone="warn">not connected</Badge>
              )}

              <span className="min-w-0 text-xs leading-relaxed">
                {telegram?.last_error ? (
                  <span className="text-bad-500">{friendlyError(telegram.last_error)}</span>
                ) : telegram?.verified_at ? (
                  <span className="text-good-500">
                    Last verified {fmtRelative(telegram.verified_at)}.
                  </span>
                ) : (

                  <span className="text-faint">Not verified yet.</span>
                )}
              </span>
            </span>

            <InlineActionForm action={testMyTelegram} className="shrink-0">
              <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                <Send size={13} />
                Send test
              </SubmitButton>
            </InlineActionForm>
          </div>

          {!env.telegramBotToken ? (

            <p className="mb-4 text-xs leading-relaxed text-warn-500">
              Telegram alerts are temporarily unavailable, so a test will not be delivered.
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
          ) : null}

          <ActionForm action={saveMyTelegram} closeOnSuccess={false}>
            <div className="space-y-4">

              <div>
                <Field label="Chat ID" name="chat_id">
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
            </div>
            <FormActions>
              <SubmitButton>Save</SubmitButton>
            </FormActions>
          </ActionForm>


          <HelpNote title="Telegram alerts do not reach me" className="mt-4">
            <p>
              Telegram alerts arrive as <strong className="text-ink">Telegram messages</strong>, so
              Telegram itself must be allowed to notify you. For app notifications, see{" "}
              <strong className="text-ink">Notifications on this phone</strong> below.
            </p>

            <p className="mt-2">Check these in order:</p>
            <ol className="mt-1.5 space-y-1.5">
              {[
                <>
                  Telegram is installed and signed in on <em>that</em> phone.
                </>,
                <>
                  Telegram&apos;s own notifications are on in the phone&apos;s Settings — on an
                  iPhone, Settings &rsaquo; Notifications &rsaquo; Telegram.
                </>,
                <>The chat ID above is saved.</>,

                <>
                  You pressed <strong className="text-ink">Start</strong> on{" "}
                  <a
                    href={ALERT_BOT_START_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium break-all text-brand-500 hover:underline"
                  >
                    t.me/{ALERT_BOT_USERNAME}
                    <ExternalLink size={11} className="shrink-0" />
                  </a>
                  . Telegram only lets the bot message you after you send it{" "}
                  <Mono className="text-[11px]">/start</Mono>.
                </>,
                <>
                  <strong className="text-ink">Send test</strong> above shows connected.
                </>,
              ].map((step, index) => (
                <li key={index} className="flex gap-2">
                  <span className="font-mono text-brand-500">{index + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2">
              The bell at the top of the screen also lists your alerts inside the app.
            </p>
          </HelpNote>


          <PushSetup
            platformReady={integrationHealth().webPush}
            appReady={integrationHealth().fcm}
            savedDevices={pushDevices ?? 0}
            supportEmail={supportEmail}
          />


          {waReady ? (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                <MessageCircle size={12} />
                WhatsApp
              </p>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  {waOn ? (
                    <Badge tone="good">
                      <CheckCircle2 size={10} />
                      on
                    </Badge>
                  ) : (
                    <Badge tone="warn">off</Badge>
                  )}
                  <span className="min-w-0 text-xs leading-relaxed">
                    {whatsapp?.last_error ? (
                      <span className="text-bad-500">{whatsapp.last_error}</span>
                    ) : whatsapp?.verified_at ? (
                      <span className="text-good-500">Last verified {fmtRelative(whatsapp.verified_at)}.</span>
                    ) : (
                      <span className="text-faint">Alerts come from Rahdari, +91 92134 34855.</span>
                    )}
                  </span>
                </span>
                {waOn ? (
                  <InlineActionForm action={testMyWhatsApp} className="shrink-0">
                    <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                      <Send size={13} />
                      Send test
                    </SubmitButton>
                  </InlineActionForm>
                ) : null}
              </div>
              <ActionForm action={saveMyWhatsApp} closeOnSuccess={false}>
                <div className="space-y-3">
                  <Field label="WhatsApp number" name="whatsapp_phone">
                    <Input
                      name="whatsapp_phone"
                      defaultValue={waNumber ? formatIndianMobile(waNumber) : ""}
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="e.g. 98765 43210"
                    />
                  </Field>
                  <Checkbox
                    name="opt_in"
                    label="Send my truck alerts on WhatsApp"
                    hint="You can turn this off at any time."
                    defaultChecked={waOn || !whatsapp}
                  />
                </div>
                <FormActions>
                  <SubmitButton>Save</SubmitButton>
                </FormActions>
              </ActionForm>
            </div>
          ) : (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
                <MessageCircle size={14} className="shrink-0 text-faint" />
                WhatsApp alerts
              </span>
              <Badge tone="neutral">coming soon</Badge>
            </div>
          )}
        </Panel>






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
