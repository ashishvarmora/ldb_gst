"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Megaphone, X } from "lucide-react";

import { markAnnouncements } from "@/app/portal/announcement-actions";
import { buttonClass, cx } from "@/components/ui";
import type { AnnouncementTone, VisibleAnnouncement } from "@/lib/announcement-rules";

/**
 * What the desk is telling this customer: banners under the header, and at
 * most one popup at a time.
 *
 * The server has already decided what applies - audience, window, and the
 * once/daily/always rules against what this customer has seen (see
 * loadAnnouncementsFor). The one rule it cannot apply is 'session', "each time
 * the app is opened", because only the browser knows what an opening is. That
 * is sessionStorage here: it lives exactly as long as the tab or the app's
 * WebView, which is the definition wanted.
 *
 * Everything this reports back - seen, closed, tapped - is fire-and-forget. A
 * customer should never wait on, or see an error from, a stats write.
 */

const SESSION_KEY = "rahdari-announcements-done";

function readSessionDone(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    // Private mode, a blocked storage, a WebView with it switched off: show
    // everything, which is the safe direction to be wrong in.
    return new Set();
  }
}

function writeSessionDone(done: Set<string>): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify([...done]));
  } catch {
    /* see readSessionDone */
  }
}

const BANNER_TONES: Record<AnnouncementTone, string> = {
  info: "border-brand-500/25 bg-brand-500/10 text-ink",
  offer: "border-brand-600 bg-brand-500 text-on-brand",
  success: "border-good-500/30 bg-good-500/12 text-ink",
  warning: "border-warn-500/35 bg-warn-500/12 text-ink",
};

const ICON_TONES: Record<AnnouncementTone, string> = {
  info: "text-brand-500",
  offer: "text-on-brand",
  success: "text-good-500",
  warning: "text-warn-500",
};

function isExternal(url: string): boolean {
  return !url.startsWith("/");
}

export function Announcements({ items }: { items: VisibleAnnouncement[] }) {
  /*
   * Hidden on this page: closed, tapped, or a non-closable popup acknowledged.
   * Starts empty and is filled from sessionStorage after mount, so the server
   * render and the first client render agree - and so for one frame a
   * 'session' item already seen this session might be in the tree. It is not
   * drawn until `ready`, which is the reason that flag exists.
   */
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [ready, setReady] = useState(false);
  const reported = useRef<Set<string>>(new Set());

  useEffect(() => {
    const sessionDone = readSessionDone();
    const sessionIds = items.filter((i) => i.frequency === "session").map((i) => i.id);
    // Merged, not replaced: a refresh hands over a new `items` array, and what
    // the customer closed a moment ago must stay closed while the server
    // catches up with the write.
    setHidden((prev) => {
      const next = new Set(prev);
      for (const id of sessionIds) if (sessionDone.has(id)) next.add(id);
      return next;
    });
    setReady(true);
  }, [items]);

  const visible = useMemo(
    () => (ready ? items.filter((i) => !hidden.has(i.id)) : []),
    [items, hidden, ready],
  );
  const banners = visible.filter((i) => i.show_banner);
  // One popup at a time; the next appears once this one is closed.
  const popup = visible.find((i) => i.show_popup) ?? null;

  const shownIds = useMemo(
    () => [...new Set([...banners.map((b) => b.id), ...(popup ? [popup.id] : [])])],
    [banners, popup],
  );
  const shownKey = shownIds.join(",");

  // Report each one once per mount, the first time it is actually on screen.
  useEffect(() => {
    const fresh = shownIds.filter((id) => !reported.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) reported.current.add(id);

    // A non-closable 'session' item is finished for this opening once seen.
    const sessionSeen = items
      .filter((i) => fresh.includes(i.id) && i.frequency === "session" && !i.dismissible)
      .map((i) => i.id);
    if (sessionSeen.length > 0) {
      const done = readSessionDone();
      for (const id of sessionSeen) done.add(id);
      writeSessionDone(done);
    }

    void markAnnouncements(fresh, "seen").catch(() => {});
    // shownKey stands in for shownIds, which is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  function finish(item: VisibleAnnouncement, kind: "dismissed" | "clicked" | "acknowledged") {
    setHidden((prev) => new Set(prev).add(item.id));
    if (item.frequency === "session") {
      const done = readSessionDone();
      done.add(item.id);
      writeSessionDone(done);
    }
    if (kind !== "acknowledged") void markAnnouncements([item.id], kind).catch(() => {});
  }

  if (!ready || (banners.length === 0 && !popup)) return null;

  return (
    <>
      {banners.length > 0 ? (
        <div className="flex flex-col">
          {banners.slice(0, 3).map((item) => (
            <div
              key={item.id}
              role="status"
              className={cx("flex items-start gap-2.5 border-b px-4 py-2 text-sm", BANNER_TONES[item.tone])}
            >
              <Megaphone size={15} className={cx("mt-0.5 shrink-0", ICON_TONES[item.tone])} />
              <div className="min-w-0 flex-1 break-words">
                <span className="font-semibold">{item.title}</span>
                {item.body ? <span className="opacity-90"> — {item.body}</span> : null}
                {item.cta_url && item.cta_label ? (
                  <>
                    {" "}
                    <Cta item={item} onClick={() => finish(item, "clicked")} variant="link" />
                  </>
                ) : null}
              </div>
              {item.dismissible ? (
                <button
                  type="button"
                  onClick={() => finish(item, "dismissed")}
                  aria-label="Close"
                  className="-my-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-lg opacity-70 transition hover:opacity-100"
                >
                  <X size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {popup ? <Popup item={popup} onFinish={(kind) => finish(popup, kind)} /> : null}
    </>
  );
}

function Cta({
  item,
  onClick,
  variant,
}: {
  item: VisibleAnnouncement;
  onClick: () => void;
  variant: "link" | "button";
}) {
  const url = item.cta_url ?? "/portal";
  const className =
    variant === "link"
      ? "font-semibold whitespace-nowrap underline underline-offset-2"
      : buttonClass("primary", "md", "w-full sm:w-auto");

  return isExternal(url) ? (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={onClick} className={className}>
      {item.cta_label}
      {variant === "button" ? <ExternalLink size={14} /> : null}
    </a>
  ) : (
    <Link href={url} onClick={onClick} className={className}>
      {item.cta_label}
    </Link>
  );
}

/**
 * A bottom sheet on a phone, a centred card on anything wider. Above the
 * portal's bottom tab bar (z-40) and clear of the phone's home indicator.
 *
 * No Escape handler and no backdrop tap for a popup that cannot be closed: the
 * admin chose that. It still has an "OK" - an announcement nobody can get out
 * of is a broken page, not a strong message - but OK records nothing, so a
 * 'once' that cannot be closed has been seen and will not return, and an
 * 'always' will be back on the next full load.
 */
function Popup({
  item,
  onFinish,
}: {
  item: VisibleAnnouncement;
  onFinish: (kind: "dismissed" | "clicked" | "acknowledged") => void;
}) {
  const close = () => onFinish(item.dismissible ? "dismissed" : "acknowledged");

  useEffect(() => {
    if (!item.dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFinish("dismissed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [item.dismissible, onFinish]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="fixed inset-0 bg-strong/30 backdrop-blur-sm"
        onClick={item.dismissible ? close : undefined}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`ann-${item.id}`}
        className="animate-in relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel px-5 pt-5 pb-[max(1.25rem,var(--sab))] [box-shadow:var(--shadow-pop)] sm:max-w-md sm:rounded-2xl sm:pb-5"
      >
        <div className="flex items-start gap-3">
          <span
            className={cx(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-xl",
              item.tone === "offer" ? "bg-brand-500 text-on-brand" : "bg-sunken",
              item.tone === "offer" ? null : ICON_TONES[item.tone],
            )}
          >
            <Megaphone size={17} />
          </span>
          <h2 id={`ann-${item.id}`} className="min-w-0 flex-1 pt-1.5 text-base font-semibold break-words text-strong">
            {item.title}
          </h2>
          {item.dismissible ? (
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mt-1 -mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>

        {item.body ? (
          <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-line text-ink">{item.body}</p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={close} className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
            {item.cta_url ? "Not now" : "OK"}
          </button>
          {item.cta_url && item.cta_label ? (
            <Cta item={item} onClick={() => onFinish("clicked")} variant="button" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
