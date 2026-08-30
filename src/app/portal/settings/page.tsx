import { CheckCircle2, MessageCircle, Send, Sheet, XCircle } from "lucide-react";

import { saveMySheet, saveMyTelegram, testMySheet, testMyTelegram } from "./actions";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import { Badge, DescRow, LinkButton, Mono, PageHeader, Panel, QuotaBar } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { env } from "@/lib/env";
import { fmtDateTime, fmtRelative, istDaysAgo } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { GoogleSheetConfig, TelegramConfig, UsageCounter } from "@/lib/types";

export const metadata = { title: "Settings — Truck Watch" };

export default async function PortalSettingsPage() {
  const { overview, email, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: telegram }, { data: sheet }, { data: usage }] = await Promise.all([
    admin.from("telegram_configs").select("*").eq("user_id", overview.id).maybeSingle<TelegramConfig>(),
    admin
      .from("google_sheet_configs")
      .select("*")
      .eq("user_id", overview.id)
      .maybeSingle<GoogleSheetConfig>(),
    admin
      .from("usage_counters")
      .select("*")
      .eq("user_id", overview.id)
      .gte("usage_date", istDaysAgo(29)),
  ]);

  const series = buildUsageSeries((usage ?? []) as UsageCounter[], 30);
  const telegramConnected = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);
  const sheetConnected = Boolean(sheet?.spreadsheet_id) && (sheet?.is_enabled ?? false);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Where your alerts are delivered, where your long-term copy of the crossings is kept, and what your plan allows."
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* ------------------------------------------------------------ */}
          <Panel
            title="Telegram alerts"
            description="The only place an alert reaches you outside the app. Set this up once and every truck alert lands on your phone."
            actions={
              telegramConnected ? (
                <Badge tone="good">
                  <CheckCircle2 size={10} />
                  connected
                </Badge>
              ) : (
                <Badge tone="warn">not connected</Badge>
              )
            }
          >
            {!overview.telegram_enabled ? (
              <p className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-sm text-warn-500">
                Telegram alerts are not enabled on your plan. Ask your administrator to switch them
                on.
              </p>
            ) : (
              <>
                <ol className="mb-4 space-y-2 text-xs leading-relaxed text-muted">
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-400">1.</span>
                    <span>
                      Open Telegram, find the department bot your administrator gave you, and send{" "}
                      <Mono className="text-ink">/start</Mono>. Telegram only lets a bot message
                      you after you have started it, so this step is required.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-400">2.</span>
                    <span>
                      Find your numeric chat id: search <Mono className="text-ink">@userinfobot</Mono>{" "}
                      in Telegram and send it <Mono className="text-ink">/start</Mono>. It replies
                      with your <strong className="text-ink">Id</strong> — a plain number.
                      Your administrator can also read it for you.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-400">3.</span>
                    <span>
                      Paste that number below, save, then send a test message. If it arrives, every
                      alert will arrive the same way.
                    </span>
                  </li>
                </ol>

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
                        placeholder="123456789"
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
                      <p className="text-good-500">
                        Last verified {fmtRelative(telegram.verified_at)}
                      </p>
                    ) : (
                      <p className="text-faint">Not verified yet</p>
                    )}
                    {telegram?.last_error ? (
                      <p className="mt-0.5 max-w-xs text-bad-500">{telegram.last_error}</p>
                    ) : null}
                  </div>
                </div>

                {!env.telegramBotToken ? (
                  <p className="mt-3 rounded-lg border border-line bg-panel/60 px-3 py-2 text-xs text-muted">
                    The platform bot is not configured yet, so test messages will fail. Your
                    administrator needs to set it up.
                  </p>
                ) : null}
              </>
            )}
          </Panel>

          {/* ------------------------------------------------------------ */}
          <Panel
            title="Google Sheet"
            description="A location log of every toll crossing, written into your own sheet and kept for after retention trims the app's copy."
            actions={
              sheetConnected ? (
                <Badge tone="good">
                  <CheckCircle2 size={10} />
                  connected
                </Badge>
              ) : (
                <Badge tone="warn">not connected</Badge>
              )
            }
          >
            {!overview.google_sheet_enabled ? (
              <p className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-sm text-warn-500">
                Google Sheet sync is not enabled on your plan. Ask your administrator to switch it
                on.
              </p>
            ) : (
              <>
                <ol className="mb-4 space-y-2 text-xs leading-relaxed text-muted">
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-400">1.</span>
                    <span>Create a blank Google Sheet in your own Drive.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-400">2.</span>
                    <span>
                      Share it as <strong className="text-ink">Editor</strong> with
                      {env.googleServiceAccountEmail ? (
                        <>
                          {" "}
                          <Mono className="break-all text-ink">
                            {env.googleServiceAccountEmail}
                          </Mono>
                        </>
                      ) : (
                        " the service account address your administrator gives you"
                      )}
                      .
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-mono text-brand-400">3.</span>
                    <span>Paste the sheet link below. The tab is created automatically.</span>
                  </li>
                </ol>

                <ActionForm action={saveMySheet} closeOnSuccess={false}>
                  <div className="space-y-4">
                    <Field label="Google Sheet link" name="sheet_url">
                      <Input
                        name="sheet_url"
                        defaultValue={sheet?.sheet_url ?? ""}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                      />
                    </Field>
                    <Checkbox
                      name="is_enabled"
                      label="Mirror my data into this sheet"
                      defaultChecked={sheet?.is_enabled ?? true}
                    />
                  </div>
                  <FormActions>
                    <SubmitButton>Save</SubmitButton>
                  </FormActions>
                </ActionForm>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
                  <InlineActionForm action={testMySheet}>
                    <SubmitButton variant="secondary" size="sm" pendingLabel="Checking...">
                      <Sheet size={13} />
                      Test connection
                    </SubmitButton>
                  </InlineActionForm>

                  <div className="text-right text-xs">
                    {sheet?.last_synced_at ? (
                      <p className="text-good-500">Last synced {fmtRelative(sheet.last_synced_at)}</p>
                    ) : (
                      <p className="text-faint">Never synced</p>
                    )}
                    {sheet?.last_error ? (
                      <p className="mt-0.5 max-w-xs text-bad-500">{sheet.last_error}</p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-line bg-panel/60 px-3 py-2.5">
                  <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                    What lands in the sheet
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    One tab, <Mono className="text-ink">Truck Events</Mono>: time, truck, toll
                    plaza, coordinates and direction for every crossing. Alerts and searches stay in
                    the app, where you can filter them — mirroring those here only made the sheet
                    harder to read as a location log.
                  </p>
                </div>
              </>
            )}
          </Panel>

          {/* ------------------------------------------------------------ */}
          <Panel
            title="Your usage, last 30 days"
            description="Manual searches and background checks per day."
          >
            <UsageChart series={series} />
          </Panel>
        </div>

        {/* -------------------------------------------------------------- */}
        <div className="space-y-5">
          <Panel title="My plan">
            {overview.plan_name ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <Badge tone="brand">{overview.plan_name}</Badge>
                  {overview.plan_expires_on ? (
                    <span className="text-xs text-muted">
                      expires {overview.plan_expires_on}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs text-muted">Tracked trucks</p>
                    <QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />
                  </div>
                </div>
                <dl className="mt-4 border-t border-divider pt-3">
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
                  <DescRow label="Case folders">{formatLimit(overview.max_truck_groups)}</DescRow>
                  <DescRow label="Truck alerts">
                    {overview.alerts_enabled ? (
                      <span className="inline-flex items-center gap-1 text-good-500">
                        <CheckCircle2 size={12} />
                        allowed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <XCircle size={12} />
                        blocked
                      </span>
                    )}
                  </DescRow>
                  <DescRow label="Telegram">
                    {overview.telegram_enabled ? (
                      <span className="inline-flex items-center gap-1 text-good-500">
                        <CheckCircle2 size={12} />
                        allowed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <XCircle size={12} />
                        blocked
                      </span>
                    )}
                  </DescRow>
                  <DescRow label="Google Sheet">
                    {overview.google_sheet_enabled ? (
                      <span className="inline-flex items-center gap-1 text-good-500">
                        <CheckCircle2 size={12} />
                        allowed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <XCircle size={12} />
                        blocked
                      </span>
                    )}
                  </DescRow>
                </dl>
                <p className="mt-3 text-[11px] leading-relaxed text-faint">
                  Limits and credits are set by your administrator. Ask them if you need more.
                </p>
                <div className="mt-3">
                  <LinkButton href="/portal/plan" size="sm" variant="secondary">
                    See my plan and credits
                  </LinkButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-bad-500">
                No plan is assigned to your account yet, so searching and tracking are blocked. Ask
                your administrator to assign one.
              </p>
            )}
          </Panel>

          <Panel title="My account">
            <dl>
              <DescRow label="Name">{profile.full_name ?? "—"}</DescRow>
              <DescRow label="Email">
                <span className="break-all">{email}</span>
              </DescRow>
              <DescRow label="Designation">{profile.designation ?? "—"}</DescRow>
              <DescRow label="Office">{profile.office ?? "—"}</DescRow>
              <DescRow label="District">
                {[profile.district, profile.state].filter(Boolean).join(", ") || "—"}
              </DescRow>
              <DescRow label="Account since">{fmtDateTime(profile.created_at)}</DescRow>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              These details are maintained by your administrator. To change your password or any of
              the above, contact them.
            </p>
          </Panel>

          <Panel title="How alerts reach you">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <MessageCircle size={13} className="mt-0.5 shrink-0 text-brand-400" />
              A truck is only checked when one of its alerts is due, and you set those up on the
              truck&apos;s own page under Trucks. When an alert fires it is recorded in the app —
              the bell in the header — and pushed to Telegram straight away. Without Telegram the
              alert is still recorded, you just have to open the app to see it.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
