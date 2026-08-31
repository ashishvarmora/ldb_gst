import Link from "next/link";
import { CheckCircle2, Send } from "lucide-react";

import { saveMyTelegram, testMyTelegram } from "./actions";
import { InviteCard } from "../referrals/InviteCard";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { publicSettings } from "@/components/SiteFooter";
import { Badge, DescRow, LinkButton, Mono, PageHeader, Panel, QuotaBar } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { env } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TelegramConfig } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Settings — ${brandName}` };
}

export default async function PortalSettingsPage() {
  const { overview, email, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ brandName, supportEmail, referralEnabled }, { data: telegram }] = await Promise.all([
    publicSettings(),
    admin.from("telegram_configs").select("*").eq("user_id", overview.id).maybeSingle<TelegramConfig>(),
  ]);

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
