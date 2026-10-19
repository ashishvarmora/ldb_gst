import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import {
  inAudience,
  istDay,
  toMember,
  MEMBER_COLUMNS,
  type Announcement,
  type AudienceMember,
  type MemberRow,
  type VisibleAnnouncement,
} from "@/lib/announcement-rules";

export * from "@/lib/announcement-rules";

/**
 * Announcements: one thing the desk says to many customers at once.
 *
 * Three ways to say it, any combination - a banner across the top of the
 * portal, a popup, and a phone notification - with a window (starts_at,
 * ends_at), an audience, and a frequency rule. The tables are in migration
 * 0059; the admin screen is /admin/announcements; the customer side is
 * <Announcements> in the portal layout.
 *
 * TWO RULES THIS FILE KEEPS, BECAUSE THE PORTAL IS LIVE.
 *
 *  - Nothing here throws into a page. loadAnnouncementsFor() runs in the portal
 *    layout on every customer page, so a missing table (the migration not yet
 *    applied), a timeout or a bad row logs and returns nothing. The worst case
 *    of a fault in this feature is that nobody sees an announcement - never
 *    that the portal stops rendering.
 *  - A push goes once. The row is claimed (push_sent_at stamped while it is
 *    still null) BEFORE the first send, so two cron ticks, or the sweep and an
 *    admin's "Send push now", cannot both send it.
 */

/** One row of public.announcement_views. */
type ViewRow = {
  announcement_id: string;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  dismissed_at: string | null;
  clicked_at: string | null;
};


/**
 * Whether the frequency rule still lets this customer see it.
 *
 * "Finished with it" means closed it, tapped its button, or - for one that
 * cannot be closed - simply saw it. The rule says over what period that
 * counts:
 *
 *   once     for ever
 *   daily    for the current IST day; tomorrow it comes back
 *   always   only an explicit close counts, so a non-closable one shows on
 *            every page until it ends
 *   session  nothing counts here - "this time the app was opened" is the
 *            browser's sessionStorage, which <Announcements> checks itself
 */
function frequencyAllows(
  announcement: Pick<Announcement, "frequency" | "dismissible">,
  view: ViewRow | undefined,
  today: string,
): boolean {
  if (!view) return true;

  const finished = [view.dismissed_at, view.clicked_at];
  if (!announcement.dismissible) finished.push(view.last_seen_at);
  const finishedAt = finished.filter((t): t is string => Boolean(t));

  switch (announcement.frequency) {
    case "once":
      return finishedAt.length === 0;
    case "daily":
      return !finishedAt.some((t) => istDay(t) === today);
    case "always":
      return !(announcement.dismissible && view.dismissed_at);
    case "session":
      return true;
    default:
      return false;
  }
}

/**
 * The announcements one customer should see on this page, banners and popups
 * both. Never throws - see the header.
 */
export async function loadAnnouncementsFor(member: AudienceMember): Promise<VisibleAnnouncement[]> {
  try {
    const admin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data, error } = await admin
      .from("announcements")
      .select(
        "id,title,body,tone,show_banner,show_popup,send_push,audience,target_plan_ids,target_user_ids,frequency,dismissible,starts_at,ends_at,cta_label,cta_url,is_active",
      )
      .eq("is_active", true)
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("starts_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[announcements] could not load:", error.message);
      return [];
    }

    // A push-only announcement has nothing to draw on the page.
    const candidates = ((data ?? []) as Announcement[]).filter(
      (a) => (a.show_banner || a.show_popup) && inAudience(a, member),
    );
    if (candidates.length === 0) return [];

    const { data: viewRows, error: viewError } = await admin
      .from("announcement_views")
      .select("announcement_id,first_seen_at,last_seen_at,seen_count,dismissed_at,clicked_at")
      .eq("user_id", member.id)
      .in(
        "announcement_id",
        candidates.map((a) => a.id),
      );

    if (viewError) {
      // Without the views a 'once' would show again on every page, which is
      // worse than not showing it this once.
      console.error("[announcements] could not load views:", viewError.message);
      return [];
    }

    const views = new Map(((viewRows ?? []) as ViewRow[]).map((v) => [v.announcement_id, v]));
    const today = istDay(new Date());

    return candidates
      .filter((a) => frequencyAllows(a, views.get(a.id), today))
      .map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        tone: a.tone,
        show_banner: a.show_banner,
        show_popup: a.show_popup,
        frequency: a.frequency,
        dismissible: a.dismissible,
        cta_label: a.cta_label,
        cta_url: a.cta_url,
      }));
  } catch (error) {
    console.error("[announcements] load failed:", error);
    return [];
  }
}

/**
 * Records that one customer saw, closed or tapped some announcements.
 *
 * Read-then-write rather than one upsert, because seen_count has to go up by
 * one and an upsert can only set a value. The handful of rows a page shows
 * makes the extra read cheap. Never throws.
 */
export async function recordAnnouncementEvent(
  userId: string,
  ids: string[],
  kind: "seen" | "dismissed" | "clicked",
): Promise<void> {
  try {
    const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 20);
    if (unique.length === 0) return;

    const admin = getSupabaseAdmin();

    // Only ids that exist, so a forged request cannot fill the table with rows
    // pointing at nothing (the foreign key would refuse them anyway, loudly).
    const { data: real } = await admin.from("announcements").select("id").in("id", unique);
    const realIds = (real ?? []).map((r: { id: string }) => r.id);
    if (realIds.length === 0) return;

    const { data: existing } = await admin
      .from("announcement_views")
      .select("announcement_id,seen_count")
      .eq("user_id", userId)
      .in("announcement_id", realIds);

    const have = new Map(
      ((existing ?? []) as { announcement_id: string; seen_count: number }[]).map((r) => [
        r.announcement_id,
        r.seen_count,
      ]),
    );
    const now = new Date().toISOString();

    const fresh = realIds
      .filter((id) => !have.has(id))
      .map((id) => ({
        announcement_id: id,
        user_id: userId,
        first_seen_at: now,
        last_seen_at: now,
        seen_count: 1,
        dismissed_at: kind === "dismissed" ? now : null,
        clicked_at: kind === "clicked" ? now : null,
      }));

    if (fresh.length > 0) {
      // ignoreDuplicates: two tabs recording the same first view at once must
      // not turn into an error for the slower one.
      const { error } = await admin
        .from("announcement_views")
        .upsert(fresh, { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
      if (error) console.error("[announcements] view insert failed:", error.message);
    }

    await Promise.all(
      realIds
        .filter((id) => have.has(id))
        .map((id) => {
          const patch =
            kind === "seen"
              ? { last_seen_at: now, seen_count: (have.get(id) ?? 0) + 1 }
              : kind === "dismissed"
                ? { dismissed_at: now }
                : { clicked_at: now };
          return admin
            .from("announcement_views")
            .update(patch)
            .eq("announcement_id", id)
            .eq("user_id", userId);
        }),
    );
  } catch (error) {
    console.error("[announcements] record failed:", kind, error);
  }
}

/** How many phones are sent to at once. Enough to be quick, few enough that a
    big audience cannot open hundreds of connections in one cron tick. */
const PUSH_BATCH = 20;

/**
 * The accounts an announcement would reach by phone: the audience, narrowed to
 * accounts that have at least one device set up, since nobody else can be
 * pushed to. Starting from push_subscriptions keeps this small however many
 * customers there are.
 *
 * 'users' may name any active account, the admin's own included - the honest
 * way to test one is to send it to yourself first. Every other audience is
 * customers only.
 */
export async function pushRecipients(
  announcement: Pick<Announcement, "audience" | "target_plan_ids" | "target_user_ids">,
): Promise<string[]> {
  const admin = getSupabaseAdmin();

  const { data: subs, error } = await admin.from("push_subscriptions").select("user_id");
  if (error) throw new Error(`could not read devices: ${error.message}`);

  let ids = [...new Set(((subs ?? []) as { user_id: string }[]).map((s) => s.user_id))];
  if (announcement.audience === "users") {
    const wanted = new Set(announcement.target_user_ids ?? []);
    ids = ids.filter((id) => wanted.has(id));
  }
  if (ids.length === 0) return [];

  const members: MemberRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: readError } = await admin
      .from("profiles")
      .select(MEMBER_COLUMNS)
      .in("id", ids.slice(i, i + 200));
    if (readError) throw new Error(`could not read accounts: ${readError.message}`);
    members.push(...((data ?? []) as MemberRow[]));
  }

  return members
    .filter((m) => m.status === "active")
    .filter((m) => announcement.audience === "users" || m.role === "officer")
    .filter((m) => inAudience(announcement, toMember(m)))
    .map((m) => m.id);
}

/** Notification text: the title, and the body cut to what a phone shows. */
function pushPayloadFor(announcement: Announcement) {
  const body = announcement.body.replace(/\s+/g, " ").trim();
  return {
    title: announcement.title,
    body: body.length > 180 ? `${body.slice(0, 177)}…` : body,
    tag: `ann-${announcement.id}`,
    url: announcement.cta_url?.startsWith("/") ? announcement.cta_url : "/portal",
  };
}

export type AnnouncementPushResult =
  | { ok: true; recipients: number; sent: number }
  | { ok: false; error: string };

/**
 * Sends one announcement's phone notification to its whole audience, once.
 *
 * Claims the row first: an update that only matches while push_sent_at is
 * null. Whoever wins that update sends; anybody else gets "already sent" and
 * sends nothing. The claim is not undone if the sends then fail - a second
 * attempt that reached some phones twice would be worse than one that reached
 * fewer than it should, and the count recorded says how many it reached.
 *
 * Never throws.
 */
export async function sendAnnouncementPush(id: string): Promise<AnnouncementPushResult> {
  try {
    const admin = getSupabaseAdmin();
    const { data: claimed, error } = await admin
      .from("announcements")
      .update({ push_sent_at: new Date().toISOString(), push_sent_count: 0 })
      .eq("id", id)
      .is("push_sent_at", null)
      .eq("is_active", true)
      .eq("send_push", true)
      .select("*")
      .maybeSingle<Announcement>();

    if (error) return { ok: false, error: error.message };
    if (!claimed) return { ok: false, error: "This notification was already sent, or the announcement is paused." };

    let recipients: string[];
    try {
      recipients = await pushRecipients(claimed);
    } catch (readError) {
      console.error("[announcements] recipients failed:", readError);
      return { ok: false, error: "Could not work out who to send to." };
    }

    const payload = pushPayloadFor(claimed);
    let sent = 0;
    for (let i = 0; i < recipients.length; i += PUSH_BATCH) {
      const batch = recipients.slice(i, i + PUSH_BATCH);
      const results = await Promise.all(batch.map((userId) => sendPushToUser(userId, payload)));
      sent += results.filter((r) => r.ok).length;
    }

    await admin.from("announcements").update({ push_sent_count: sent }).eq("id", id);
    console.info(`[announcements] push ${id}: ${sent} of ${recipients.length} accounts reached`);
    return { ok: true, recipients: recipients.length, sent };
  } catch (error) {
    console.error("[announcements] push failed:", id, error);
    return { ok: false, error: "The notification could not be sent." };
  }
}

/**
 * Called from the tracking sweep's housekeeping: sends the push for every
 * announcement whose start time has arrived and whose push has not gone yet.
 * This is how a scheduled announcement's notification goes out at its start
 * time without anybody pressing anything. Never throws.
 */
export async function sendDueAnnouncementPushes(): Promise<number> {
  try {
    const admin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from("announcements")
      .select("id")
      .eq("is_active", true)
      .eq("send_push", true)
      .is("push_sent_at", null)
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .limit(5);

    if (error) {
      console.error("[announcements] due pushes:", error.message);
      return 0;
    }

    let done = 0;
    for (const row of (data ?? []) as { id: string }[]) {
      const result = await sendAnnouncementPush(row.id);
      if (result.ok) done += 1;
    }
    return done;
  } catch (error) {
    console.error("[announcements] due pushes failed:", error);
    return 0;
  }
}
