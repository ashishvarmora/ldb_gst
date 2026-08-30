import { CheckCircle2, Send } from "lucide-react";

import { saveMyTelegram, testMyTelegram } from "./actions";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { Badge, DescRow, LinkButton, Mono, PageHeader, Panel, QuotaBar } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { env } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TelegramConfig } from "@/lib/types";

export const metadata = { title: "Settings — Truck Watch" };

export default async function PortalSettingsPage() {
  const { overview, email, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const { data: telegram } = await admin
    .from("telegram_configs")
    .select("*")
    .eq("user_id", overview.id)
    .maybeSingle<TelegramConfig>();

  const connected = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Where your alerts are delivered, and what your plan allows."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

          {!env.telegramBotToken ? (
            <p className="mt-3 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted">
              The platform bot is not set up yet, so test messages will fail. Your administrator
              needs to configure it.
            </p>
          ) : null}

          {/* Three steps most officers do once and never read again. */}
          <div className="mt-3">
            <Disclosure title="How do I find my chat id?">
              <ol className="space-y-2 text-xs leading-relaxed text-muted">
                <li className="flex gap-2">
                  <span className="font-mono text-brand-500">1.</span>
                  <span>
                    Open Telegram, find the department bot your administrator gave you, and send{" "}
                    <Mono className="text-ink">/start</Mono>. Telegram only lets a bot message you
                    after you have started it.
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
              <DescRow label="Office">{profile.office ?? "—"}</DescRow>
              <DescRow label="Account since">{fmtDateTime(profile.created_at)}</DescRow>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              These details are maintained by your administrator. To change your password or any of
              the above, contact them.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
