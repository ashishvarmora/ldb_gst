"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { markAlertsRead } from "@/app/portal/notifications/actions";
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
  alerts,
  unreadCount,
}: {
  alerts: AlertBellItem[];
  unreadCount: number;
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
  const wrapRef = useRef<HTMLDivElement>(null);

  const badge = seen ? 0 : unreadCount;
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    // The layout stays mounted across navigations, so the optimistic "already
    // seen" has to be dropped once the server agrees - otherwise the badge
    // would never light up again for the rest of the session.
    if (unreadCount === 0) setSeen(false);
  }, [unreadCount]);

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

    setFresh(alerts.filter((alert) => alert.read_at === null).map((alert) => alert.id));
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
          <header className="flex items-baseline justify-between gap-2 border-b border-line/70 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Alerts</h2>
            {alerts.length > 0 ? (
              <span className="text-[11px] text-faint">newest {alerts.length}</span>
            ) : null}
          </header>

          {alerts.length === 0 ? (
            <EmptyState
              title="No alerts yet"
              description="Switch an alert on for a truck and anything it reports shows up here."
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
