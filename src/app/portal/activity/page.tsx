import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, History as PageIcon, Search, Truck } from "lucide-react";

import { ActivityTimeline } from "@/components/ActivityTimeline";
import { RangeControl, UrlSelect } from "@/components/HistoryControls";
import { Figure, Segmented, SummaryLine, plural } from "@/components/HistoryUi";
import { Pager, pageCount, pageFromParam } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import { EmptyState, PageHeader, cx } from "@/components/ui";
import {
  SEARCHES_KEY,
  loadActivity,
  loadSearchDayEvents,
  loadTruckDayEvents,
  type ActivityMode,
  type Cell,
  type DayEvent,
} from "@/lib/credit-history";
import { formatCredits } from "@/lib/credits";
import { fmtTime } from "@/lib/format";
import { dayLabel, isIsoDay, parseHistoryRange, rangeLabel, rangeQuery } from "@/lib/history-range";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { LedgerLinks } from "../credits/LedgerNav";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Activity — ${brandName}` };
}

/**
 * Activity: what was checked, and what it found. Complements Credits (which
 * owns additions and the per-day statement); no credit additions here.
 *
 *   By day (default)  a header per day (auto/manual checks, credits used,
 *                     crossings found), one row per truck inside it; tap a
 *                     truck -> its events that day (checks, crossings found,
 *                     alerts sent, paused / live / auto-paused).
 *   By truck          one row per truck with range totals; tap -> its days;
 *                     tap a day -> that day's events.
 *
 * MANUAL SEARCHES of numbers you do not track are one pseudo-truck,
 * "Manual searches", in both views (its sub-line counts the numbers); opening
 * it lists each search with its number, time and result. A "Check now" on a
 * tracked truck is that truck's manual check, not part of this group.
 *
 * Failed manual searches are excluded everywhere (credit-history.ts). All
 * filters are in the URL; totals are summed by the database
 * (credit_ledger_daily) and only one day's events are ever read at a time.
 */

const BASE = "/portal/activity";
const DAYS_PAGE = 10;
const TRUCKS_PAGE = 25;

type Query = {
  view?: string;
  type?: string;
  truck?: string;
  range?: string;
  from?: string;
  to?: string;
  page?: string;
  /** By day: "<day>~<truck key>" of the open row. */
  open?: string;
  /** By truck: the open truck key, and the open day inside it. */
  t?: string;
  d?: string;
};

type Totals = { auto: number; manual: number; credits: number; crossings: number; numbers: Set<string> };
/** What a row prints: a cell, or a cell's sum over the range. */
type Figures = { key: string; auto: number; manual: number; credits: number; crossings: number; numbers: { size: number } };

function sum(cells: Cell[]): Totals {
  const out: Totals = { auto: 0, manual: 0, credits: 0, crossings: 0, numbers: new Set() };
  for (const cell of cells) {
    out.auto += cell.auto;
    out.manual += cell.manual;
    out.credits += cell.credits;
    out.crossings += cell.crossings;
    for (const number of cell.numbers.keys()) out.numbers.add(number);
  }
  out.credits = Math.round(out.credits * 100) / 100;
  return out;
}

/** "96 auto · 1 manual · 4 crossings" - zero parts left out. */
function countParts(t: Omit<Figures, "key">, isSearches: boolean): string[] {
  const parts: string[] = [];
  if (isSearches) {
    if (t.numbers.size > 0) parts.push(plural(t.numbers.size, "number"));
    if (t.manual > 0) parts.push(plural(t.manual, "search", "searches"));
  } else {
    if (t.auto > 0) parts.push(`${t.auto.toLocaleString("en-IN")} auto`);
    if (t.manual > 0) parts.push(`${t.manual.toLocaleString("en-IN")} manual`);
  }
  if (t.crossings > 0) parts.push(plural(t.crossings, "crossing"));
  return parts;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [{ overview }, params] = await Promise.all([requirePortalSession(), searchParams]);
  const admin = getSupabaseAdmin();

  const view: "day" | "truck" = params.view === "truck" ? "truck" : "day";
  const mode: ActivityMode = params.type === "auto" || params.type === "manual" ? params.type : "all";
  const range = parseHistoryRange(params, { fallback: "7d", allowAll: false, maxDays: 366 });
  const from = range.from!;
  const to = range.to!;
  const truck = params.truck?.trim() || null;

  const data = await loadActivity(admin, overview.id, { from, to, mode, truck });
  const truckSet = new Set(data.trucks.map((row) => row.number));
  const labelOf = new Map(data.trucks.map((row) => [row.number, row.label]));

  /* Every link keeps the filters; the page and the open rows are per link. */
  const filters: Record<string, string> = {
    ...(view === "truck" ? { view } : {}),
    ...(mode !== "all" ? { type: mode } : {}),
    ...(truck ? { truck } : {}),
    ...rangeQuery(range, "7d"),
  };
  const href = (patch: Record<string, string | null | undefined>) => {
    const search = new URLSearchParams(filters);
    for (const [key, value] of Object.entries(patch)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    const out = search.toString();
    return out ? `${BASE}?${out}` : BASE;
  };
  const without = (...keys: string[]) => {
    const copy = { ...filters };
    for (const key of keys) delete copy[key];
    return copy;
  };

  const totals = sum(data.cells);
  const hasSearches = data.cells.some((cell) => cell.key === SEARCHES_KEY);

  /* ---------------------------------------------------------------- events */
  async function eventsFor(key: string, day: string, cell: Cell | undefined) {
    const events: DayEvent[] =
      key === SEARCHES_KEY
        ? await loadSearchDayEvents(admin, overview.id, day, truckSet)
        : await loadTruckDayEvents(admin, overview.id, key, day, mode);
    const summary =
      key !== SEARCHES_KEY && cell && (cell.auto > 0 || cell.manual > 0)
        ? {
            title: [
              cell.auto > 0 ? plural(cell.auto, "auto check") : null,
              cell.manual > 0 ? plural(cell.manual, "manual check") : null,
            ]
              .filter(Boolean)
              .join(" · "),
            sub: [
              `${formatCredits(cell.credits)} credits used`,
              cell.firstAt && cell.lastAt ? `${fmtTime(cell.firstAt)} – ${fmtTime(cell.lastAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : null;
    return <ActivityTimeline summary={summary} events={events} />;
  }

  function rowTitle(key: string) {
    if (key === SEARCHES_KEY) {
      return (
        <span className="hrow-title">
          <Search size={13} aria-hidden className="hrow-title-icon" />
          Manual searches
        </span>
      );
    }
    const label = labelOf.get(key);
    return (
      <span className="hrow-title">
        <span className="hrow-plate">{key}</span>
        {label ? <span className="hrow-title-note"> · {label}</span> : null}
      </span>
    );
  }

  function TruckRow({ cell, open, link, children }: { cell: Figures; open: boolean; link: string; children?: ReactNode }) {
    const parts = countParts(cell, cell.key === SEARCHES_KEY);
    return (
      <li className={cx("hrow", open && "is-open")}>
        <Link href={link} scroll={false} className="hrow-head" aria-expanded={open}>
          <span className="hrow-text">
            {rowTitle(cell.key)}
            <span className="hrow-sub">
              {parts.length > 0 ? parts.map((part) => <span key={part}>{part}</span>) : <span>No checks</span>}
            </span>
          </span>
          <span className="hrow-end">
            <span className="hrow-amount">{formatCredits(cell.credits)}</span>
            <span className="hrow-unit">credits</span>
          </span>
          <ChevronDown size={16} aria-hidden className="hrow-chev" />
        </Link>
        {open ? children : null}
      </li>
    );
  }

  /* --------------------------------------------------------------- by day */
  let body: ReactNode = null;
  let pager: ReactNode = null;

  const order = (a: Figures, b: Figures) =>
    a.key === SEARCHES_KEY ? 1 : b.key === SEARCHES_KEY ? -1 : b.credits - a.credits || a.key.localeCompare(b.key);

  if (data.cells.length === 0) {
    body = (
      <div className="panel">
        <EmptyState title="No activity in this period" description={rangeLabel(range)} />
      </div>
    );
  } else if (view === "day") {
    const days = [...new Set(data.cells.map((cell) => cell.day))].sort((a, b) => (a < b ? 1 : -1));
    const pages = pageCount(days.length, DAYS_PAGE);
    const page = pageFromParam(params.page, pages);
    const visible = days.slice((page - 1) * DAYS_PAGE, page * DAYS_PAGE);
    const [openDay, openKey] = (params.open ?? "").split("~");

    const sections = await Promise.all(
      visible.map(async (day) => {
        const cells = data.cells.filter((cell) => cell.day === day).sort(order);
        const t = sum(cells);
        const rows = await Promise.all(
          cells.map(async (cell) => {
            const open = openDay === day && openKey === cell.key;
            return (
              <TruckRow
                key={cell.key}
                cell={cell}
                open={open}
                link={href({ page: page > 1 ? String(page) : null, open: open ? null : `${day}~${cell.key}` })}
              >
                {open ? await eventsFor(cell.key, day, cell) : null}
              </TruckRow>
            );
          }),
        );
        return (
          <section key={day} className="aday">
            <header className="aday-head">
              <span className="aday-text">
                <span className="aday-title">{dayLabel(day)}</span>
                <span className="aday-sub">
                  {[
                    t.auto > 0 ? `${t.auto.toLocaleString("en-IN")} auto` : null,
                    t.manual > 0 ? `${t.manual.toLocaleString("en-IN")} manual` : null,
                    t.crossings > 0 ? plural(t.crossings, "crossing") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="aday-credits">
                <strong>{formatCredits(t.credits)}</strong> credits
              </span>
            </header>
            <ul className="hrow-list is-inset">{rows}</ul>
          </section>
        );
      }),
    );
    body = <div className="aday-list">{sections}</div>;
    pager = (
      <Pager page={page} total={days.length} pageSize={DAYS_PAGE} noun="days" href={(next) => href({ page: next > 1 ? String(next) : null })} className="hist-pager" />
    );
  } else {
    /* ------------------------------------------------------------ by truck */
    const keys = [...new Set(data.cells.map((cell) => cell.key))];
    const rows = keys.map((key) => ({ key, ...sum(data.cells.filter((cell) => cell.key === key)) })).sort(order);
    const pages = pageCount(rows.length, TRUCKS_PAGE);
    const page = pageFromParam(params.page, pages);
    const visible = rows.slice((page - 1) * TRUCKS_PAGE, page * TRUCKS_PAGE);
    const openKey = params.t ?? (truck && rows.length === 1 ? rows[0].key : null);
    const openDay = isIsoDay(params.d) ? params.d : null;

    const items = await Promise.all(
      visible.map(async (row) => {
        const open = openKey === row.key;
        let inner: ReactNode = null;
        if (open) {
          const days = data.cells.filter((cell) => cell.key === row.key).sort((a, b) => (a.day < b.day ? 1 : -1));
          const dayRows = await Promise.all(
            days.map(async (cell) => {
              const dayOpen = openDay === cell.day;
              const parts = countParts(cell, row.key === SEARCHES_KEY);
              return (
                <li key={cell.day} className={cx("hrow", dayOpen && "is-open")}>
                  <Link
                    href={href({ t: row.key, d: dayOpen ? null : cell.day, page: page > 1 ? String(page) : null })}
                    scroll={false}
                    className="hrow-head"
                    aria-expanded={dayOpen}
                  >
                    <span className="hrow-text">
                      <span className="hrow-title">{dayLabel(cell.day)}</span>
                      <span className="hrow-sub">
                        {parts.map((part) => (
                          <span key={part}>{part}</span>
                        ))}
                      </span>
                    </span>
                    <span className="hrow-end">
                      <span className="hrow-amount">{formatCredits(cell.credits)}</span>
                      <span className="hrow-unit">credits</span>
                    </span>
                    <ChevronDown size={16} aria-hidden className="hrow-chev" />
                  </Link>
                  {dayOpen ? await eventsFor(row.key, cell.day, cell) : null}
                </li>
              );
            }),
          );
          inner = <ul className="hrow-list is-inset is-nested">{dayRows}</ul>;
        }
        return (
          <TruckRow
            key={row.key}
            cell={row}
            open={open}
            link={href({ t: open ? null : row.key, d: null, page: page > 1 ? String(page) : null })}
          >
            {inner}
          </TruckRow>
        );
      }),
    );
    body = <ul className="hrow-list">{items}</ul>;
    pager = (
      <Pager page={page} total={rows.length} pageSize={TRUCKS_PAGE} noun="trucks" href={(next) => href({ page: next > 1 ? String(next) : null })} className="hist-pager" />
    );
  }

  /* ------------------------------------------------------------- picker */
  const pickerOptions = [
    { value: "", label: "All trucks" },
    ...data.trucks.map((row) => ({ value: row.number, label: row.label ? `${row.number} · ${row.label}` : row.number })),
    ...(hasSearches || truck === SEARCHES_KEY ? [{ value: SEARCHES_KEY, label: "Manual searches" }] : []),
  ];
  const showPicker = data.trucks.length > 1 || Boolean(truck);

  return (
    <div className="ledger-page">
      <PageHeader icon={<PageIcon size={20} strokeWidth={2} />} title="Activity" />

      <SummaryLine
        parts={[
          <>
            <Figure value={(totals.auto + totals.manual).toLocaleString("en-IN")} /> checks
          </>,
          <>
            <Figure value={formatCredits(totals.credits)} /> credits
          </>,
          <>
            <Figure value={totals.crossings.toLocaleString("en-IN")} /> crossings
          </>,
          <span className="hist-summary-range">{rangeLabel(range)}</span>,
        ]}
        infoLabel="activity figures"
        info={
          <>
            <p>
              {totals.auto.toLocaleString("en-IN")} automatic checks and {totals.manual.toLocaleString("en-IN")} manual
              searches or checks in this period.
            </p>
            <p>
              Automatic checks run on your trucks&apos; alerts at your plan&apos;s rate. Manual searches of numbers you
              do not track are grouped under Manual searches. A search that fails uses no credit and is not counted.
            </p>
            <p>Crossings are new toll crossings found that day. Credits added are on the Credits page. All times are IST.</p>
          </>
        }
      />

      <div className="hist-filters">
        <Segmented
          label="Group activity"
          current={view}
          items={[
            { key: "day", label: "By day", href: href({ view: null, page: null, open: null, t: null, d: null }) },
            { key: "truck", label: "By truck", href: href({ view: "truck", page: null, open: null, t: null, d: null }) },
          ]}
        />
        <div className="hist-toolbar">
          <nav className="hist-seg is-small" aria-label="Check type" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {(
              [
                ["auto", "Auto"],
                ["manual", "Manual"],
                ["all", "All"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={href({ type: key === "all" ? null : key, page: null, open: null, t: null, d: null })}
                scroll={false}
                aria-current={mode === key ? "page" : undefined}
                className={cx(mode === key && "is-active")}
              >
                <span className="hist-seg-label">{label}</span>
              </Link>
            ))}
          </nav>
          <RangeControl
            basePath={BASE}
            params={without("range", "from", "to")}
            current={range.key}
            from={range.from}
            to={range.to}
            fallback="7d"
            options={["7d", "30d", "custom"]}
          />
          {showPicker ? (
            <UrlSelect
              basePath={BASE}
              params={filters}
              name="truck"
              value={truck ?? ""}
              fallback=""
              label="Truck"
              icon={<Truck size={14} aria-hidden />}
              options={pickerOptions}
              className="hist-truck"
            />
          ) : null}
        </div>
      </div>

      {data.error ? <p className="hist-warn">Some activity could not be read. Please refresh in a moment.</p> : null}
      {data.capped ? <p className="hist-warn">This period is very large; choose a shorter range for complete figures.</p> : null}

      {body}
      {pager}

      <LedgerLinks current="activity" />
    </div>
  );
}
