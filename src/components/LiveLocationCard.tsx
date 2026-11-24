"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, ExternalLink, Loader2, MapPin, MessageCircle, Navigation, RefreshCw, UserPlus, XCircle } from "lucide-react";

import { Badge, Panel, buttonClass, type BadgeTone } from "@/components/ui";
import { useCopy } from "@/components/useCopy";
import {
  REPORT_EVERY_MS,
  agoText,
  googleMapsHref,
  osmEmbedSrc,
  type LiveLocationView,
  type LiveState,
} from "@/lib/live-location-shared";

/**
 * "Live location" card for the truck page (migration 0078).
 *
 * Self-contained: it reads /api/live-location/<truckId> on mount and every
 * 30 s while the tab is visible, and posts invite / revoke to the same route.
 * Nothing here calls router.refresh(), so the rest of the truck page is never
 * re-rendered by the poll.
 *
 * Mount: <LiveLocationCard truckId={truck.id} truckNumber={truck.truck_number}
 *        ownerLabel={profile.office || profile.full_name} />
 */

const STATE_BADGE: Record<LiveState, { tone: BadgeTone; text: string }> = {
  none: { tone: "neutral", text: "Not shared" },
  invited: { tone: "warn", text: "Invited" },
  live: { tone: "good", text: "Live" },
  recent: { tone: "neutral", text: "Not live" },
  stopped: { tone: "neutral", text: "Stopped by driver" },
};

export function LiveLocationCard({
  truckId,
  truckNumber,
  ownerLabel,
  initial,
}: {
  truckId: string;
  truckNumber: string;
  /** Prefills "Shown to driver as". Usually the profile's office or full name. */
  ownerLabel?: string | null;
  /** Optional server-loaded first state (loadLiveLocation), to skip the first fetch. */
  initial?: LiveLocationView | null;
}) {
  const [view, setView] = useState<LiveLocationView | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"invite" | "revoke" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const { copied, problem, copy } = useCopy();
  const inFlight = useRef(false);

  const endpoint = `/api/live-location/${encodeURIComponent(truckId)}`;

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) {
        setLoadError(res.status === 401 ? "Please sign in again." : "Could not load live location.");
        return;
      }
      setView((await res.json()) as LiveLocationView);
      setLoadError(null);
    } catch {
      setLoadError("Could not load live location.");
    } finally {
      inFlight.current = false;
    }
  }, [endpoint]);

  // First read, then every 30 s while visible; an immediate read on return.
  useEffect(() => {
    if (!initial) void load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer) clearInterval(timer);
      timer = document.visibilityState === "visible" ? setInterval(() => void load(), REPORT_EVERY_MS) : null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function act(body: Record<string, unknown>, kind: "invite" | "revoke") {
    setBusy(kind);
    setActionError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as (LiveLocationView & { error?: string }) | null;
      if (!res.ok || !data || data.error) {
        setActionError(data?.error ?? "Something went wrong. Please try again.");
        return false;
      }
      setView(data);
      return true;
    } catch {
      setActionError("No connection. Please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await act(
      {
        action: "invite",
        driverName: String(form.get("driverName") ?? ""),
        phone: String(form.get("phone") ?? ""),
        ownerLabel: String(form.get("ownerLabel") ?? ""),
      },
      "invite",
    );
    if (ok) setInviting(false);
  }

  async function onRevoke() {
    const ok = await act({ action: "revoke" }, "revoke");
    if (ok) setConfirmRevoke(false);
  }

  const state: LiveState = view?.state ?? "none";
  const badge = STATE_BADGE[state];
  const driver = view?.driver ?? null;
  const latest = view?.latest ?? null;
  const now = view ? new Date(view.now).getTime() : Date.now();

  const badgeNode = view ? (
    <Badge tone={badge.tone}>
      {state === "live" ? <span className="inline-block size-1.5 animate-pulse rounded-full bg-good-500" /> : null}
      {state === "recent" && driver?.last_seen_at ? `Last seen ${agoText(driver.last_seen_at, now)}` : badge.text}
    </Badge>
  ) : null;

  return (
    <Panel
      title="Live location"
      description={`From the driver's phone, for ${truckNumber}. Free.`}
      actions={badgeNode}
    >
      {!view ? (
        loadError ? (
          <p className="text-sm text-bad-500">{loadError}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Loading...
          </p>
        )
      ) : !view.available ? (
        <p className="text-sm text-muted">Live location is not switched on yet. It will appear here soon.</p>
      ) : (
        <div className="space-y-4">
          {/* Who */}
          {driver ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-strong">{driver.driver_name || "Driver"}</p>
                <p className="font-mono text-xs text-muted">{driver.phone_masked ?? "No phone - link copied by hand"}</p>
              </div>
              <p className="text-xs text-muted">
                {state === "invited"
                  ? `Invited ${agoText(driver.created_at, now)} - waiting for the driver to open the link`
                  : driver.last_seen_at
                    ? `Last update ${agoText(driver.last_seen_at, now)}`
                    : null}
              </p>
            </div>
          ) : !inviting ? (
            <p className="text-sm text-muted">
              Ask the driver to share his phone&apos;s location. He gets a link on WhatsApp, opens it and taps Start -
              no app to install. You see the truck here, updated every 30 seconds while his page is open.
            </p>
          ) : null}

          {/* Where */}
          {latest ? (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-xl border border-line">
                <iframe
                  key={`${latest.lat},${latest.lng}`}
                  title={`Map: ${truckNumber}`}
                  src={osmEmbedSrc(latest.lat, latest.lng)}
                  className="block h-56 w-full sm:h-64"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-muted">
                  At <span className="font-semibold text-strong">{agoText(latest.recorded_at, now)}</span>
                </span>
                <span className="text-muted">
                  Speed{" "}
                  <span className="font-semibold text-strong">
                    {latest.speed_kmh != null ? `${Math.round(latest.speed_kmh)} km/h` : "--"}
                  </span>
                </span>
                <span className="text-muted">
                  Accuracy{" "}
                  <span className="font-semibold text-strong">
                    {latest.accuracy_m != null ? `± ${Math.round(latest.accuracy_m)} m` : "--"}
                  </span>
                </span>
                <a
                  href={googleMapsHref(latest.lat, latest.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-brand-500 hover:underline"
                >
                  <Navigation size={14} aria-hidden /> Open in Google Maps <ExternalLink size={12} aria-hidden />
                </a>
              </div>
              {view.trail.length > 1 ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">
                    Last 2 hours ({view.trail.length} positions)
                  </summary>
                  <ul className="mt-2 max-h-56 space-y-1 overflow-auto pr-1">
                    {view.trail.slice(0, 40).map((p) => (
                      <li key={p.recorded_at} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted">
                          {new Date(p.recorded_at).toLocaleTimeString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          {p.speed_kmh != null ? ` · ${Math.round(p.speed_kmh)} km/h` : ""}
                        </span>
                        <a
                          href={googleMapsHref(p.lat, p.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-brand-500 hover:underline"
                        >
                          {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : driver && state !== "invited" ? (
            <p className="text-sm text-muted">No position received yet.</p>
          ) : null}

          {state === "recent" || state === "stopped" ? (
            <p className="text-xs text-muted">
              {state === "stopped"
                ? "The driver tapped Stop. Ask him to open the link and tap Start again."
                : "The driver's page is closed or the phone is locked. Updates resume when he opens the link again."}
            </p>
          ) : null}

          {/* Invite form */}
          {inviting ? (
            <form onSubmit={onInvite} className="space-y-3 rounded-xl border border-line bg-sunken p-3">
              <label className="block text-sm">
                <span className="font-semibold text-strong">Driver name</span>{" "}
                <span className="text-xs text-muted">(optional)</span>
                <input
                  name="driverName"
                  maxLength={80}
                  autoComplete="off"
                  defaultValue={driver?.driver_name ?? ""}
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-[15px] text-ink"
                />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-strong">Driver&apos;s mobile</span>
                <div className="mt-1 flex">
                  <span
                    aria-hidden
                    className="inline-flex shrink-0 items-center rounded-l-lg border border-r-0 border-line bg-raised px-3 font-mono text-sm text-muted"
                  >
                    +91
                  </span>
                  <input
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    pattern="[6-9][0-9]{9}"
                    title="Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9."
                    placeholder="9876543210"
                    required
                    className="block w-full rounded-r-lg border border-line bg-panel px-3 py-2 font-mono text-[15px] tracking-wider text-ink"
                  />
                </div>
                <span className="mt-1 block text-xs text-muted">Only you can see this number.</span>
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-strong">Shown to the driver as</span>
                <input
                  name="ownerLabel"
                  maxLength={80}
                  required
                  defaultValue={driver?.owner_label ?? ownerLabel ?? ""}
                  placeholder="Your company or name"
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-[15px] text-ink"
                />
                <span className="mt-1 block text-xs text-muted">
                  The driver&apos;s page shows only this name and the truck number.
                </span>
              </label>
              {driver ? (
                <p className="text-xs text-warn-500">A new link replaces the current one; the old link stops working.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy !== null} className={buttonClass("primary", "sm")}>
                  {busy === "invite" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <UserPlus size={14} aria-hidden />}
                  Create link
                </button>
                <button type="button" onClick={() => setInviting(false)} className={buttonClass("ghost", "sm")}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {/* Actions */}
          {!inviting ? (
            driver ? (
              <div className="flex flex-wrap gap-2">
                {driver.wa_href ? (
                  <a
                    href={driver.wa_href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClass(state === "invited" ? "primary" : "secondary", "sm")}
                  >
                    <MessageCircle size={14} aria-hidden /> {state === "invited" ? "Send on WhatsApp" : "Resend on WhatsApp"}
                  </a>
                ) : null}
                <button type="button" onClick={() => void copy(driver.link)} className={buttonClass("secondary", "sm")}>
                  <Copy size={14} aria-hidden /> {copied === driver.link ? "Copied" : "Copy link"}
                </button>
                <button type="button" onClick={() => setInviting(true)} className={buttonClass("ghost", "sm")}>
                  <RefreshCw size={14} aria-hidden /> New link
                </button>
                {confirmRevoke ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void onRevoke()}
                      className={buttonClass("danger", "sm")}
                    >
                      {busy === "revoke" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <XCircle size={14} aria-hidden />}
                      Yes, stop sharing
                    </button>
                    <button type="button" onClick={() => setConfirmRevoke(false)} className={buttonClass("ghost", "sm")}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmRevoke(true)} className={buttonClass("danger", "sm")}>
                    <XCircle size={14} aria-hidden /> Stop sharing
                  </button>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setInviting(true)} className={buttonClass("primary", "sm")}>
                <MapPin size={14} aria-hidden /> Invite driver
              </button>
            )
          ) : null}

          {problem ? <p className="text-xs text-warn-500">{problem}</p> : null}
          {driver && copied !== driver.link && !problem ? (
            <p className="truncate font-mono text-[11px] text-faint" title={driver.link}>
              {driver.link}
            </p>
          ) : null}
          {actionError ? <p className="text-sm text-bad-500">{actionError}</p> : null}
          {loadError && view ? <p className="text-xs text-warn-500">{loadError} Showing the last known state.</p> : null}
        </div>
      )}
    </Panel>
  );
}
