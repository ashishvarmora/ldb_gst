/**
 * The parts of announcements that both sides need: the allowed values, the
 * labels, and who-is-in-the-audience. Pure - no database, no push - so the
 * admin form and the portal's client component can import it without pulling
 * the service-role client or web-push into a browser bundle. The server half
 * is src/lib/announcements.ts.
 */

export const TONES = ["info", "offer", "warning", "success"] as const;
export const AUDIENCES = ["all", "active_plan", "no_plan", "plans", "users"] as const;
export const FREQUENCIES = ["once", "daily", "session", "always"] as const;

export type AnnouncementTone = (typeof TONES)[number];
export type AnnouncementAudience = (typeof AUDIENCES)[number];
export type AnnouncementFrequency = (typeof FREQUENCIES)[number];

/** One row of public.announcements. */
export type Announcement = {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementTone;
  show_banner: boolean;
  show_popup: boolean;
  send_push: boolean;
  audience: AnnouncementAudience;
  target_plan_ids: string[];
  target_user_ids: string[];
  frequency: AnnouncementFrequency;
  dismissible: boolean;
  starts_at: string;
  ends_at: string | null;
  cta_label: string | null;
  cta_url: string | null;
  is_active: boolean;
  push_sent_at: string | null;
  push_sent_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * What the browser is given: only what it draws. The audience lists in
 * particular stay on the server - target_user_ids is other customers' ids.
 */
export type VisibleAnnouncement = Pick<
  Announcement,
  | "id"
  | "title"
  | "body"
  | "tone"
  | "show_banner"
  | "show_popup"
  | "frequency"
  | "dismissible"
  | "cta_label"
  | "cta_url"
>;

/** Who an announcement is being checked against. */
export type AudienceMember = {
  id: string;
  plan_id: string | null;
  plan_active: boolean;
};

export const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "Every customer",
  active_plan: "Customers with an active plan",
  no_plan: "Customers without an active plan",
  plans: "Customers on chosen plans",
  users: "Chosen customers",
};

export const FREQUENCY_LABELS: Record<AnnouncementFrequency, string> = {
  once: "Once — until closed (or shown once, if it cannot be closed)",
  daily: "Once a day (IST)",
  session: "Each time the app or site is opened",
  always: "On every page, until it ends",
};

/**
 * Whether one customer is in an announcement's audience.
 *
 * 'no_plan' means no ACTIVE plan rather than no plan ever: an account whose
 * plan lapsed is exactly who a renewal offer is for, and leaving them out of
 * both 'active_plan' and 'no_plan' would make them reachable only by 'all'.
 */
export function inAudience(
  announcement: Pick<Announcement, "audience" | "target_plan_ids" | "target_user_ids">,
  member: AudienceMember,
): boolean {
  switch (announcement.audience) {
    case "all":
      return true;
    case "active_plan":
      return member.plan_active;
    case "no_plan":
      return !member.plan_active;
    case "plans":
      return member.plan_id !== null && (announcement.target_plan_ids ?? []).includes(member.plan_id);
    case "users":
      return (announcement.target_user_ids ?? []).includes(member.id);
    default:
      return false;
  }
}

/** The IST calendar day of a timestamp, YYYY-MM-DD - the day 'daily' counts by. */
export function istDay(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Inside its window right now. */
export function isLiveNow(
  announcement: Pick<Announcement, "is_active" | "starts_at" | "ends_at">,
  now = Date.now(),
): boolean {
  if (!announcement.is_active) return false;
  if (new Date(announcement.starts_at).getTime() > now) return false;
  if (announcement.ends_at && new Date(announcement.ends_at).getTime() <= now) return false;
  return true;
}


/** What audience matching needs from a profile. */
export const MEMBER_COLUMNS = "id,plan_id,plan_expires_on,role,status";

export type MemberRow = {
  id: string;
  plan_id: string | null;
  plan_expires_on: string | null;
  role: string;
  status: string;
};

/**
 * officer_overview.plan_active, computed from the profile row alone: a plan,
 * not past its last day (IST), on an active account - the same three tests the
 * view makes (0042). Read off profiles rather than the view because the view
 * also counts every account's trucks and spend, and an audience question over
 * the whole customer base needs none of that.
 */
export function toMember(row: MemberRow): AudienceMember {
  const today = istDay(new Date());
  return {
    id: row.id,
    plan_id: row.plan_id,
    plan_active:
      row.plan_id !== null &&
      (row.plan_expires_on === null || row.plan_expires_on >= today) &&
      row.status === "active",
  };
}

