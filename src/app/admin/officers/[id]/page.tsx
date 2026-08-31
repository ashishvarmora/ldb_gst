import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Coins,
  KeyRound,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Truck,
  Wallet,
} from "lucide-react";

import { ActivityTab } from "./ActivityTab";
import { CreditsTab } from "./CreditsTab";
import { OverviewTab } from "./OverviewTab";
import { SettingsTab } from "./SettingsTab";
import { TabStrip, activeTab, type AccountParams } from "./TabStrip";
import { TrucksTab } from "./TrucksTab";
import { resetAccountPassword, setAccountStatus } from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Field, FormActions, Input } from "@/components/form";
import { Modal } from "@/components/Modal";
import {
  Avatar,
  Badge,
  PageHeader,
  QuotaBar,
  StatCard,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtRelative, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

/** Below this the customer is worth chasing before they stop mid-job. */
const LOW_BALANCE = 20;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await getSupabaseAdmin()
    .from("profiles")
    .select("full_name, email")
    .eq("id", id)
    .maybeSingle();
  return { title: `${data?.full_name ?? data?.email ?? "Customer"} — Admin` };
}

/**
 * One customer account.
 *
 * The page loads the overview row - which is what the header, the figures and
 * every tab need - and then hands off to the tab that was asked for. Each tab
 * runs its own queries, so opening the page costs one view read plus whatever
 * that tab needs, instead of the eleven queries the single-scroll version ran
 * every time.
 */
export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<AccountParams>;
}) {
  await requireSuperAdmin();
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const admin = getSupabaseAdmin();

  const { data: overview } = await admin
    .from("officer_overview")
    .select("*")
    .eq("id", id)
    .maybeSingle<OfficerOverview>();

  if (!overview) notFound();

  const tab = activeTab(search.tab);
  const suspended = overview.status === "suspended";
  const expired =
    overview.plan_expires_on !== null && new Date(overview.plan_expires_on) < new Date();

  const balance = Number(overview.credits ?? 0);
  const place = [overview.office, overview.district, overview.state].filter(Boolean).join(" · ");

  return (
    <>
      <Link
        href="/admin/officers"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        All customers
      </Link>

      <PageHeader
        title={overview.full_name ?? overview.email}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{overview.email}</span>
            {overview.designation ? (
              <span className="text-faint">· {overview.designation}</span>
            ) : null}
            {place ? <span className="text-faint">· {place}</span> : null}
          </span>
        }
        actions={
          <>
            <Avatar text={initials(overview.full_name, overview.email)} />

            <InlineActionForm
              action={setAccountStatus}
              hidden={{ user_id: id, status: suspended ? "active" : "suspended" }}
            >
              <ConfirmSubmitButton
                variant={suspended ? "secondary" : "danger"}
                message={
                  suspended
                    ? "Reactivate this account?"
                    : "Suspend this account? They are refused every search and all background tracking pauses."
                }
              >
                {suspended ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                {suspended ? "Reactivate" : "Suspend"}
              </ConfirmSubmitButton>
            </InlineActionForm>

            <Modal
              triggerLabel="Reset password"
              triggerIcon={<KeyRound size={13} />}
              triggerVariant="secondary"
              triggerSize="sm"
              title="Reset password"
              description="They are not emailed. Pass the new password on yourself."
              width="sm"
            >
              <ActionForm action={resetAccountPassword} closeOnSuccess={false}>
                <input type="hidden" name="user_id" value={id} />
                <Field
                  label="New password"
                  name="new_password"
                  hint="Leave blank to generate a strong one."
                >
                  <Input name="new_password" type="text" minLength={8} placeholder="auto-generate" />
                </Field>
                <FormActions>
                  <SubmitButton>Set password</SubmitButton>
                </FormActions>
              </ActionForm>
            </Modal>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={suspended ? "bad" : "good"}>{suspended ? "Suspended" : "Active"}</Badge>
        {overview.plan_name ? (
          <Badge tone={overview.plan_active ? "brand" : "warn"}>
            {overview.plan_name}
            {overview.plan_active ? "" : " — not live"}
          </Badge>
        ) : (
          <Badge tone="bad">No plan</Badge>
        )}
        {overview.has_overrides ? <Badge tone="warn">Custom limits</Badge> : null}
        {expired ? (
          <Badge tone="bad">Plan expired {fmtDate(overview.plan_expires_on)}</Badge>
        ) : null}
        <Badge tone={overview.telegram_connected ? "good" : "neutral"}>
          <MessageCircle size={11} />
          {overview.telegram_connected ? "Telegram linked" : "No Telegram"}
        </Badge>
        <span className="text-xs text-faint">
          Signed up {fmtDate(overview.created_at)} · last seen {fmtRelative(overview.last_active_at)}
        </span>
      </div>

      {/* The four figures stay above the tabs: they are the reason the page was
          opened, whichever tab answers the follow-up question. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits left"
          value={formatCredits(balance)}
          sub={
            balance <= 0
              ? "Out of credits — every search is refused"
              : `${formatCredits(overview.credits_purchased)} bought in total`
          }
          tone={balance <= 0 ? "bad" : balance < LOW_BALANCE ? "warn" : "brand"}
          icon={<Wallet size={15} />}
        />
        <StatCard
          label="Credits spent"
          value={formatCredits(overview.credits_spent_month)}
          sub={`${formatCredits(overview.credits_spent_today)} today · this month so far`}
          icon={<Coins size={15} />}
        />
        <StatCard
          label="Tracked trucks"
          value={overview.active_trucks}
          sub={<QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />}
          icon={<Truck size={15} />}
        />
        <StatCard
          label="Alerts today"
          value={overview.alerts_today}
          sub={`${overview.active_alerts} switched on · last crossing ${fmtRelative(overview.last_event_at)}`}
          icon={<Bell size={15} />}
        />
      </div>

      <TabStrip
        basePath={`/admin/officers/${id}`}
        current={tab}
        counts={{
          credits: formatCredits(balance),
          trucks: overview.total_trucks,
        }}
      />

      {tab === "overview" ? <OverviewTab id={id} overview={overview} /> : null}
      {tab === "credits" ? <CreditsTab id={id} overview={overview} params={search} /> : null}
      {tab === "trucks" ? <TrucksTab id={id} overview={overview} params={search} /> : null}
      {tab === "activity" ? <ActivityTab id={id} params={search} /> : null}
      {tab === "settings" ? <SettingsTab id={id} overview={overview} /> : null}
    </>
  );
}
