import Link from "next/link";
import { CheckCircle2, ExternalLink, History, Send } from "lucide-react";

import { CopyAddress } from "./CopyAddress";
import { saveMySheet, saveMyTelegram, testMyTelegram } from "./actions";
import { InviteCard } from "../referrals/InviteCard";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { publicSettings } from "@/components/SiteFooter";
import { Badge, DescRow, LinkButton, Mono, PageHeader, Panel, QuotaBar } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { env, integrationHealth } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { SHEET_TABS } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { GoogleSheetConfig, TelegramConfig } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Settings — ${brandName}` };
}

export default async function PortalSettingsPage() {
  const { overview, email, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ brandName, supportEmail, referralEnabled }, { data: telegram }, { data: sheet }] =
    await Promise.all([
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
      <PageHeader
        title="Settings"
        subtitle="Where your alerts are delivered, where your history is kept, and what your plan allows."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {/* ---------------------------------------------------------------- */}
          <Panel
            title="Telegram alerts"
            description="The only place an alert reaches you outside the app."
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
                <Field
                  label="Chat id"
                  name="chat_id"
                  hint="A plain number. Your phone number is never used."
                >
                  <Input
                    name="chat_id"
                    defaultValue={telegram?.chat_id ?? ""}
                    inputMode="numeric"
                    placeholder="e.g. 123456789"
                    className="font-mono"
                  />
                </Field>
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

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
              <InlineActionForm action={testMyTelegram}>
                <SubmitButton variant="secondary" size="sm" pendingLabel="Sending...">
                  <Send size={13} />
                  Send test message
                </SubmitButton>
              </InlineActionForm>

              <div className="text-right text-xs">
                {telegram?.verified_at ? (
                  <p className="text-good-500">Last verified {fmtRelative(telegram.verified_at)}</p>
                ) : (
                  <p className="text-faint">Not verified yet</p>
                )}
                {telegram?.last_error ? (
                  <p className="mt-0.5 max-w-xs text-bad-500">
                    {friendlyError(telegram.last_error)}
                  </p>
                ) : null}
              </div>
            </div>

            {/* A missing bot token is ours to fix, not the reader's, so this says
                what it means for them and where to ask - never who to chase. */}
            {!env.telegramBotToken ? (
              <p className="mt-3 rounded-lg border border-line bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
                Telegram delivery is not switched on yet, so test messages will fail.
                {supportEmail ? (
                  <>
                    {" "}
                    Let us know at{" "}
                    <a href={`mailto:${supportEmail}`} className="text-brand-500 hover:underline">
                      {supportEmail}
                    </a>{" "}
                    if you need it.
                  </>
                ) : null}
              </p>
            ) : null}

            {/* Three steps most people do once and never read again. */}
            <div className="mt-3">
              <Disclosure title="How do I find my chat id?">
                <ol className="space-y-2 text-xs leading-relaxed text-muted">
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-500">1.</span>
                    <span>
                      Open Telegram and send <Mono className="text-ink">/start</Mono> to the{" "}
                      {brandName} alerts bot. Telegram only lets a bot message you after you have
                      started it.
                      {supportEmail ? (
                        <>
                          {" "}
                          Not sure which bot? Ask{" "}
                          <a href={`mailto:${supportEmail}`} className="text-brand-500 hover:underline">
                            {supportEmail}
                          </a>
                          .
                        </>
                      ) : null}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-500">2.</span>
                    <span>
                      Search <Mono className="text-ink">@userinfobot</Mono> and send it{" "}
                      <Mono className="text-ink">/start</Mono>. It replies with your{" "}
                      <strong className="text-ink">Id</strong> — a plain number.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-500">3.</span>
                    <span>Paste that number above, save, then send a test message.</span>
                  </li>
                </ol>
              </Disclosure>
            </div>
          </Panel>

          {/* ---------------------------------------------------------------- */}
          <Panel
            title="Your Google Sheet"
            description="The long-term copy of your history, in a sheet you own."
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
            <p className="text-sm leading-relaxed text-muted">
              Your searches and credit movements are cleared out of the app after a while, so it
              stays quick to use. Every row is written to a Google Sheet before that happens, which
              makes the sheet the copy that lasts.{" "}
              <Link
                href="/portal/activity"
                className="inline-flex items-center gap-1 font-medium text-brand-500 hover:underline"
              >
                <History size={12} />
                Your activity page
              </Link>{" "}
              shows what is still in the app.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Name your own sheet below and that copy is yours to open whenever you like. Leave it
              blank and the copy is written to the sheet {brandName} keeps instead — nothing is ever
              deleted uncopied either way, but you would not be able to open it yourself.
            </p>

            {/* Nothing can be written to a sheet that was never shared, so the
                address comes before the box asking for the link. */}
            <div className="mt-4 rounded-xl border border-line bg-raised px-3 py-3">
              <p className="text-xs font-semibold text-ink">
                1. Share your sheet with this address
              </p>
              <p className="mt-0.5 mb-2.5 text-xs leading-relaxed text-muted">
                In your sheet, tap <strong className="text-ink">Share</strong>, paste this address
                in, and set it to <strong className="text-ink">Editor</strong>. Anything less and
                rows cannot be added. It is not a person — it only ever appends to the end of a tab.
              </p>

              {sheetsReady ? (
                <CopyAddress address={env.googleServiceAccountEmail} />
              ) : (
                /* Ours to fix, not the reader's, so this says what it means for
                   them and where to ask - never who to chase. */
                <p className="rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-muted">
                  Copying to sheets is not switched on yet, so there is no address to share with and
                  nothing is being written to any sheet.
                  {supportEmail ? (
                    <>
                      {" "}
                      Let us know at{" "}
                      <a href={`mailto:${supportEmail}`} className="text-brand-500 hover:underline">
                        {supportEmail}
                      </a>{" "}
                      if you need it.
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
                  hint="Blank is a fine answer — it means you would rather not keep a sheet of your own."
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
                  hint="Switched off, your sheet is left untouched and the copy is kept on our side instead."
                  defaultChecked={sheet?.is_enabled ?? true}
                />
              </div>
              <FormActions>
                <SubmitButton>Save</SubmitButton>
              </FormActions>
            </ActionForm>

            {sheet?.last_error ? (
              <p className="mt-4 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2.5 text-xs leading-relaxed text-bad-500">
                The last copy into your sheet did not go through, so nothing has been added since.{" "}
                {friendlyError(sheet.last_error)} Check the sheet still exists and is shared as
                Editor with the address above, then save again.
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4 text-xs">
              {sheetId ? (
                <p className="text-muted">
                  {sheet?.last_synced_at ? (
                    <>Last copied {fmtRelative(sheet.last_synced_at)}</>
                  ) : (
                    /* Not a fault: copying runs on a schedule, so a sheet
                       named this morning has nothing in it yet. */
                    <>Nothing copied across yet — it runs on a schedule, not on save.</>
                  )}
                </p>
              ) : (
                <p className="text-faint">No sheet of your own yet.</p>
              )}

              {sheet?.sheet_url ? (
                <a
                  href={sheet.sheet_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-9 items-center gap-1.5 font-medium text-brand-500 hover:underline"
                >
                  Open my sheet
                  <ExternalLink size={12} />
                </a>
              ) : null}
            </div>

            <div className="mt-3">
              <Disclosure title="What ends up in the sheet?" hint="One tab per kind of record.">
                {/* Straight from the exporter, so this list cannot promise a
                    tab that is never written. */}
                <ul className="grid grid-cols-1 gap-1.5 text-xs text-muted sm:grid-cols-2">
                  {Object.values(SHEET_TABS).map((tab) => (
                    <li key={tab} className="flex items-center gap-1.5">
                      <span aria-hidden className="size-1 shrink-0 rounded-full bg-brand-500/60" />
                      {tab}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-xs leading-relaxed text-muted">
                  Rows are only ever added to the end of a tab. Nothing in your sheet is read,
                  changed or removed, so anything you write there yourself is safe.
                </p>
              </Disclosure>
            </div>
          </Panel>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="space-y-4">
          <Panel title="My plan">
            {overview.plan_name ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{overview.plan_name}</Badge>
                  {overview.plan_expires_on ? (
                    <span className="text-xs text-muted">expires {overview.plan_expires_on}</span>
                  ) : null}
                </div>

                <QuotaBar
                  used={overview.active_trucks}
                  limit={overview.truck_limit}
                  label="Trucks under tracking"
                />

                <dl className="mt-4 border-t border-divider pt-2">
                  <DescRow label="Credits left">
                    <span className="font-medium tabular-nums">
                      {formatCredits(overview.credits)}
                    </span>
                  </DescRow>
                  <DescRow label="Spent this month">
                    <span className="tabular-nums">
                      {formatCredits(overview.credits_spent_month)}
                    </span>
                  </DescRow>
                </dl>

                <div className="mt-3">
                  <LinkButton href="/portal/plan" size="sm" variant="secondary">
                    See my plan and credits
                  </LinkButton>
                </div>
              </>
            ) : (
              /* Plans are bought, not handed out, so this is a next step with a
                 button on it rather than a refusal in red. */
              <>
                <p className="text-sm leading-relaxed text-muted">
                  You have not chosen a plan yet. A plan sets how many trucks you can keep under
                  tracking and puts the first credits on your balance.
                </p>
                <div className="mt-3">
                  <LinkButton href="/portal/plan" size="sm" variant="primary">
                    See the plans
                  </LinkButton>
                </div>
              </>
            )}
          </Panel>

          {/* The settings gear is on every screen, so this is the way onto the
              referral page from anywhere on a phone. */}
          {referralEnabled ? <InviteCard /> : null}

          <Panel title="My account">
            <dl>
              <DescRow label="Name">{profile.full_name ?? "—"}</DescRow>
              <DescRow label="Email">
                <span className="break-all">{email}</span>
              </DescRow>
              {/* profile.office is the stored column; "Organisation" is simply
                  what it is called on screen now. */}
              <DescRow label="Organisation">{profile.office ?? "—"}</DescRow>
              <DescRow label="Account since">{fmtDateTime(profile.created_at)}</DescRow>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              To change your password, use{" "}
              <Link href="/forgot-password" className="text-brand-500 hover:underline">
                the reset link
              </Link>{" "}
              on the sign-in page.
              {supportEmail ? (
                <>
                  {" "}
                  For anything else, write to{" "}
                  <a href={`mailto:${supportEmail}`} className="text-brand-500 hover:underline">
                    {supportEmail}
                  </a>
                  .
                </>
              ) : null}
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
