import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Plus, Route, Search, X } from "lucide-react";

import { cx } from "@/components/ui";
import { loadPlaces, placeMap, requireLiveSession, searchTrips, tripCounts } from "@/lib/live/server";
import { STATE_LABEL, TRIP_STATES, istDayStart, istDayStartOf, type TripDirection, type TripState } from "@/lib/live/shared";

import { InfoTip, TripCard } from "./parts";
import { AutoRefresh } from "./widgets";

/**
 * v7 trips board - one direction per page (/live/sending, /live/receiving).
 *
 * v4-v6 drew both directions on one page and hid one of them on phones with a
 * utility class; a stylesheet rule overrode that, so phones showed both lists
 * under two tabs that did nothing. Each direction is now its own page with its
 * own URL, so there is nothing to hide: the switch at the top is navigation.
 *
 * Params (unprefixed now that a page has one list):
 *   s status (all | planned | active | done | cancelled)
 *   d date (today | 7 | custom), f / t custom from / to (YYYY-MM-DD, IST)
 *   q search, p page
 */

export type BoardParams = Record<string, string | undefined>;

const PAGE = 20;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEEP = ["s", "d", "f", "t", "q", "p"];

export const BOARD_PATH: Record<TripDirection, string> = { outgoing: "/live/sending", incoming: "/live/receiving" };

function clean(raw: Record<string, string | string[] | undefined>): BoardParams {
  const sp: BoardParams = {};
  for (const k of KEEP) {
    const v = raw[k];
    if (typeof v === "string" && v) sp[k] = v.slice(0, 60);
  }
  return sp;
}

function range(sp: BoardParams, now: number): { from: string | null; to: string | null; label: string | null } {
  if (sp.d === "today") return { from: istDayStart(now), to: null, label: "Today" };
  if (sp.d === "7") return { from: new Date(now - 7 * 86_400_000).toISOString(), to: null, label: "7 days" };
  if (sp.d === "custom") {
    const f = DAY_RE.test(sp.f ?? "") ? sp.f! : null;
    const t = DAY_RE.test(sp.t ?? "") ? sp.t! : null;
    return {
      from: f ? istDayStartOf(f) : null,
      to: t ? new Date(Date.parse(istDayStartOf(t)) + 86_400_000).toISOString() : null,
      label: f || t ? `${f ?? "…"} → ${t ?? "…"}` : null,
    };
  }
  return { from: null, to: null, label: null };
}

function Hidden({ sp, except }: { sp: BoardParams; except: string[] }) {
  return (
    <>
      {Object.entries(sp)
        .filter(([k, v]) => v && !except.includes(k))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
    </>
  );
}

const TONE: Record<TripState, string> = { planned: "neutral", active: "brand", done: "good", cancelled: "bad" };

export async function TripBoard({ dir, searchParams }: { dir: TripDirection; searchParams: Record<string, string | string[] | undefined> }) {
  const sp = clean(searchParams);
  const base = BOARD_PATH[dir];
  const href = (patch: BoardParams) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const { ownerId } = await requireLiveSession();
  const now = Date.now();
  const status = (TRIP_STATES as string[]).includes(sp.s ?? "") ? (sp.s as TripState) : "all";
  const q = (sp.q ?? "").slice(0, 40);
  const page = Math.max(0, Number(sp.p) || 0);
  const r = range(sp, now);

  const [{ rows, more }, places, counts] = await Promise.all([
    searchTrips(ownerId, { status, q, from: r.from, to: r.to, direction: dir, page, pageSize: PAGE }),
    loadPlaces(ownerId, { includeArchived: true }).then(placeMap),
    tripCounts(ownerId),
  ]);
  const mine = counts[dir];
  const sending = dir === "outgoing";
  const Icon = sending ? ArrowUpRight : ArrowDownLeft;
  const filtered = status !== "all" || r.label || q;
  const reset = { p: undefined };
  const openOf = (d: TripDirection) => counts[d].planned + counts[d].active;

  return (
    <div className="live-page mx-auto max-w-3xl space-y-3">
      <AutoRefresh ms={45_000} />

      <header className="lv-board-head">
        <span className={cx("lv-board-icon", sending ? "is-out" : "is-in")} aria-hidden>
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h1>{sending ? "Sending" : "Receiving"}</h1>
          <p>
            {sending ? "Trucks we dispatch" : "Trucks coming to us"} ·{" "}
            <Link href="/live/today" className="font-semibold text-brand-600">
              Today
            </Link>
          </p>
        </div>
        <InfoTip label={sending ? "About Sending" : "About Receiving"}>
          {sending
            ? "Trips you dispatch: driver and truck come from your Masters. Newest first. Tap a trip for map, timeline, links and documents."
            : "Trips a supplier or dealer sends to you. Driver, truck and From are typed on the trip only and never added to your Masters. Newest first."}
        </InfoTip>
        <Link href={`/live/trips/new${sending ? "" : "?dir=incoming"}`} className="live-new-btn" aria-label={sending ? "New sending trip" : "New receiving trip"}>
          <Plus size={20} />
        </Link>
      </header>

      <nav className="lv-seg" aria-label="Direction">
        {(["outgoing", "incoming"] as const).map((d) => {
          const DIcon = d === "outgoing" ? ArrowUpRight : ArrowDownLeft;
          return (
            <Link key={d} href={BOARD_PATH[d]} aria-current={d === dir ? "page" : undefined}>
              <DIcon size={14} /> {d === "outgoing" ? "Sending" : "Receiving"}
              {openOf(d) ? <span className="lv-seg-n">{openOf(d)}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="lv-toolbar">
        <div className="lv-stchips" role="list">
          {(["all", ...TRIP_STATES] as const).map((s) => (
            <Link
              key={s}
              role="listitem"
              href={href({ s: s === "all" ? undefined : s, ...reset })}
              aria-current={status === s ? "true" : undefined}
              className={cx("lv-stchip", s !== "all" && `lv-t-${TONE[s]}`)}
            >
              {s === "all" ? "All" : STATE_LABEL[s]}
              <b>{mine[s]}</b>
            </Link>
          ))}
        </div>
        <div className="live-filters">
          <details name="board-filter">
            <summary aria-label="Date filter" data-on={r.label ? true : undefined}>
              <CalendarDays size={16} />
            </summary>
            <div className="live-filter-pop">
              <p className="live-filter-label">Created</p>
              <div className="live-chips">
                {[
                  { v: undefined, label: "Any time" },
                  { v: "today", label: "Today" },
                  { v: "7", label: "7 days" },
                ].map((d) => (
                  <Link key={d.label} href={href({ d: d.v, f: undefined, t: undefined, ...reset })} className={cx("live-chip-filter", sp.d === d.v && "is-on")}>
                    {d.label}
                  </Link>
                ))}
              </div>
              <form action={base} className="live-date-range">
                <Hidden sp={sp} except={["d", "f", "t", "p"]} />
                <input type="hidden" name="d" value="custom" />
                <label>
                  <span>From</span>
                  <input type="date" name="f" defaultValue={sp.f ?? ""} className="field" />
                </label>
                <label>
                  <span>To</span>
                  <input type="date" name="t" defaultValue={sp.t ?? ""} className="field" />
                </label>
                <button type="submit" className="live-btn-sm live-btn-brand">
                  Apply
                </button>
              </form>
            </div>
          </details>
          <details name="board-filter" open={Boolean(q) || undefined}>
            <summary aria-label="Search" data-on={q ? true : undefined}>
              <Search size={16} />
            </summary>
            <div className="live-filter-pop">
              <form action={base} className="live-search">
                <Hidden sp={sp} except={["q", "p"]} />
                <Search size={15} aria-hidden />
                <input name="q" defaultValue={q} placeholder="Trip, driver, truck, place, invoice, e-way" aria-label="Search trips" enterKeyHint="search" />
              </form>
            </div>
          </details>
        </div>
      </div>

      {r.label || q ? (
        <p className="live-active-filters">
          {r.label ? (
            <Link href={href({ d: undefined, f: undefined, t: undefined, ...reset })}>
              {r.label} <X size={11} />
            </Link>
          ) : null}
          {q ? (
            <Link href={href({ q: undefined, ...reset })}>
              “{q}” <X size={11} />
            </Link>
          ) : null}
        </p>
      ) : null}

      {rows.length ? (
        <div className="lv-list">
          {rows.map((t) => (
            <TripCard key={t.id} trip={t} places={places} now={now} />
          ))}
        </div>
      ) : (
        <div className="live-side-empty">
          <Route size={18} />
          <p>{filtered ? "Nothing matches these filters." : sending ? "No trips sent yet." : "No trips coming in yet."}</p>
          <Link href={`/live/trips/new${sending ? "" : "?dir=incoming"}`} className="live-btn-sm">
            <Plus size={13} /> New trip
          </Link>
        </div>
      )}

      {page > 0 || more ? (
        <div className="flex justify-between gap-2">
          {page > 0 ? (
            <Link className="live-chip-filter" href={href({ p: page > 1 ? String(page - 1) : undefined })}>
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {more ? (
            <Link className="live-chip-filter" href={href({ p: String(page + 1) })}>
              Older →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
