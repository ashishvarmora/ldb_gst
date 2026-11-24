import Link from "next/link";
import { ArrowLeft, BellRing, ChevronDown, MessageCircle, Send, Smartphone } from "lucide-react";
import type { ReactNode } from "react";

import { saveMyTelegram, saveMyWhatsApp, testMyPushAction, testMyTelegram, testMyWhatsApp } from "../settings/actions";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, Input } from "@/components/form";
import { InfoTip } from "@/components/InfoTip";
import { publicSettings } from "@/components/SiteFooter";
import { TelegramChatIdHelp } from "@/components/TelegramChatIdInfo";
import { PageHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { formatIndianMobile } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TelegramConfig } from "@/lib/types";
import { WHATSAPP_ALERTS_SCOPE } from "@/lib/alerts";
import { whatsappConfigured } from "@/lib/whatsapp";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Notifications — ${brandName}` };
}

type WhatsAppConfig = { is_enabled: boolean; verified_at: string | null; last_error: string | null };
type State = "on" | "off" | "issue";

/**
 * Where truck alerts arrive. One compact row per channel - the same pattern for
 * every channel, today and later (email, SMS…):
 *
 *   [icon] Name                          ● status   ˅
 *          one short line: where / how many
 *
 * The status reads at a glance (green dot + green edge = on, grey = off, red =
 * needs attention). Tapping the row opens its settings, Test and (i) help.
 * App notifications are always on, so that row has no settings - just Test.
 */
export default async function NotificationsPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();
  const waReady = whatsappConfigured();

  const [{ data: telegram }, { count: pushDevices }, { data: whatsapp }, { data: me }] = await Promise.all([
    admin.from("telegram_configs").select("*").eq("user_id", overview.id).maybeSingle<TelegramConfig>(),
    admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", overview.id),
    waReady
      ? admin
          .from("whatsapp_configs")
          .select("is_enabled, verified_at, last_error")
          .eq("user_id", overview.id)
          .maybeSingle<WhatsAppConfig>()
      : Promise.resolve({ data: null }),
    admin.from("profiles").select("phone").eq("id", overview.id).maybeSingle<{ phone: string | null }>(),
  ]);

  const devices = pushDevices ?? 0;
  const phone = me?.phone ?? "";
  const waOn = Boolean(phone) && (whatsapp?.is_enabled ?? false);
  const tgOn = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);
  const waState: State = waOn ? (whatsapp?.last_error ? "issue" : "on") : "off";
  const tgState: State = tgOn ? (telegram?.last_error ? "issue" : "on") : "off";

  return (
    <div className="account-workspace notify-workspace">
      <Link href="/portal/profile" className="app-back-link">
        <ArrowLeft size={17} />
        Profile
      </Link>
      <PageHeader icon={<BellRing size={22} />} title="Notifications" subtitle="Where your truck alerts arrive." />

      <div className="nrow-list">
        {/* App notifications: always on - nothing to set, only a test. */}
        <section className="nrow is-on">
          <div className="nrow-head">
            <span className="nrow-icon app-tone-blue"><Smartphone size={18} /></span>
            <span className="nrow-text">
              <span className="nrow-title">App notifications</span>
              <span className="nrow-sub">
                Always on{devices > 0 ? ` · ${devices === 1 ? "1 device" : `${devices} devices`}` : " · allow when asked"}
              </span>
            </span>
            <InlineActionForm action={testMyPushAction} className="nrow-test">
              <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                Test
              </SubmitButton>
            </InlineActionForm>
          </div>
        </section>

        {waReady ? (
          <Channel
            icon={<MessageCircle size={18} />}
            tone="mint"
            title="WhatsApp"
            state={waState}
            sub={
              waState === "issue"
                ? "Needs attention"
                : waOn
                  ? formatIndianMobile(phone)
                  : phone
                    ? "Off · tap to turn on"
                    : "Add your mobile number first"
            }
          >
            {whatsapp?.last_error && waOn ? <p className="nrow-error">{whatsapp.last_error}</p> : null}
            {phone ? (
              <>
                <p className="nrow-line">
                  Alerts go to <strong className="font-mono">{formatIndianMobile(phone)}</strong>
                  {" · "}
                  <Link href="/portal/profile/edit" className="nrow-link">Change</Link>
                </p>
                <p className="nrow-line">{WHATSAPP_ALERTS_SCOPE} Every-check updates and hourly halt reminders come in the app and on Telegram.</p>
                <ActionForm action={saveMyWhatsApp} closeOnSuccess={false} className="nrow-form">
                  <Checkbox name="opt_in" label="Send my truck alerts on WhatsApp" defaultChecked={waOn} />
                  <SubmitButton size="sm">Save</SubmitButton>
                </ActionForm>
              </>
            ) : (
              <p className="nrow-line">
                <Link href="/portal/profile/edit" className="nrow-link">Add your mobile number</Link> to use WhatsApp.
              </p>
            )}
            <div className="nrow-actions">
              {waOn ? (
                <InlineActionForm action={testMyWhatsApp}>
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                    <Send size={13} />
                    Send test
                  </SubmitButton>
                </InlineActionForm>
              ) : null}
              <a
                href={`https://wa.me/${env.whatsappPublicNumber}?text=Hi`}
                target="_blank"
                rel="noopener noreferrer"
                className="notify-wa-link"
              >
                <MessageCircle size={14} />
                Message Rahdari
              </a>
              <InfoTip
                label="about WhatsApp alerts"
                info={
                  <>
                    <p>Alerts come from Rahdari, +91 92134 34855, to the mobile number in your profile.</p>
                    <p>Message Rahdari once on WhatsApp so your phone saves the number and alerts are never filtered.</p>
                    {whatsapp?.verified_at ? <p>Last test delivered {fmtRelative(whatsapp.verified_at)}.</p> : null}
                  </>
                }
              >
                <span className="nrow-help">Help</span>
              </InfoTip>
            </div>
          </Channel>
        ) : null}

        <Channel
          icon={<Send size={18} />}
          tone="violet"
          title="Telegram"
          state={tgState}
          sub={
            tgState === "issue"
              ? "Needs attention"
              : tgOn
                ? `Chat ID ${telegram?.chat_id}`
                : !env.telegramBotToken
                  ? "Unavailable right now"
                  : "Off · add your chat ID"
          }
        >
          {telegram?.last_error ? <p className="nrow-error">{friendlyError(telegram.last_error)}</p> : null}
          <ActionForm action={saveMyTelegram} closeOnSuccess={false} className="nrow-form">
            <Field label="Chat ID" name="chat_id">
              <Input
                name="chat_id"
                defaultValue={telegram?.chat_id ?? ""}
                inputMode="numeric"
                placeholder="e.g. 123456789"
                className="font-mono"
              />
            </Field>
            <SubmitButton size="sm">Save</SubmitButton>
          </ActionForm>
          <div className="nrow-actions">
            {tgOn ? (
              <InlineActionForm action={testMyTelegram}>
                <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                  <Send size={13} />
                  Send test
                </SubmitButton>
              </InlineActionForm>
            ) : null}
            {telegram?.verified_at ? (
              <span className="nrow-meta">Last test delivered {fmtRelative(telegram.verified_at)}</span>
            ) : null}
          </div>
          <TelegramChatIdHelp className="mt-2" />
        </Channel>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<State, string> = { on: "On", off: "Off", issue: "Check" };

/** One channel: a one-line summary that opens to its settings. */
function Channel({
  icon,
  tone,
  title,
  state,
  sub,
  children,
}: {
  icon: ReactNode;
  tone: "blue" | "mint" | "violet";
  title: string;
  state: State;
  sub: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className={`nrow is-${state}`}>
      <summary className="nrow-head">
        <span className={`nrow-icon app-tone-${tone}`}>{icon}</span>
        <span className="nrow-text">
          <span className="nrow-title">{title}</span>
          <span className="nrow-sub">{sub}</span>
        </span>
        <span className={`nrow-state is-${state}`}>
          <i aria-hidden />
          {STATE_LABEL[state]}
        </span>
        <ChevronDown size={18} className="nrow-chev" aria-hidden />
      </summary>
      <div className="nrow-body">{children}</div>
    </details>
  );
}
