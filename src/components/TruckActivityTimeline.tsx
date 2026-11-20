import type { ReactNode } from "react";
import {
  Bell,
  BellOff,
  BellRing,
  Coins,
  MapPin,
  Octagon,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings2,
  Timer,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Disclosure } from "@/components/Disclosure";
import { Badge, cx } from "@/components/ui";
import { hoursLabel } from "@/lib/alerts";
import { formatCredits } from "@/lib/credits";
import { fmtAgo, fmtWhen } from "@/lib/format";
import { PAUSE_COPY } from "@/lib/pause";
import type { TruckActivity } from "@/lib/truck-activity";
import type { AlertLog, PausedReason } from "@/lib/types";

/** One row of credit_ledger_daily for this truck. */
export type LedgerDay = {
  ist_date: string;
  reason: string;
  entries: number;
  credits: number;
  last_at: string;
};

type Tone = "good" | "warn" | "bad" | "brand" | "neutral";

type Item = {
  key: string;
  at: string;
  icon: ReactNode;
  tone: Tone;
  text: string;
  sub?: string | null;
  badge?: ReactNode;
};

/** How many lines show before "Show older". */
const VISIBLE = 12;

const ICON = 15;

function autoPauseText(reason: PausedReason | null | undefined, hours?: number, failures?: number): string {
  switch (reason) {
    case "inactive":
      return hours
        ? `Paused automatically: no toll crossing for ${hoursLabel(hours)} (halt alert)`
        : "Paused automatically: no toll crossing for the halt alert's pause time";
    case "schedule":
      return "Paused automatically: the end time you set was reached";
    case "repeated_failures":
      return failures
        ? `Paused automatically: ${failures} failed checks in a row`
        : "Paused automatically: repeated failed checks";
    case "no_credits":
      return "Paused automatically: no credits left";
    case "plan_expired":
      return "Paused automatically: plan ended";
    case "account_suspended":
      return "Paused: account suspended";
    default:
      return "Paused automatically";
  }
}

function fromActivity(row: TruckActivity): Item {
  const d = row.detail ?? {};
  const base = { key: `a${row.id}`, at: row.created_at };
  switch (row.kind) {
    case "added":
      return { ...base, icon: <Plus size={ICON} />, tone: "brand", text: "Added to My trucks" };
    case "readded":
      return { ...base, icon: <Plus size={ICON} />, tone: "brand", text: "Added again and taken live" };
    case "alert_added":
      return { ...base, icon: <Bell size={ICON} />, tone: "brand", text: `Alert added: ${d.alert ?? "alert"}`, sub: d.summary };
    case "alert_edited":
      return { ...base, icon: <Pencil size={ICON} />, tone: "neutral", text: `Alert changed: ${d.alert ?? "alert"}`, sub: d.summary };
    case "alert_removed":
      return { ...base, icon: <Trash2 size={ICON} />, tone: "neutral", text: `Alert removed: ${d.alert ?? "alert"}` };
    case "alert_on":
      return { ...base, icon: <BellRing size={ICON} />, tone: "good", text: `Alert turned on: ${d.alert ?? "alert"}` };
    case "alert_off":
      return { ...base, icon: <BellOff size={ICON} />, tone: "neutral", text: `Alert turned off: ${d.alert ?? "alert"}` };
    case "paused":
      return { ...base, icon: <PauseCircle size={ICON} />, tone: "neutral", text: "Paused by you" };
    case "live":
      return {
        ...base,
        icon: <PlayCircle size={ICON} />,
        tone: "good",
        text: "Taken live",
        sub:
          d.reason && d.reason !== "manual"
            ? `Was paused: ${PAUSE_COPY[d.reason as PausedReason]?.badge ?? d.reason}`
            : null,
      };
    case "auto_paused":
      return {
        ...base,
        icon: <Timer size={ICON} />,
        tone: d.reason === "inactive" || d.reason === "schedule" ? "warn" : "bad",
        text: autoPauseText(d.reason, d.hours, d.failures),
      };
    case "manual_check":
      return {
        ...base,
        icon: <RefreshCw size={ICON} />,
        tone: "neutral",
        text: "Checked now",
        sub:
          d.found === undefined
            ? null
            : `${d.found} crossing${d.found === 1 ? "" : "s"} found, ${d.newCrossings ?? 0} new`,
      };
    case "settings_changed":
      return {
        ...base,
        icon: <Settings2 size={ICON} />,
        tone: "neutral",
        text: "Settings changed",
        sub: d.changes?.join(", ") ?? null,
      };
    case "deleted":
      return {
        ...base,
        icon: <Trash2 size={ICON} />,
        tone: "bad",
        text: "Deleted from My trucks",
        sub: "Alerts and settings removed; crossings and history kept",
      };
    default:
      return { ...base, icon: <Settings2 size={ICON} />, tone: "neutral", text: String(row.kind).replace(/_/g, " ") };
  }
}

function fromAlertLog(log: AlertLog): Item {
  const kind = log.kind ?? "";
  const halt = kind === "halt";
  const moving = halt && /moving again/i.test(log.title);
  const system = kind.startsWith("tracking_");
  return {
    key: `l${log.id}`,
    at: log.created_at,
    icon: moving ? <PlayCircle size={ICON} /> : halt ? <Octagon size={ICON} /> : system ? <TriangleAlert size={ICON} /> : <MapPin size={ICON} />,
    tone: moving ? "good" : halt ? "warn" : system ? "bad" : "brand",
    text: log.title,
    sub: log.message,
    badge: log.delivered ? null : <Badge tone="warn">not sent</Badge>,
  };
}

/** One line per IST day: how many checks this truck had, and what they cost. */
function fromLedger(rows: LedgerDay[]): Item[] {
  const days = new Map<string, { auto: number; manual: number; refunds: number; credits: number; at: string }>();
  for (const row of rows) {
    const day = days.get(row.ist_date) ?? { auto: 0, manual: 0, refunds: 0, credits: 0, at: row.last_at };
    if (row.reason === "auto_check") day.auto += Number(row.entries);
    else if (row.reason === "manual_search") day.manual += Number(row.entries);
    else if (row.reason === "search_refund") day.refunds += Number(row.entries);
    else continue;
    day.credits += Number(row.credits);
    if (row.last_at > day.at) day.at = row.last_at;
    days.set(row.ist_date, day);
  }
  return [...days.entries()].map(([date, day]) => {
    const parts = [
      day.auto ? `${day.auto} automatic check${day.auto === 1 ? "" : "s"}` : null,
      day.manual ? `${day.manual} manual check${day.manual === 1 ? "" : "s"}` : null,
      day.refunds ? `${day.refunds} refund${day.refunds === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    const used = Math.max(-day.credits, 0);
    return {
      key: `c${date}`,
      at: day.at,
      icon: <Coins size={ICON} />,
      tone: "neutral" as const,
      text: `Checks: ${parts.join(", ")}`,
      sub: `${formatCredits(used)} credit${used === 1 ? "" : "s"} used that day`,
    };
  });
}

/**
 * The truck page's Activity tab: one timeline merged from four records -
 * truck_activity (what you and the platform did to the truck, 0072),
 * alert_logs (every alert raised: halt, still halted, moving again, failing
 * checks, auto-pause notices), and credit_ledger_daily (checks and their cost,
 * one line per day). Newest first; the older part folds away.
 */
export function TruckActivityTimeline({
  activity,
  alertLogs,
  ledger,
}: {
  activity: TruckActivity[];
  alertLogs: AlertLog[];
  ledger: LedgerDay[];
}) {
  const own = activity.map(fromActivity);

  /* An automatic pause writes both a history row and the alert that told you;
     show it once. */
  const pauseTimes = activity
    .filter((row) => row.kind === "auto_paused")
    .map((row) => new Date(row.created_at).getTime());
  const logs = alertLogs
    .filter((log) => {
      if (!(log.kind ?? "").startsWith("tracking_paused")) return true;
      const at = new Date(log.created_at).getTime();
      return !pauseTimes.some((time) => Math.abs(time - at) < 10 * 60_000);
    })
    .map(fromAlertLog);

  const items = [...own, ...logs, ...fromLedger(ledger)].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  if (items.length === 0) {
    return <p className="truck-section-hint">Nothing recorded for this truck yet.</p>;
  }

  const first = items.slice(0, VISIBLE);
  const rest = items.slice(VISIBLE);

  return (
    <>
      <TimelineList items={first} />
      {rest.length > 0 ? (
        <Disclosure title={`Older activity (${rest.length})`} bodyClassName="px-3 py-2" className="truck-timeline-more">
          <TimelineList items={rest} />
        </Disclosure>
      ) : null}
    </>
  );
}

function TimelineList({ items }: { items: Item[] }) {
  return (
    <ol className="truck-timeline">
      {items.map((item) => (
        <li key={item.key} className="truck-timeline-item">
          <span aria-hidden className={cx("truck-timeline-icon", `is-${item.tone}`)}>
            {item.icon}
          </span>
          <div className="truck-timeline-text">
            <p className="truck-timeline-title">
              {item.text} {item.badge}
            </p>
            {item.sub ? <p className="truck-timeline-sub">{item.sub}</p> : null}
          </div>
          <time dateTime={item.at} className="truck-timeline-time" title={fmtAgo(item.at)}>
            {fmtWhen(item.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
