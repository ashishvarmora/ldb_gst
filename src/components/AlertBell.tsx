"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck, MessageSquare } from "lucide-react";

import { clearAlerts, markAlertsRead } from "@/app/portal/notifications/actions";
import { Badge, EmptyState, Mono, cx } from "@/components/ui";
import { fmtRelative } from "@/lib/format";

/** The columns of alert_logs the bell actually renders. */
export type AlertBellItem = {
  id: number;
  title: string;
  truck_number: string | null;
  delivered: boolean;
  read_at: string | null;
  created_at: string;
};

/**
 * The only place alerts are read now that the Alerts page is gone, so the panel
 * carries enough history to be useful on its own - the newest rows the layout
 * hands it, not a teaser with a "see all" link to nowhere.
 *
 * `alerts` is rendered on the server and passed down whole, so opening the
 * panel is instant: someone checking why their phone buzzed should not wait on
 * a round trip.
 */
export function AlertBell({
  alerts: allAlerts,
  unreadCount,
  /**
   * Replies from the desk this customer has not opened.
   *
   * SHOWN IN THE PANEL, DELIBERATELY NOT IN THE BADGE.
   *
   * There is a Messages icon with its own count sitting immediately beside
   * this bell on a phone, and the sidebar carries the same count on a desktop.
   * Adding messages to this badge as well would put two red circles side by
   * side, both reading "1", for one message - which a reader counts as two
   * things waiting. The number stops meaning anything the moment it can be
   * double-counted.
   *
   * The row inside the panel stays: opening the bell to see what happened
   * should still tell you somebody wrote to you, and a row that is only ever
   * shown when it is non-empty costs nothing when there is nothing to say.
   *
   * It is not folded into alert_logs either. An alert is a thing the tracker
   * raised and a message is a person talking; one list meaning both is a list
   * nobody can act on.
   */
  unreadMessages = 0,
  messagesHref = "/portal/support",
}: {
  alerts: AlertBellItem[];
  unreadCount: number;
  unreadMessages?: number;
  messagesHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  /**
   * Which rows were unread at the moment the panel opened. Reading `read_at`
   * directly would make the highlight vanish under the reader's eyes as soon as
   * the refresh lands, which is exactly when they are trying to spot what is
   * new.
   */
  const [fresh, setFresh] = useState<number[]>([]);
  /** Optimistic empty, held until the server's own empty list arrives. */
  const [cleared, setCleared] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const badge = seen || cleared ? 0 : unreadCount;
  const alerts = cleared ? [] : allAlerts;
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    // The layout stays mounted across navigations, so the optimistic "already
    // seen" has to be dropped once the server agrees - otherwise the badge
    // would never light up again for the rest of the session.
    if (unreadCount === 0) setSeen(false);
  }, [unreadCount]);

  useEffect(() => {
    // Same bargain as `seen`: the layout outlives navigations, so once the
    // server hands back rows again the local empty must let go of them.
    if (allAlerts.length > 0) setCleared(false);
  }, [allAlerts]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  function toggle() {
    if (open) {
      close();
      return;
    }

    setFresh(allAlerts.filter((alert) => alert.read_at === null).map((alert) => alert.id));
    setOpen(true);

    if (unreadCount > 0 && !seen) {
      // Cleared straight away: waiting for the write would leave the badge
      // sitting on top of the alerts being read. If the write fails the count
      // simply comes back on the next page load.
      setSeen(true);
      markAlertsRead()
        .then(() => router.refresh())
        .catch(() => setSeen(false));
    }
  }

  return (
    /* No positioning below sm on purpose: the panel then anchors to the sticky
       header instead of the bell, which is what keeps it on screen when the
       bell sits well in from the right edge of a phone. */
    <div ref={wrapRef} className="sm:relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={badge > 0 ? `Alerts, ${badge} unread` : "Alerts"}
        className={cx(
          "relative inline-flex size-10 items-center justify-center rounded-lg border border-line bg-panel transition",
          open ? "bg-sunken text-ink" : "text-muted hover:bg-sunken hover:text-ink",
        )}
      >
        <Bell size={15} />
        {badge > 0 ? (
          <span className="absolute -top-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-500 px-1 text-[10px] font-semibold text-on-brand tabular-nums">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Alerts"
          /* Phone: a full-width sheet under the header, inset from both edges.
             Wider: a normal dropdown hanging off the bell. */
          className="animate-in absolute top-full right-4 left-4 z-50 mt-2 overflow-hidden rounded-xl border border-line bg-panel [box-shadow:var(--shadow-pop)] sm:right-0 sm:left-auto sm:w-88"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink">Alerts</h2>
            {alerts.length > 0 ? (
              /* Clearing hides these rows rather than deleting them - see
                 clearAlerts. Emptied optimistically because waiting on the
                 write would leave the reader tapping a list that is still
                 there; a failure puts it back on the next load. */
              <button
                type="button"
                onClick={() => {
                  setCleared(true);
                  clearAlerts()
                    .then(() => router.refresh())
                    .catch(() => setCleared(false));
                }}
                className="-mr-1.5 inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium text-muted transition hover:bg-sunken hover:text-ink"
              >
                <CheckCheck size={12} />
                Clear all
              </button>
            ) : null}
          </header>

          {/*
            MESSAGES SIT ABOVE THE ALERTS, and only when there are some.
            A person waiting on a reply outranks a truck that moved, and an
            empty row here every day would train everybody to ignore the panel.
            It is a link rather than a list: the conversation itself is one tap
            away and reproducing it in a dropdown would be a second place for
            the same thread to be half-read.
          */}
          {unreadMessages > 0 ? (
            <Link
              href={messagesHref}
              onClick={close}
              className="flex items-center gap-3 border-b border-divider bg-brand-500/[0.07] px-4 py-3 transition hover:bg-brand-500/[0.12]"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
                <MessageSquare size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">
                  {unreadMessages === 1 ? "1 new message" : `${unreadMessages} new messages`}
                </span>
                <span className="block text-xs text-muted">Tap to open the conversation</span>
              </span>
            </Link>
          ) : null}

          {alerts.length === 0 ? (
            <EmptyState
              title={unreadMessages > 0 ? "No truck alerts" : "Nothing yet"}
              description={
                unreadMessages > 0
                  ? "Nothing from the tracker. The message above is waiting for you."
                  : "Switch an alert on for a truck and anything it reports shows up here, along with replies from the team."
              }
            />
          ) : (
            // Capped short of the bottom tab bar, which paints over this.
            <ul className="max-h-[60vh] divide-y divide-divider overflow-y-auto overscroll-contain">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={cx("px-4 py-2.5", fresh.includes(alert.id) && "bg-brand-500/[0.07]")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm text-ink">{alert.title}</p>
                    {alert.delivered ? null : <Badge tone="warn">not sent</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-faint">
                    {alert.truck_number ? (
                      <>
                        <Mono>{alert.truck_number}</Mono> ·{" "}
                      </>
                    ) : null}
                    {fmtRelative(alert.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
