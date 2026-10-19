import { BellRing, Copy, Megaphone, Pause, Pencil, Play, Plus, Smartphone, Trash2 } from "lucide-react";

import { AnnouncementFields } from "./AnnouncementFields";
import {
  createAnnouncement,
  deleteAnnouncement,
  duplicateAnnouncement,
  sendAnnouncementPushNow,
  setAnnouncementActive,
  updateAnnouncement,
} from "./actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { FormActions } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Badge, EmptyState, PageHeader, Panel, type BadgeTone } from "@/components/ui";
import {
  AUDIENCE_LABELS,
  MEMBER_COLUMNS,
  inAudience,
  toMember,
  type Announcement,
  type MemberRow,
} from "@/lib/announcement-rules";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Announcements — Admin" };

type PlanOption = { id: string; name: string; is_active: boolean };

type Stats = { seen: number; dismissed: number; clicked: number };

/**
 * Where an announcement is in its life, worked out from the row and the clock.
 * Paused wins over everything: a paused one shows nowhere whatever its dates.
 */
function lifecycle(a: Announcement, now: number): { label: string; tone: BadgeTone } {
  if (!a.is_active) return { label: "Paused", tone: "neutral" };
  if (a.ends_at && new Date(a.ends_at).getTime() <= now) return { label: "Ended", tone: "neutral" };
  if (new Date(a.starts_at).getTime() > now) return { label: "Scheduled", tone: "warn" };
  return { label: "Live", tone: "good" };
}

const FREQUENCY_SHORT: Record<Announcement["frequency"], string> = {
  once: "Once",
  daily: "Once a day",
  session: "Each app open",
  always: "Every page",
};

const TONE_BADGE: Record<Announcement["tone"], BadgeTone> = {
  info: "brand",
  offer: "brand",
  success: "good",
  warning: "warn",
};

export default async function AnnouncementsPage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const [{ data: rows, error }, { data: planRows }, { data: customerRows }] = await Promise.all([
    admin.from("announcements").select("*").order("created_at", { ascending: false }).limit(200),
    admin.from("plans").select("id,name,is_active").order("sort_order").order("name"),
    // Customers who could be reached at all, for the "targeted" figure. Same
    // filter the push uses: active accounts with the customer role.
    admin.from("profiles").select(MEMBER_COLUMNS).eq("role", "officer").eq("status", "active"),
  ]);

  const plans = (planRows ?? []) as PlanOption[];
  const planNames = new Map(plans.map((p) => [p.id, p.name]));

  /*
   * The tables come from migration 0059. If this build reaches production
   * before the migration does, say so here rather than throwing - the rest of
   * the console must keep working.
   */
  if (error) {
    return (
      <>
        <PageHeader title="Announcements" />
        <Panel>
          <EmptyState
            title="Announcements are not set up in the database yet"
            description={`Apply migration 0059_announcements.sql, then reload. (${error.message})`}
          />
        </Panel>
      </>
    );
  }

  const list = (rows ?? []) as Announcement[];
  const members = ((customerRows ?? []) as MemberRow[]).map(toMember);

  // Stats for every listed announcement in one read of the views.
  const stats = new Map<string, Stats>();
  if (list.length > 0) {
    const { data: views } = await admin
      .from("announcement_views")
      .select("announcement_id,dismissed_at,clicked_at")
      .in(
        "announcement_id",
        list.map((a) => a.id),
      );
    for (const v of (views ?? []) as {
      announcement_id: string;
      dismissed_at: string | null;
      clicked_at: string | null;
    }[]) {
      const s = stats.get(v.announcement_id) ?? { seen: 0, dismissed: 0, clicked: 0 };
      s.seen += 1;
      if (v.dismissed_at) s.dismissed += 1;
      if (v.clicked_at) s.clicked += 1;
      stats.set(v.announcement_id, s);
    }
  }

  // Emails for the chosen-customer lists, so the edit form shows people
  // rather than ids.
  const userIds = [...new Set(list.flatMap((a) => a.target_user_ids ?? []))];
  const emails = new Map<string, string>();
  if (userIds.length > 0) {
    const { data } = await admin.from("profiles").select("id,email").in("id", userIds.slice(0, 1000));
    for (const row of (data ?? []) as { id: string; email: string }[]) emails.set(row.id, row.email);
  }

  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Tell customers something - a banner across the portal, a popup, a phone notification, or all three. Choose who, when, and how often."
        actions={<NewButton plans={plans} />}
      />

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            title="No announcements yet"
            description="An offer, a maintenance notice, a new feature - anything every customer, or some of them, should hear about."
            action={<NewButton plans={plans} />}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {list.map((a) => {
            const targeted =
              a.audience === "users"
                ? (a.target_user_ids ?? []).length
                : members.filter((m) => inAudience(a, m)).length;
            return (
              <AnnouncementCard
                key={a.id}
                announcement={a}
                status={lifecycle(a, now)}
                stats={stats.get(a.id) ?? { seen: 0, dismissed: 0, clicked: 0 }}
                targeted={targeted}
                plans={plans}
                planNames={planNames}
                targetUsers={(a.target_user_ids ?? []).map((id) => emails.get(id) ?? id).join("\n")}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function NewButton({ plans }: { plans: PlanOption[] }) {
  return (
    <Modal
      triggerLabel="New announcement"
      triggerIcon={<Plus size={15} />}
      title="New announcement"
      description="Times are India time. It goes live at the start time; leave it blank to go live now."
      width="xl"
    >
      <ActionForm action={createAnnouncement}>
        <AnnouncementFields plans={plans} />
        <FormActions>
          <SubmitButton pendingLabel="Saving...">Save announcement</SubmitButton>
        </FormActions>
      </ActionForm>
    </Modal>
  );
}

function AnnouncementCard({
  announcement: a,
  status,
  stats,
  targeted,
  plans,
  planNames,
  targetUsers,
}: {
  announcement: Announcement;
  status: { label: string; tone: BadgeTone };
  stats: Stats;
  targeted: number;
  plans: PlanOption[];
  planNames: Map<string, string>;
  targetUsers: string;
}) {
  const channels = [
    a.show_banner ? "Banner" : null,
    a.show_popup ? "Popup" : null,
    a.send_push ? "Phone" : null,
  ].filter(Boolean);

  const audience =
    a.audience === "plans"
      ? `${AUDIENCE_LABELS.plans}: ${(a.target_plan_ids ?? []).map((id) => planNames.get(id) ?? "deleted plan").join(", ")}`
      : AUDIENCE_LABELS[a.audience];

  const ended = status.label === "Ended";

  return (
    <section className="panel flex flex-col overflow-hidden">
      <header className="border-b border-line/70 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Megaphone size={15} className="shrink-0 text-brand-400" />
          <h2 className="min-w-0 text-sm font-semibold break-words text-strong">{a.title}</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone={TONE_BADGE[a.tone]}>{a.tone}</Badge>
        </div>
        {a.body ? (
          <p className="mt-1 line-clamp-3 text-xs whitespace-pre-line text-muted">{a.body}</p>
        ) : null}
      </header>

      <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-1.5 px-4 py-3 text-xs sm:grid-cols-2 sm:px-5">
        <Row label="Shows as">{channels.join(" · ")}</Row>
        <Row label="How often">
          {FREQUENCY_SHORT[a.frequency]}
          {a.dismissible ? "" : " · cannot be closed"}
        </Row>
        <Row label="Who" wide>
          {audience}
        </Row>
        <Row label="Starts">{fmtDateTime(a.starts_at)}</Row>
        <Row label="Ends">{a.ends_at ? fmtDateTime(a.ends_at) : "No end"}</Row>
        {a.cta_url ? (
          <Row label="Button" wide>
            {a.cta_label} → <span className="break-all">{a.cta_url}</span>
          </Row>
        ) : null}
      </dl>

      {/* The numbers the admin came for. Seen counts customers, not views. */}
      <div className="grid grid-cols-5 border-t border-line/70 bg-raised/40 text-center">
        <Stat label="Targeted" value={targeted} />
        <Stat label="Seen" value={stats.seen} />
        <Stat label="Closed" value={stats.dismissed} />
        <Stat label="Clicked" value={stats.clicked} />
        <Stat
          label="Push sent"
          value={a.push_sent_at ? a.push_sent_count : null}
          title={a.push_sent_at ? `Sent ${fmtDateTime(a.push_sent_at)}` : "Not sent"}
        />
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line/70 px-4 py-3 sm:px-5">
        <Modal
          triggerLabel="Edit"
          triggerIcon={<Pencil size={13} />}
          triggerVariant="secondary"
          triggerSize="sm"
          title={`Edit ${a.title}`}
          description="Times are India time. Changes show on customers' next page."
          width="xl"
        >
          <ActionForm action={updateAnnouncement}>
            <input type="hidden" name="id" value={a.id} />
            <AnnouncementFields announcement={a} plans={plans} targetUsers={targetUsers} />
            <FormActions>
              <SubmitButton>Save</SubmitButton>
            </FormActions>
          </ActionForm>
        </Modal>

        <InlineActionForm
          action={setAnnouncementActive}
          hidden={{ id: a.id, is_active: a.is_active ? "false" : "true" }}
        >
          <SubmitButton variant="ghost" size="sm">
            {a.is_active ? <Pause size={13} /> : <Play size={13} />}
            {a.is_active ? "Pause" : "Resume"}
          </SubmitButton>
        </InlineActionForm>

        <InlineActionForm action={duplicateAnnouncement} hidden={{ id: a.id }}>
          <SubmitButton variant="ghost" size="sm">
            <Copy size={13} />
            Duplicate
          </SubmitButton>
        </InlineActionForm>

        {!a.push_sent_at && a.is_active && !ended ? (
          <InlineActionForm action={sendAnnouncementPushNow} hidden={{ id: a.id }}>
            <ConfirmSubmitButton
              variant="ghost"
              message={`Send "${a.title}" as a phone notification to ${targeted} customer${targeted === 1 ? "" : "s"} now? It can only be sent once.`}
            >
              <BellRing size={13} />
              Send push now
            </ConfirmSubmitButton>
          </InlineActionForm>
        ) : a.push_sent_at ? (
          <span className="inline-flex items-center gap-1 text-xs text-faint">
            <Smartphone size={12} />
            Push sent {fmtDateTime(a.push_sent_at)}
          </span>
        ) : null}

        <div className="ml-auto">
          <InlineActionForm action={deleteAnnouncement} hidden={{ id: a.id }}>
            <ConfirmSubmitButton message={`Delete "${a.title}" and its stats? This cannot be undone.`}>
              <Trash2 size={13} />
              Delete
            </ConfirmSubmitButton>
          </InlineActionForm>
        </div>
      </footer>
    </section>
  );
}

function Row({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="inline text-muted">{label}: </dt>
      <dd className="inline text-ink">{children}</dd>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: number | null; title?: string }) {
  return (
    <div className="px-1 py-2.5" title={title}>
      <p className="text-sm font-semibold text-ink tabular-nums">{value === null ? "–" : fmtNumber(value)}</p>
      <p className="text-[10px] tracking-wide text-faint uppercase">{label}</p>
    </div>
  );
}
