import Link from "next/link";
import { ArrowLeft, BellRing, CheckCircle2, MessageCircle, Send, Smartphone } from "lucide-react";
import type { ReactNode } from "react";

import { saveMyTelegram, saveMyWhatsApp, testMyPushAction, testMyTelegram, testMyWhatsApp } from "../settings/actions";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, Input } from "@/components/form";
import { publicSettings } from "@/components/SiteFooter";
import { TelegramChatIdHelp } from "@/components/TelegramChatIdInfo";
import { Badge, PageHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { formatIndianMobile } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TelegramConfig } from "@/lib/types";
import { whatsappConfigured } from "@/lib/whatsapp";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Notifications — ${brandName}` };
}

type WhatsAppConfig = { is_enabled: boolean; verified_at: string | null; last_error: string | null };

/**
 * Where truck alerts arrive - one compact page, one row per channel:
 *   App notifications  always on (PushAutoOn subscribes each device); test only
 *   WhatsApp           off by default; opt-in; goes to the profile's mobile
 *   Telegram           on once a chat ID is saved; the chat-ID guide as before
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

  return (
    <div className="account-workspace notify-workspace">
      <Link href="/portal/profile" className="app-back-link">
        <ArrowLeft size={17} />
        Profile
      </Link>
      <PageHeader icon={<BellRing size={22} />} title="Notifications" subtitle="Where your truck alerts arrive." />

      <div className="notify-list">
        {/* App notifications: always on, nothing to set */}
        <Channel
          icon={<Smartphone size={18} />}
          tone="blue"
          title="App notifications"
          status={<Badge tone="good"><CheckCircle2 size={10} />always on</Badge>}
          detail={
            devices > 0
              ? `On ${devices === 1 ? "1 device" : `${devices} devices`}.`
              : "Allow notifications when your phone or browser asks."
          }
          action={
            <InlineActionForm action={testMyPushAction}>
              <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                <Send size={13} />
                Test
              </SubmitButton>
            </InlineActionForm>
          }
        />

        {/* WhatsApp: off by default, alerts only, to the profile number */}
        {waReady ? (
          <Channel
            icon={<MessageCircle size={18} />}
            tone="mint"
            title="WhatsApp"
            status={waOn ? <Badge tone="good"><CheckCircle2 size={10} />on</Badge> : <Badge tone="neutral">off</Badge>}
            detail={
              whatsapp?.last_error && waOn ? (
                <span className="text-bad-500">{whatsapp.last_error}</span>
              ) : phone ? (
                <>
                  To <span className="font-mono text-ink">{formatIndianMobile(phone)}</span> ·{" "}
                  <Link href="/portal/profile/edit" className="text-brand-500 hover:underline">change</Link>
                </>
              ) : (
                <>
                  <Link href="/portal/profile/edit" className="text-brand-500 hover:underline">Add your mobile number</Link> to use WhatsApp.
                </>
              )
            }
            action={
              waOn ? (
                <InlineActionForm action={testMyWhatsApp}>
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                    <Send size={13} />
                    Test
                  </SubmitButton>
                </InlineActionForm>
              ) : null
            }
          >
            {phone ? (
              <ActionForm action={saveMyWhatsApp} closeOnSuccess={false} className="notify-inline-form">
                <Checkbox name="opt_in" label="Send my truck alerts on WhatsApp" defaultChecked={waOn} />
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            ) : null}
            {/* Messaging us opens WhatsApp's 24-hour window: alerts then arrive as full messages. */}
            <a
              href={`https://wa.me/${env.whatsappPublicNumber}?text=Hi`}
              target="_blank"
              rel="noopener noreferrer"
              className="notify-wa-link"
            >
              <MessageCircle size={14} />
              Message Rahdari on WhatsApp
            </a>
          </Channel>
        ) : null}

        {/* Telegram: a chat ID turns it on */}
        <Channel
          icon={<Send size={18} />}
          tone="violet"
          title="Telegram"
          status={tgOn ? <Badge tone="good"><CheckCircle2 size={10} />on</Badge> : <Badge tone="neutral">off</Badge>}
          detail={
            telegram?.last_error ? (
              <span className="text-bad-500">{friendlyError(telegram.last_error)}</span>
            ) : telegram?.verified_at ? (
              `Last verified ${fmtRelative(telegram.verified_at)}.`
            ) : !env.telegramBotToken ? (
              "Telegram alerts are temporarily unavailable."
            ) : (
              "Add your chat ID to turn it on."
            )
          }
          action={
            tgOn ? (
              <InlineActionForm action={testMyTelegram}>
                <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
                  <Send size={13} />
                  Test
                </SubmitButton>
              </InlineActionForm>
            ) : null
          }
        >
          <ActionForm action={saveMyTelegram} closeOnSuccess={false} className="notify-inline-form">
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
          <TelegramChatIdHelp className="mt-2" />
        </Channel>
      </div>
    </div>
  );
}

function Channel({
  icon,
  tone,
  title,
  status,
  detail,
  action,
  children,
}: {
  icon: ReactNode;
  tone: "blue" | "mint" | "violet";
  title: string;
  status: ReactNode;
  detail: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="notify-channel">
      <div className="notify-head">
        <span className={`app-menu-icon app-tone-${tone}`}>{icon}</span>
        <div className="notify-text">
          <p className="notify-title">
            {title}
            {status}
          </p>
          <p className="notify-detail">{detail}</p>
        </div>
        {action ? <div className="notify-action">{action}</div> : null}
      </div>
      {children ? <div className="notify-body">{children}</div> : null}
    </section>
  );
}
