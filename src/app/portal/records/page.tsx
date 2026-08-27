import Link from "next/link";
import { Download, ExternalLink, Filter, MapPin } from "lucide-react";

import { Input, Select } from "@/components/form";
import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
  cx,
} from "@/components/ui";
import { directionLabel } from "@/components/Timeline";
import { fmtDate, fmtNumber, fmtRelative, fmtTime, istDaysAgo } from "@/lib/format";
import { stateFromLocation } from "@/lib/geo";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TrackedTruck, TruckEvent } from "@/lib/types";

export const metadata = { title: "Records — Truck Watch" };

const PAGE_SIZE = 100;

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "14", label: "Last 14 days" },
  { key: "30", label: "Last 30 days" },
  { key: "all", label: "Everything kept" },
] as const;

type RecordSearch = {
  truck?: string;
  q?: string;
  range?: string;
  direction?: string;
  page?: string;
  /** "1" to include repeat readings at a plaza the truck never left. */
  all?: string;
};

/**
 * Every toll crossing the officer has on record, in one table they can filter
 * and export — the same shape as their Google Sheet, but searchable.
 *
 * This is the view for "show me what all my trucks have been doing", as opposed
 * to the per-truck timeline which answers "where has this one been".
 */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<RecordSearch>;
}) {
  const { overview } = await requirePortalSession();
  const params = await searchParams;
  const admin = getSupabaseAdmin();

  const range = RANGES.some((r) => r.key === params.range) ? params.range! : "7";
  const page = Math.max(1, Number(params.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  // By default this lists movements. A plaza reports the same crossing under
  // several sequence numbers, and a parked truck registers over and over, so
  // showing every raw reading buries the actual journey.
  const showAll = params.all === "1";

  let query = admin
    .from("truck_events")
    .select("*", { count: "exact" })
    .eq("user_id", overview.id)
    .order("event_time", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);

  if (range !== "all") {
    query = query.gte("event_time", `${istDaysAgo(Number(range))}T00:00:00+05:30`);
  }
  if (!showAll) query = query.eq("is_location_change", true);
  if (params.truck) query = query.eq("truck_number", params.truck);
  if (params.direction) query = query.eq("direction", params.direction);
  if (params.q) query = query.ilike("loc_name", `%${params.q}%`);

  const [{ data: rows, count, error }, { data: trucks }] = await Promise.all([
    query,
    admin
      .from("tracked_trucks")
      .select("truck_number")
      .eq("user_id", overview.id)
      .order("truck_number"),
  ]);

  const events = (rows ?? []) as TruckEvent[];
  const truckList = (trucks ?? []) as Pick<TrackedTruck, "truck_number">[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Analytics over the page in hand. Cheap, and answers the questions an
  // officer actually asks of a list this size.
  const distinctTrucks = new Set(events.map((e) => e.truck_number)).size;
  const distinctPlazas = new Set(events.map((e) => e.loc_name).filter(Boolean)).size;
  const byPlaza = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const event of events) {
    const plaza = event.loc_name ?? "Unnamed";
    byPlaza.set(plaza, (byPlaza.get(plaza) ?? 0) + 1);
    if (event.event_time) {
      const day = new Date(event.event_time).toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
  }
  const topPlazas = [...byPlaza.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const busiestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];

  const filtered = Boolean(params.truck || params.q || params.direction || params.range || params.all);
  const exportQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") exportQuery.set(k, v);

  return (
    <>
      <PageHeader
        title="Records"
        subtitle="Every move your trucks have made. Filter it, read it, export it — the same rows that go into your Google Sheet."
        actions={
          <a href={`/portal/records/export?${exportQuery}`} className={buttonClass("secondary")}>
            <Download size={14} />
            Export CSV
          </a>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={showAll ? "Readings" : "Movements"}
          value={fmtNumber(total)}
          sub={range === "all" ? "everything kept" : `in the last ${range} days`}
          tone="brand"
        />
        <StatCard label="Trucks seen" value={distinctTrucks} sub="on this page" />
        <StatCard label="Distinct plazas" value={distinctPlazas} sub="on this page" />
        <StatCard
          label="Busiest day"
          value={busiestDay ? fmtNumber(busiestDay[1]) : "--"}
          sub={busiestDay ? fmtDate(busiestDay[0]) : "no crossings"}
        />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <Select name="truck" defaultValue={params.truck ?? ""} className="w-48">
          <option value="">All my trucks</option>
          {truckList.map((t) => (
            <option key={t.truck_number} value={t.truck_number}>
              {t.truck_number}
            </option>
          ))}
        </Select>

        <Select name="range" defaultValue={range} className="w-44">
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>

        <Select name="direction" defaultValue={params.direction ?? ""} className="w-40">
          <option value="">Any direction</option>
          {["N", "S", "E", "W"].map((d) => (
            <option key={d} value={d}>
              {directionLabel(d)}
            </option>
          ))}
        </Select>

        <Input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Toll plaza name"
          className="min-w-48 flex-1"
        />

        <label
          className={cx(
            "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs transition",
            showAll
              ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
              : "border-line bg-panel text-muted hover:bg-sunken",
          )}
          title="A plaza can report one crossing several times, and a parked truck registers repeatedly."
        >
          <input
            type="checkbox"
            name="all"
            value="1"
            defaultChecked={showAll}
            className="size-3.5 accent-[color:var(--c-brand-500)]"
          />
          Show repeat readings
        </label>

        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {filtered ? (
          <Link href="/portal/records" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <Panel bodyClassName="p-0">
            {error ? (
              <EmptyState title="Could not load records" description={error.message} />
            ) : events.length === 0 ? (
              <EmptyState
                title={filtered ? "Nothing matches those filters" : "No movements on record"}
                description={
                  filtered
                    ? "Try a wider date range, or clear the filters."
                    : "Records appear here once your tracked trucks start crossing toll plazas."
                }
                action={
                  filtered ? null : <LinkButton href="/portal/trucks">Add a truck</LinkButton>
                }
              />
            ) : (
              <TableWrap>
                <Thead>
                  <th className="th">When</th>
                  <th className="th">Truck</th>
                  <th className="th">Toll plaza</th>
                  <th className="th">Direction</th>
                  <th className="th">Map</th>
                </Thead>
                <Tbody>
                  {events.map((event) => (
                    <Tr key={event.id}>
                      <td className="td whitespace-nowrap">
                        <span className="block text-sm text-ink">{fmtDate(event.event_time)}</span>
                        <span className="block text-xs text-muted">
                          {fmtTime(event.event_time)} · {fmtRelative(event.event_time)}
                        </span>
                      </td>
                      <td className="td">
                        <Link
                          href={`/portal/search/${event.truck_number}`}
                          className="transition hover:text-brand-500"
                        >
                          <Mono className="font-semibold">{event.truck_number}</Mono>
                        </Link>
                      </td>
                      <td className="td">
                        <span className="flex items-center gap-1.5 text-sm">
                          <MapPin size={13} className="shrink-0 text-faint" />
                          {event.loc_name ?? "Unnamed plaza"}
                        </span>
                        {stateFromLocation(event.loc_name) ? (
                          <span className="mt-0.5 block text-xs text-muted">
                            {stateFromLocation(event.loc_name)}
                          </span>
                        ) : null}
                      </td>
                      <td className="td text-sm whitespace-nowrap text-muted">
                        {directionLabel(event.direction) ?? "--"}
                      </td>
                      <td className="td">
                        {event.lat !== null && event.lng !== null ? (
                          <a
                            href={`https://www.google.com/maps?q=${event.lat},${event.lng}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline"
                          >
                            open
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-xs text-faint">--</span>
                        )}
                      </td>
                    </Tr>
                  ))}
                </Tbody>
              </TableWrap>
            )}
          </Panel>

          {pages > 1 ? (
            <nav className="mt-3 flex items-center justify-between gap-3" aria-label="Pagination">
              <p className="text-xs text-muted">
                Showing {fmtNumber(from + 1)}–{fmtNumber(Math.min(from + PAGE_SIZE, total))} of{" "}
                {fmtNumber(total)}
              </p>
              <div className="flex gap-2">
                <PageLink params={params} page={page - 1} disabled={page <= 1}>
                  Previous
                </PageLink>
                <PageLink params={params} page={page + 1} disabled={page >= pages}>
                  Next
                </PageLink>
              </div>
            </nav>
          ) : null}
        </div>

        <div className="space-y-5">
          <Panel title="Busiest plazas" description="Across the crossings shown." bodyClassName="p-0">
            {topPlazas.length === 0 ? (
              <EmptyState title="Nothing to summarise" />
            ) : (
              <ul className="divide-y divide-divider">
                {topPlazas.map(([plaza, n]) => {
                  const share = Math.round((n / events.length) * 100);
                  return (
                    <li key={plaza} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-ink">{plaza}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">{n}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${Math.max(share, 3)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="How long records are kept">
            <p className="text-xs leading-relaxed text-muted">
              {overview.data_retention_days === -1 ? (
                <>Your administrator keeps your history indefinitely.</>
              ) : (
                <>
                  The app keeps{" "}
                  <strong className="text-ink">{overview.data_retention_days} days</strong> of
                  crossings. Anything older is cleared automatically.
                </>
              )}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {overview.sheet_connected ? (
                <>
                  Your Google Sheet keeps <strong className="text-ink">everything</strong>, so
                  nothing is really lost — last synced {fmtRelative(overview.sheet_last_synced_at)}.
                </>
              ) : (
                <span className="text-warn-500">
                  You have no Google Sheet connected, so nothing is being kept outside the app.
                  Connect one in Settings before old records are cleared.
                </span>
              )}
            </p>
            <div className="mt-3">
              <LinkButton href="/portal/settings" size="sm" variant="secondary">
                Open settings
              </LinkButton>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: RecordSearch;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") next.set(k, v);
  next.set("page", String(page));
  return (
    <Link href={`/portal/records?${next}`} className={buttonClass("secondary", "sm")}>
      {children}
    </Link>
  );
}
