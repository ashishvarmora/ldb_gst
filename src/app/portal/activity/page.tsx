import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownUp, ChevronDown, History as PageIcon, ListTree, Search } from "lucide-react";

import { ActivityTimeline } from "@/components/ActivityTimeline";
import { ChipToggles, DateRangeControl, UrlSelect } from "@/components/HistoryControls";
import { Figure, MiniPager, SummaryLine, plural } from "@/components/HistoryUi";
import { Pager, pageFromParam } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import { EmptyState, PageHeader, cx } from "@/components/ui";
import {
  SEARCHES_KEY,
  loadActivity,
  loadActivityEntries,
  type ActivityMode,
  type Cell,
  type EntryScope,
  type EntrySort,
} from "@/lib/credit-history";
import { formatCredits } from "@/lib/credits";
import { HISTORY_RANGE_KEYS, dayLabel, parseHistoryRange, rangeLabel, rangeQuery } from "@/lib/history-range";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { LedgerLinks } from "../credits/LedgerNav";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Activity — ${brandName}` };
}

/**
 * Activity: what was checked, and what it found (owner's spec, 23 Nov 2026).
 *
 *   Type      Auto / Manual chips, independent; at least one stays on.
 *   Date      All / Last 7 days (default) / Custom.
 *   Group     Day / Truck chips, independent. One on = groups of that kind;
 *             both = nested, Day -> Truck (default) or Truck -> Day; none =
 *             the individual entries. Tapping a group opens its child groups
 *             or its entries.
 *   Sort      Newest / Oldest (a group by its latest / earliest activity),
 *             Most / Fewest credits (a group by its total).
 *
 * An ENTRY is one check or search (ledger charge) or a truck event
 * (truck_activity) - loadActivityEntries. MANUAL SEARCHES of numbers you do
 * not track are one pseudo-truck, "Manual searches"; a "Check now" on a
 * tracked truck is that truck's manual check.
 *
 * Group figures are summed by the database (credit_ledger_daily) and netted
 * of failed searches in credit-history.ts; entries are paged by the database
 * and only the one open group's entries are ever read. Failed manual searches
 * appear nowhere. Everything is in the URL; a filter change lands on page 1
 * with every group closed.
 */

const BASE = "/portal/activity";
const GROUPS_PAGE = 15;
const CHILD_PAGE = 15;
const ENTRIES_PAGE = 25;

type Dim = "day" | "truck";
type GroupValue = "day-truck" | "truck-day" | "day" | "truck" | "none";
const GROUP_DEFAULT: GroupValue = "day-truck";

type Query = {
  type?: string;
  range?: string;
  from?: string;
  to?: string;
  group?: string;
  sort?: string;
  page?: string;
  /** The open top-level group, the open child group, their pages. */
  o?: string;
  o2?: string;
  cp?: string;
  rp?: string;
};

const SORTS: { value: EntrySort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "most", label: "Most credits" },
  { value: "fewest", label: "Fewest credits" },
];

function parseGroup(raw: string | undefined): GroupValue {
  return raw === "truck-day" || raw === "day" || raw === "truck" || raw === "none" ? raw : GROUP_DEFAULT;
}

function groupValue(day: boolean, truck: boolean, first: Dim): GroupValue {
  if (day && truck) return first === "day" ? "day-truck" : "truck-day";
  return day ? "day" : truck ? "truck" : "none";
}

/* -------------------------------------------------------------- groups */

type Group = {
  key: string;
  dim: Dim;
  auto: number;
  manual: number;
  credits: number;
  crossings: number;
  numbers: Set<string>;
  /** Earliest / latest activity, ms. */
  first: number;
  last: number;
  cells: Cell[];
};

function groupCells(cells: Cell[], dim: Dim): Group[] {
  const groups = new Map<string, Group>();
  for (const cell of cells) {
    const key = dim === "day" ? cell.day : cell.key;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        dim,
        auto: 0,
        manual: 0,
        credits: 0,
        crossings: 0,
        numbers: new Set(),
        first: Infinity,
        last: -Infinity,
        cells: [],
      };
      groups.set(key, group);
    }
    group.auto += cell.auto;
    group.manual += cell.manual;
    group.credits += cell.credits;
    group.crossings += cell.crossings;
    for (const number of cell.numbers.keys()) group.numbers.add(number);
    /* A day with crossings but no charge has no times: its day bounds. */
    const first = cell.firstAt ? Date.parse(cell.firstAt) : Date.parse(`${cell.day}T00:00:00+05:30`);
    const last = cell.lastAt ? Date.parse(cell.lastAt) : Date.parse(`${cell.day}T23:59:59+05:30`);
    group.first = Math.min(group.first, first);
    group.last = Math.max(group.last, last);
    group.cells.push(cell);
  }
  for (const group of groups.values()) group.credits = Math.round(group.credits * 100) / 100;
  return [...groups.values()];
}

function sortGroups(groups: Group[], sort: EntrySort): Group[] {
  const by: Record<EntrySort, (a: Group, b: Group) => number> = {
    newest: (a, b) => b.last - a.last,
    oldest: (a, b) => a.first - b.first,
    most: (a, b) => b.credits - a.credits || b.last - a.last,
    fewest: (a, b) => a.credits - b.credits || b.last - a.last,
  };
  return [...groups].sort((a, b) => by[sort](a, b) || a.key.localeCompare(b.key));
}

/** "96 auto · 1 manual · 4 crossings" - zero parts left out. */
function countParts(g: Group): string[] {
  const parts: string[] = [];
  if (g.dim === "truck" && g.key === SEARCHES_KEY) {
    if (g.numbers.size > 0) parts.push(plural(g.numbers.size, "number"));
    if (g.manual > 0) parts.push(plural(g.manual, "search", "searches"));
  } else {
    if (g.auto > 0) parts.push(`${g.auto.toLocaleString("en-IN")} auto`);
    if (g.manual > 0) parts.push(`${g.manual.toLocaleString("en-IN")} manual`);
  }
  if (g.crossings > 0) parts.push(plural(g.crossings, "crossing"));
  return parts;
}

const slice = <T,>(rows: T[], page: number, size: number) => rows.slice((page - 1) * size, page * size);
const pagesOf = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [{ overview }, params] = await Promise.all([requirePortalSession(), searchParams]);
  const admin = getSupabaseAdmin();

  /* ---------------------------------------------------------------- filters */
  const mode: ActivityMode = params.type === "auto" || params.type === "manual" ? params.type : "all";
  const autoOn = mode !== "manual";
  const manualOn = mode !== "auto";
  const range = parseHistoryRange(params, {
    fallback: "7d",
    allowAll: true,
    keys: HISTORY_RANGE_KEYS,
  });
  const group = parseGroup(params.group);
  const dayOn = group !== "truck" && group !== "none";
  const truckOn = group !== "day" && group !== "none";
  const firstDim: Dim = group === "truck-day" || group === "truck" ? "truck" : "day";
  const levels: Dim[] =
    dayOn && truckOn ? [firstDim, firstDim === "day" ? "truck" : "day"] : dayOn ? ["day"] : truckOn ? ["truck"] : [];
  const sort: EntrySort = SORTS.some((s) => s.value === params.sort) ? (params.sort as EntrySort) : "newest";

  const data = await loadActivity(admin, overview.id, {
    from: range.from,
    to: range.to,
    mode,
    truck: null,
  });
  const tracked = new Set(data.trucks.map((row) => row.number));
  const labelOf = new Map(data.trucks.map((row) => [row.number, row.label]));

  /* The query every filter control and link keeps. No page, nothing open. */
  const filters: Record<string, string> = {
    ...(mode !== "all" ? { type: mode } : {}),
    ...rangeQuery(range, "7d"),
    ...(group !== GROUP_DEFAULT ? { group } : {}),
    ...(sort !== "newest" ? { sort } : {}),
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
  const num = (page: number) => (page > 1 ? String(page) : null);
  const without = (...keys: string[]) => {
    const copy = { ...filters };
    for (const key of keys) delete copy[key];
    return copy;
  };

  const totals = groupCells(data.cells, "day").reduce(
    (acc, g) => ({
      auto: acc.auto + g.auto,
      manual: acc.manual + g.manual,
      credits: acc.credits + g.credits,
      crossings: acc.crossings + g.crossings,
    }),
    { auto: 0, manual: 0, credits: 0, crossings: 0 },
  );
  totals.credits = Math.round(totals.credits * 100) / 100;

  /* --------------------------------------------------------------- entries */
  async function entries(
    scope: Pick<EntryScope, "from" | "to" | "key">,
    page: number,
    pageHref: (page: number) => string,
    inside: Dim[],
  ) {
    const result = await loadActivityEntries(admin, overview.id, { ...scope, mode, tracked }, sort, page, ENTRIES_PAGE);
    /* Inside a truck's group the truck goes without saying - but "Manual
       searches" holds many numbers, so each row names its own. */
    const showTruck = !inside.includes("truck") || scope.key === SEARCHES_KEY;
    return {
      total: result.total,
      node: (
        <>
          {result.error ? (
            <p className="hist-warn">Some entries could not be read. Please refresh in a moment.</p>
          ) : null}
          <ActivityTimeline
            entries={result.rows}
            showTruck={showTruck}
            showDate={!inside.includes("day")}
            note={
              !result.withEvents && scope.key !== SEARCHES_KEY
                ? "Sorted by credits: truck events (paused, alerts changed…) are listed only when sorted by time."
                : null
            }
          />
          <MiniPager page={result.page} total={result.total} pageSize={ENTRIES_PAGE} noun="entries" href={pageHref} />
        </>
      ),
    };
  }

  /* A group's own slice of the range. */
  const scopeOf = (path: Group[]): Pick<EntryScope, "from" | "to" | "key"> => {
    const day = path.find((g) => g.dim === "day")?.key ?? null;
    const truck = path.find((g) => g.dim === "truck")?.key ?? null;
    return { from: day ?? range.from, to: day ?? range.to, key: truck };
  };

  function groupTitle(g: Group) {
    if (g.dim === "day") return <span className="hrow-title">{dayLabel(g.key)}</span>;
    if (g.key === SEARCHES_KEY) {
      return (
        <span className="hrow-title">
          <Search size={13} aria-hidden className="hrow-title-icon" />
          Manual searches
        </span>
      );
    }
    const label = labelOf.get(g.key);
    return (
      <span className="hrow-title">
        <span className="hrow-plate">{g.key}</span>
        {label ? <span className="hrow-title-note"> · {label}</span> : null}
      </span>
    );
  }

  function GroupRow({ g, open, link, children }: { g: Group; open: boolean; link: string; children?: ReactNode }) {
    const parts = countParts(g);
    return (
      <li className={cx("hrow", open && "is-open")}>
        <Link href={link} scroll={false} className="hrow-head" aria-expanded={open}>
          <span className="hrow-text">
            {groupTitle(g)}
            <span className="hrow-sub">
              {parts.length > 0 ? parts.map((part) => <span key={part}>{part}</span>) : <span>No checks</span>}
            </span>
          </span>
          <span className="hrow-end">
            <span className="hrow-amount">{formatCredits(g.credits)}</span>
            <span className="hrow-unit">credits</span>
          </span>
          <ChevronDown size={16} aria-hidden className="hrow-chev" />
        </Link>
        {open ? children : null}
      </li>
    );
  }

  /* ------------------------------------------------------------------ body */
  let body: ReactNode;
  let pager: ReactNode = null;
  const requested = pageFromParam(params.page);

  if (levels.length === 0) {
    /* No grouping: every entry, paged. */
    const list = await entries(
      { from: range.from, to: range.to, key: null },
      requested,
      (next) => href({ page: num(next) }),
      [],
    );
    body =
      list.total === 0 ? (
        <div className="panel">
          <EmptyState title="No activity in this period" description={rangeLabel(range)} />
        </div>
      ) : (
        <div className="aentry-panel">{list.node}</div>
      );
  } else if (data.cells.length === 0) {
    body = (
      <div className="panel">
        <EmptyState title="No activity in this period" description={rangeLabel(range)} />
      </div>
    );
  } else {
    const top = sortGroups(groupCells(data.cells, levels[0]), sort);
    const page = Math.min(requested, pagesOf(top.length, GROUPS_PAGE));
    const visible = slice(top, page, GROUPS_PAGE);
    /* One group only (a single day from Credits, say): it opens by itself.
       Closing it writes o=- so it stays closed. */
    const openKey = params.o ?? (top.length === 1 ? top[0].key : null);
    const openChild = params.o2 ?? null;
    const childPage = pageFromParam(params.cp);
    const entryPage = pageFromParam(params.rp);
    const at = { page: num(page) };

    const rows = await Promise.all(
      visible.map(async (g) => {
        const open = openKey === g.key;
        let inner: ReactNode = null;
        if (open && levels.length === 1) {
          const list = await entries(scopeOf([g]), entryPage, (next) => href({ ...at, o: g.key, rp: num(next) }), [
            g.dim,
          ]);
          inner = list.node;
        } else if (open) {
          const children = sortGroups(groupCells(g.cells, levels[1]), sort);
          const cpage = Math.min(childPage, pagesOf(children.length, CHILD_PAGE));
          const childRows = await Promise.all(
            slice(children, cpage, CHILD_PAGE).map(async (child) => {
              const childOpen = openChild === child.key;
              const list = childOpen
                ? await entries(
                    scopeOf([g, child]),
                    entryPage,
                    (next) =>
                      href({
                        ...at,
                        o: g.key,
                        cp: num(cpage),
                        o2: child.key,
                        rp: num(next),
                      }),
                    [g.dim, child.dim],
                  )
                : null;
              return (
                <GroupRow
                  key={child.key}
                  g={child}
                  open={childOpen}
                  link={href({
                    ...at,
                    o: g.key,
                    cp: num(cpage),
                    o2: childOpen ? null : child.key,
                  })}
                >
                  {list?.node}
                </GroupRow>
              );
            }),
          );
          inner = (
            <>
              <ul className="hrow-list is-inset is-nested">{childRows}</ul>
              {children.length > CHILD_PAGE ? (
                <div className="aday-events">
                  <MiniPager
                    page={cpage}
                    total={children.length}
                    pageSize={CHILD_PAGE}
                    noun={levels[1] === "day" ? "days" : "trucks"}
                    href={(next) => href({ ...at, o: g.key, cp: num(next) })}
                  />
                </div>
              ) : null}
            </>
          );
        }
        return (
          <GroupRow key={g.key} g={g} open={open} link={href({ ...at, o: open ? "-" : g.key })}>
            {inner}
          </GroupRow>
        );
      }),
    );
    body = <ul className="hrow-list">{rows}</ul>;
    pager = (
      <Pager
        page={page}
        total={top.length}
        pageSize={GROUPS_PAGE}
        noun={levels[0] === "day" ? "days" : "trucks"}
        href={(next) => href({ page: num(next) })}
        className="hist-pager"
      />
    );
  }

  /* ---------------------------------------------------------------- chips */
  const typeHref = (auto: boolean, manual: boolean) => href({ type: auto && manual ? null : auto ? "auto" : "manual" });
  const groupHref = (day: boolean, truck: boolean) => {
    const next = groupValue(day, truck, firstDim);
    return href({ group: next === GROUP_DEFAULT ? null : next });
  };
  const lastOn = "At least one type stays on";

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
        ]}
        period={rangeLabel(range)}
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
            <p>Crossings are new toll crossings found. Credits added are on the Credits page. All times are IST.</p>
          </>
        }
      />

      <div className="hist-filters">
        <div className="hist-toolbar">
          <ChipToggles
            label="Check type"
            items={[
              {
                key: "auto",
                label: "Auto",
                on: autoOn,
                href: autoOn && !manualOn ? null : typeHref(!autoOn, manualOn),
                lockedHint: lastOn,
              },
              {
                key: "manual",
                label: "Manual",
                on: manualOn,
                href: manualOn && !autoOn ? null : typeHref(autoOn, !manualOn),
                lockedHint: lastOn,
              },
            ]}
          />
          <DateRangeControl
            basePath={BASE}
            params={without("range", "from", "to")}
            current={range.key}
            from={range.from}
            to={range.to}
            fallback="7d"
          />
        </div>
        <div className="hist-toolbar">
          <ChipToggles
            label="Group by"
            caption="Group"
            items={[
              {
                key: "day",
                label: "Day",
                on: dayOn,
                href: groupHref(!dayOn, truckOn),
              },
              {
                key: "truck",
                label: "Truck",
                on: truckOn,
                href: groupHref(dayOn, !truckOn),
              },
            ]}
          />
          {dayOn && truckOn ? (
            <UrlSelect
              basePath={BASE}
              params={filters}
              name="group"
              value={group}
              fallback={GROUP_DEFAULT}
              label="Group order"
              icon={<ListTree size={14} aria-hidden />}
              options={[
                { value: "day-truck", label: "Day → Truck" },
                { value: "truck-day", label: "Truck → Day" },
              ]}
              className="hist-order"
            />
          ) : null}
          <UrlSelect
            basePath={BASE}
            params={filters}
            name="sort"
            value={sort}
            fallback="newest"
            label="Sort"
            icon={<ArrowDownUp size={14} aria-hidden />}
            options={SORTS}
            className="hist-sort"
          />
        </div>
      </div>

      {data.error ? <p className="hist-warn">Some activity could not be read. Please refresh in a moment.</p> : null}
      {data.capped ? (
        <p className="hist-warn">This period is very large; choose a shorter range for complete figures.</p>
      ) : null}

      {body}
      {pager}

      <LedgerLinks current="activity" />
    </div>
  );
}
