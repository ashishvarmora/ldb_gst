import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Mail,
  MapPin,
  Phone,
  Search as SearchIcon,
  Truck as TruckIcon,
  Users,
} from "lucide-react";

import { Input } from "@/components/form";
import {
  Avatar,
  Badge,
  EmptyState,
  Mono,
  PageHeader,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import {
  fmtDate,
  fmtDateTime,
  fmtNumber,
  fmtRelative,
  initials,
  normalizeTruckNumber,
} from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  CreditTransaction,
  OfficerOverview,
  TruckDirectoryRow,
  TruckStatus,
} from "@/lib/types";

export const metadata = { title: "Explore — Admin" };

const STATUS_TONE: Record<TruckStatus, "good" | "warn" | "bad" | "neutral"> = {
  moving: "good",
  idle: "warn",
  no_activity: "bad",
  unknown: "neutral",
};

const STATUS_LABEL: Record<TruckStatus, string> = {
  moving: "Moving",
  idle: "Idle",
  no_activity: "No activity",
  unknown: "Unknown",
};

/** How many officer matches get the full profile treatment before it is a list. */
const FULL_PROFILE_LIMIT = 3;

/** truck_directory is read whole for the overview, in pages this size. */
const PAGE = 1000;
const MAX_PAGES = 10;

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * A search term is going into a PostgREST `or` filter, where a comma or a
 * bracket would be read as filter syntax. Nothing here is ever a real part of a
 * name, so dropping the characters is safer than trying to escape them.
 */
function safeTerm(raw: string): string {
  return raw.replace(/[(),*%\\]/g, " ").trim();
}

/** Every tracked truck with its officer. Paged, because one select is capped. */
async function loadDirectory(admin: Admin): Promise<TruckDirectoryRow[]> {
  const rows: TruckDirectoryRow[] = [];
  let after = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = admin
      .from("truck_directory")
      .select("*")
      .order("tracked_truck_id", { ascending: true })
      .limit(PAGE);
    if (after) query = query.gt("tracked_truck_id", after);

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    const batch = data as TruckDirectoryRow[];
    rows.push(...batch);
    after = batch[batch.length - 1].tracked_truck_id;
    if (batch.length < PAGE) break;
  }

  return rows;
}

/** One truck number and everyone watching it. */
type NumberGroup = { number: string; rows: TruckDirectoryRow[] };

function groupByNumber(rows: TruckDirectoryRow[]): NumberGroup[] {
  const groups = new Map<string, TruckDirectoryRow[]>();
  for (const row of rows) {
    const list = groups.get(row.truck_number);
    if (list) list.push(row);
    else groups.set(row.truck_number, [row]);
  }
  return [...groups.entries()].map(([number, list]) => ({ number, rows: list }));
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperAdmin();
  const { q } = await searchParams;
  const admin = getSupabaseAdmin();

  const term = (q ?? "").trim();
  const plate = normalizeTruckNumber(term);
  const like = safeTerm(term);

  /* --------------------------------------------------------------------- */
  /* A search runs both ways at once - the box does not ask which you meant  */
  /* --------------------------------------------------------------------- */

  const truckHits: TruckDirectoryRow[] = [];
  let officerHits: OfficerOverview[] = [];
  let officerTrucks: TruckDirectoryRow[] = [];
  let officerLedger: CreditTransaction[] = [];

  if (term) {
    const [{ data: byNumber }, { data: byOfficer }] = await Promise.all([
      plate.length >= 3
        ? admin
            .from("truck_directory")
            .select("*")
            .ilike("truck_number", `%${plate}%`)
            .order("truck_number")
            .limit(200)
        : Promise.resolve({ data: [] }),
      like
        ? admin
            .from("officer_overview")
            .select("*")
            .eq("role", "officer")
            .or(
              `full_name.ilike.%${like}%,email.ilike.%${like}%,phone.ilike.%${like}%,office.ilike.%${like}%,district.ilike.%${like}%`,
            )
            .order("full_name")
            .limit(20)
        : Promise.resolve({ data: [] }),
    ]);

    truckHits.push(...((byNumber ?? []) as TruckDirectoryRow[]));
    officerHits = (byOfficer ?? []) as OfficerOverview[];

    // Both follow-ups are one query for every matched officer, never one each.
    // Too many matches and none of it is shown, so none of it is fetched.
    const ids =
      officerHits.length <= FULL_PROFILE_LIMIT ? officerHits.map((row) => row.id) : [];
    if (ids.length > 0) {
      const [{ data: trucks }, { data: ledger }] = await Promise.all([
        admin
          .from("truck_directory")
          .select("*")
          .in("officer_id", ids)
          .order("last_event_at", { ascending: false, nullsFirst: false })
          .limit(400),
        admin
          .from("credit_transactions")
          .select("*")
          .in("user_id", ids)
          .order("created_at", { ascending: false })
          .limit(120),
      ]);
      officerTrucks = (trucks ?? []) as TruckDirectoryRow[];
      officerLedger = (ledger ?? []) as CreditTransaction[];
    }
  }

  const groups = groupByNumber(truckHits).sort(
    (a, b) => b.rows.length - a.rows.length || a.number.localeCompare(b.number),
  );
  const nothingFound = Boolean(term) && groups.length === 0 && officerHits.length === 0;

  /* --------------------------------------------------------------------- */
  /* With an empty box, the interesting thing is the fleet as a whole        */
  /* --------------------------------------------------------------------- */

  let directory: TruckDirectoryRow[] = [];
  let officers: OfficerOverview[] = [];

  if (!term) {
    const [rows, { data: all }] = await Promise.all([
      loadDirectory(admin),
      admin.from("officer_overview").select("*").eq("role", "officer"),
    ]);
    directory = rows;
    officers = (all ?? []) as OfficerOverview[];
  }

  const allGroups = groupByNumber(directory);
  const sharedNumbers = allGroups
    .filter((group) => new Set(group.rows.map((row) => row.officer_id)).size > 1)
    .sort((a, b) => b.rows.length - a.rows.length);
  const busiestNumbers = [...allGroups]
    .sort(
      (a, b) =>
        b.rows.reduce((sum, row) => sum + row.event_count, 0) -
        a.rows.reduce((sum, row) => sum + row.event_count, 0),
    )
    .slice(0, 10);
  const bySpend = [...officers]
    .sort((a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0))
    .slice(0, 10);

  return (
    <>
      <PageHeader
        title="Explore"
        subtitle="One box for both questions: who is watching this truck, and what is this officer watching?"
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <div className="relative min-w-64 flex-1">
          <SearchIcon
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <Input
            name="q"
            defaultValue={term}
            autoFocus
            placeholder="Truck number, or an officer's name, email, phone or office"
            className="pl-9"
          />
        </div>
        <button type="submit" className={buttonClass("primary")}>
          <SearchIcon size={14} />
          Search
        </button>
        {term ? (
          <Link href="/admin/explore" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      {nothingFound ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title={`Nothing matches "${term}"`}
            description="Truck numbers are matched with spaces and dashes ignored. Officers are matched on name, email, phone, office and district."
          />
        </Panel>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Truck number -> every officer watching it                           */}
      {/* ------------------------------------------------------------------ */}
      {groups.length > 0 ? (
        <section className="mb-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">
            {groups.length === 1
              ? "1 truck number matches"
              : `${groups.length} truck numbers match`}
          </h2>

          {groups.slice(0, 25).map((group) => {
            const watchers = new Set(group.rows.map((row) => row.officer_id)).size;
            return (
              <Panel
                key={group.number}
                title={group.number}
                description={
                  watchers === 1
                    ? "Watched by one officer."
                    : `Watched by ${watchers} officers — the same number is on more than one list.`
                }
                actions={
                  <Link
                    href={`/admin/trucks?q=${group.number}`}
                    className="text-xs text-brand-400 hover:underline"
                  >
                    In the fleet view
                  </Link>
                }
                bodyClassName="p-0"
              >
                <TableWrap>
                  <Thead>
                    <th className="th">Officer</th>
                    <th className="th">Contact</th>
                    <th className="th">Posting</th>
                    <th className="th">Added</th>
                    <th className="th">Status</th>
                    <th className="th">Last toll plaza</th>
                    <th className="th">Last event</th>
                    <th className="th text-right">Alerts</th>
                    <th className="th text-right">Events</th>
                    <th className="th" />
                  </Thead>
                  <Tbody>
                    {group.rows.map((row) => (
                      <Tr key={row.tracked_truck_id}>
                        <td className="td">
                          <Link
                            href={`/admin/officers/${row.officer_id}`}
                            className="group flex items-center gap-2.5"
                          >
                            <Avatar
                              size="sm"
                              text={initials(row.officer_name, row.officer_email)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                                {row.officer_name ?? row.officer_email}
                              </span>
                              {row.label ? (
                                <span className="block truncate text-xs text-faint">
                                  labelled “{row.label}”
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </td>
                        <td className="td">
                          <span className="flex items-center gap-1.5 text-xs text-muted">
                            <Mail size={12} className="shrink-0 text-faint" />
                            {row.officer_email}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                            <Phone size={12} className="shrink-0 text-faint" />
                            {row.officer_phone ?? "--"}
                          </span>
                        </td>
                        <td className="td">
                          <span className="block text-sm text-ink">{row.office ?? "--"}</span>
                          <span className="block text-xs text-faint">
                            {[row.district, row.state].filter(Boolean).join(", ") || "--"}
                          </span>
                        </td>
                        <td className="td text-xs whitespace-nowrap text-muted">
                          {fmtDate(row.created_at)}
                        </td>
                        <td className="td">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                            {row.is_active ? null : <Badge>paused</Badge>}
                          </span>
                        </td>
                        <td className="td">
                          {row.last_location ? (
                            <span className="flex items-center gap-1.5 text-sm">
                              <MapPin size={13} className="shrink-0 text-faint" />
                              {row.last_location}
                            </span>
                          ) : (
                            "--"
                          )}
                        </td>
                        <td className="td text-xs whitespace-nowrap text-muted">
                          {fmtDateTime(row.last_event_at)}
                        </td>
                        <td className="td text-right">
                          {row.alert_count === 0 ? (
                            <Badge tone="warn">never checked</Badge>
                          ) : (
                            <span className="text-sm tabular-nums text-ink">{row.alert_count}</span>
                          )}
                        </td>
                        <td className="td text-right text-sm tabular-nums text-muted">
                          {fmtNumber(row.event_count)}
                        </td>
                        <td className="td text-right">
                          <Link
                            href={`/admin/officers/${row.officer_id}`}
                            className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline"
                          >
                            Open
                            <ArrowRight size={12} />
                          </Link>
                        </td>
                      </Tr>
                    ))}
                  </Tbody>
                </TableWrap>
              </Panel>
            );
          })}

          {groups.length > 25 ? (
            <p className="text-xs text-faint">
              Showing the first 25 matching numbers. Type more of the number to narrow it down.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Officer -> profile, trucks, credit usage                            */}
      {/* ------------------------------------------------------------------ */}
      {officerHits.length > FULL_PROFILE_LIMIT ? (
        <Panel
          className="mb-6"
          title={`${officerHits.length} officers match`}
          description="Too many to open at once. Pick one."
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-divider">
            {officerHits.map((officer) => (
              <li key={officer.id}>
                <Link
                  href={`/admin/explore?q=${encodeURIComponent(officer.email)}`}
                  className="flex items-center gap-3 px-5 py-3 transition hover:bg-raised/60"
                >
                  <Avatar size="sm" text={initials(officer.full_name, officer.email)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {officer.full_name ?? officer.email}
                    </span>
                    <span className="block truncate text-xs text-faint">
                      {officer.email} · {officer.office ?? "no office recorded"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {fmtNumber(officer.active_trucks)} trucks
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        officerHits.map((officer) => {
          const trucks = officerTrucks.filter((row) => row.officer_id === officer.id);
          const movements = officerLedger.filter((row) => row.user_id === officer.id).slice(0, 8);
          const balance = Number(officer.credits ?? 0);

          return (
            <section key={officer.id} className="mb-6 space-y-5">
              <Panel
                title={officer.full_name ?? officer.email}
                description={officer.designation ?? "No designation recorded"}
                actions={
                  <Link
                    href={`/admin/officers/${officer.id}`}
                    className="text-xs text-brand-400 hover:underline"
                  >
                    Full officer page
                  </Link>
                }
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="flex items-center gap-1.5 text-muted">
                    <Mail size={13} className="text-faint" />
                    <a href={`mailto:${officer.email}`} className="hover:text-brand-500">
                      {officer.email}
                    </a>
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    <Phone size={13} className="text-faint" />
                    {officer.phone ?? "--"}
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    <Building2 size={13} className="text-faint" />
                    {officer.office ?? "--"}
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    <MapPin size={13} className="text-faint" />
                    {[officer.district, officer.state].filter(Boolean).join(", ") || "--"}
                  </span>
                  <Badge tone={officer.status === "suspended" ? "bad" : "good"}>
                    {officer.status === "suspended" ? "Suspended" : "Active"}
                  </Badge>
                  <Badge tone={officer.plan_active ? "brand" : "warn"}>
                    {officer.plan_name ?? "No plan"}
                    {officer.plan_active ? "" : " — not live"}
                  </Badge>
                </div>
              </Panel>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="Credits left"
                  value={formatCredits(balance)}
                  sub={`${formatCredits(officer.credits_purchased)} bought in total`}
                  tone={balance <= 0 ? "bad" : balance < 20 ? "warn" : "brand"}
                />
                <StatCard
                  label="Spent this month"
                  value={formatCredits(officer.credits_spent_month)}
                  sub={`${formatCredits(officer.credits_spent_today)} today`}
                />
                <StatCard
                  label="Calls this month"
                  value={fmtNumber(
                    officer.manual_searches_month + officer.tracking_queries_month,
                  )}
                  sub={`${fmtNumber(officer.manual_searches_month)} manual · ${fmtNumber(officer.tracking_queries_month)} automatic`}
                />
                <StatCard
                  label="Trucks tracked"
                  value={fmtNumber(officer.active_trucks)}
                  sub={`${fmtNumber(officer.total_trucks)} on the list in all`}
                  tone="brand"
                />
              </div>

              <Panel
                title={`Trucks they track (${trucks.length})`}
                description="Every number on this officer's list, newest event first."
                bodyClassName="p-0"
              >
                {trucks.length === 0 ? (
                  <EmptyState title="No trucks under tracking" />
                ) : (
                  <TableWrap>
                    <Thead>
                      <th className="th">Truck</th>
                      <th className="th">Status</th>
                      <th className="th">Last toll plaza</th>
                      <th className="th">Last event</th>
                      <th className="th">Last checked</th>
                      <th className="th text-right">Alerts</th>
                      <th className="th text-right">Events</th>
                      <th className="th">Added</th>
                    </Thead>
                    <Tbody>
                      {trucks.map((truck) => (
                        <Tr key={truck.tracked_truck_id}>
                          <td className="td">
                            <Link
                              href={`/admin/explore?q=${truck.truck_number}`}
                              className="transition hover:text-brand-500"
                            >
                              <Mono className="font-semibold text-ink">{truck.truck_number}</Mono>
                            </Link>
                            {truck.label ? (
                              <span className="block text-xs text-faint">{truck.label}</span>
                            ) : null}
                          </td>
                          <td className="td">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={STATUS_TONE[truck.status]}>
                                {STATUS_LABEL[truck.status]}
                              </Badge>
                              {truck.is_active ? null : <Badge>paused</Badge>}
                            </span>
                          </td>
                          <td className="td text-sm">{truck.last_location ?? "--"}</td>
                          <td className="td text-xs whitespace-nowrap text-muted">
                            {fmtDateTime(truck.last_event_at)}
                          </td>
                          <td className="td text-xs whitespace-nowrap text-muted">
                            {fmtRelative(truck.last_polled_at)}
                          </td>
                          <td className="td text-right">
                            {truck.alert_count === 0 ? (
                              <Badge tone="warn">never checked</Badge>
                            ) : (
                              <span className="text-sm tabular-nums text-ink">
                                {truck.alert_count}
                              </span>
                            )}
                          </td>
                          <td className="td text-right text-sm tabular-nums text-muted">
                            {fmtNumber(truck.event_count)}
                          </td>
                          <td className="td text-xs whitespace-nowrap text-muted">
                            {fmtDate(truck.created_at)}
                          </td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableWrap>
                )}
              </Panel>

              <Panel
                title="Recent credit movements"
                description="What their balance has been spent on lately."
                bodyClassName="p-0"
                actions={
                  <Link
                    href={`/admin/officers/${officer.id}`}
                    className="text-xs text-brand-400 hover:underline"
                  >
                    Full history
                  </Link>
                }
              >
                {movements.length === 0 ? (
                  <EmptyState title="Nothing charged yet" />
                ) : (
                  <ul className="divide-y divide-divider">
                    {movements.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">
                            {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                            {row.truck_number ? (
                              <span className="text-faint"> · {row.truck_number}</span>
                            ) : null}
                          </span>
                          <span className="block text-xs text-faint">
                            {fmtDateTime(row.created_at)}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-sm font-medium tabular-nums ${
                            Number(row.delta) < 0 ? "text-muted" : "text-good-500"
                          }`}
                        >
                          {Number(row.delta) > 0 ? "+" : "-"}
                          {formatCredits(Math.abs(Number(row.delta)))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </section>
          );
        })
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Empty box: what is worth noticing across the whole platform         */}
      {/* ------------------------------------------------------------------ */}
      {!term ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Trucks tracked"
              value={fmtNumber(directory.length)}
              sub="Rows across every officer's list"
              tone="brand"
              icon={<TruckIcon size={15} />}
            />
            <StatCard
              label="Distinct numbers"
              value={fmtNumber(allGroups.length)}
              sub="Unique registration numbers"
            />
            <StatCard
              label="Watched by two or more"
              value={fmtNumber(sharedNumbers.length)}
              sub={
                sharedNumbers.length > 0
                  ? "Same number, different officers"
                  : "No number is on two lists"
              }
              tone={sharedNumbers.length > 0 ? "warn" : "neutral"}
            />
            <StatCard
              label="Officers"
              value={fmtNumber(officers.length)}
              sub={`${officers.filter((o) => o.status === "active").length} active`}
              icon={<Users size={15} />}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel
              title="Watched by more than one officer"
              description="The same registration number on two lists. Usually two offices working the same consignment, and worth knowing before either of them calls."
              bodyClassName="p-0"
            >
              {sharedNumbers.length === 0 ? (
                <EmptyState
                  title="No overlap"
                  description="Every tracked number belongs to exactly one officer."
                />
              ) : (
                <ul className="divide-y divide-divider">
                  {sharedNumbers.slice(0, 12).map((group) => (
                    <li key={group.number} className="px-5 py-3">
                      <Link
                        href={`/admin/explore?q=${group.number}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <Mono className="font-semibold text-ink hover:text-brand-500">
                          {group.number}
                        </Mono>
                        <Badge tone="warn">{group.rows.length} officers</Badge>
                      </Link>
                      <p className="mt-1 truncate text-xs text-faint">
                        {group.rows
                          .map((row) => row.officer_name ?? row.officer_email)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Most active numbers"
              description="Ranked by toll events stored against them."
              bodyClassName="p-0"
            >
              {busiestNumbers.length === 0 ? (
                <EmptyState title="No trucks tracked yet" />
              ) : (
                <TableWrap>
                  <Thead>
                    <th className="th">Truck</th>
                    <th className="th">Watched by</th>
                    <th className="th">Last event</th>
                    <th className="th text-right">Events</th>
                  </Thead>
                  <Tbody>
                    {busiestNumbers.map((group) => {
                      const events = group.rows.reduce((sum, row) => sum + row.event_count, 0);
                      const latest = group.rows
                        .map((row) => row.last_event_at)
                        .filter(Boolean)
                        .sort()
                        .pop();
                      return (
                        <Tr key={group.number}>
                          <td className="td">
                            <Link href={`/admin/explore?q=${group.number}`}>
                              <Mono className="font-semibold text-ink hover:text-brand-500">
                                {group.number}
                              </Mono>
                            </Link>
                          </td>
                          <td className="td">
                            <span className="block truncate text-sm text-ink">
                              {group.rows[0].officer_name ?? group.rows[0].officer_email}
                            </span>
                            {group.rows.length > 1 ? (
                              <span className="block text-xs text-faint">
                                and {group.rows.length - 1} more
                              </span>
                            ) : null}
                          </td>
                          <td className="td text-xs whitespace-nowrap text-muted">
                            {fmtRelative(latest ?? null)}
                          </td>
                          <td className="td text-right text-sm tabular-nums text-ink">
                            {fmtNumber(events)}
                          </td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </TableWrap>
              )}
            </Panel>

            <Panel
              className="xl:col-span-2"
              title="Officers by credits spent this month"
              description="Who is actually working the platform. Click through for their trucks and contact details."
              bodyClassName="p-0"
            >
              {bySpend.length === 0 ? (
                <EmptyState title="No officers yet" />
              ) : (
                <TableWrap>
                  <Thead>
                    <th className="th">Officer</th>
                    <th className="th">Contact</th>
                    <th className="th">Posting</th>
                    <th className="th text-right">Trucks</th>
                    <th className="th text-right">Credits left</th>
                    <th className="th text-right">Spent this month</th>
                    <th className="th">Last event</th>
                  </Thead>
                  <Tbody>
                    {bySpend.map((officer) => (
                      <Tr key={officer.id}>
                        <td className="td">
                          <Link
                            href={`/admin/officers/${officer.id}`}
                            className="group flex items-center gap-2.5"
                          >
                            <Avatar size="sm" text={initials(officer.full_name, officer.email)} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                                {officer.full_name ?? officer.email}
                              </span>
                              <span className="block truncate text-xs text-faint">
                                {officer.designation ?? "--"}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="td">
                          <span className="block truncate text-xs text-muted">{officer.email}</span>
                          <span className="block text-xs text-faint">{officer.phone ?? "--"}</span>
                        </td>
                        <td className="td">
                          <span className="block text-sm text-ink">{officer.office ?? "--"}</span>
                          <span className="block text-xs text-faint">
                            {[officer.district, officer.state].filter(Boolean).join(", ") || "--"}
                          </span>
                        </td>
                        <td className="td text-right text-sm tabular-nums text-muted">
                          {fmtNumber(officer.active_trucks)}
                        </td>
                        <td className="td text-right">
                          <Badge
                            tone={
                              Number(officer.credits ?? 0) <= 0
                                ? "bad"
                                : Number(officer.credits ?? 0) < 20
                                  ? "warn"
                                  : "good"
                            }
                          >
                            {formatCredits(officer.credits)}
                          </Badge>
                        </td>
                        <td className="td text-right text-sm font-medium tabular-nums text-ink">
                          {formatCredits(officer.credits_spent_month)}
                        </td>
                        <td className="td text-xs whitespace-nowrap text-muted">
                          {fmtRelative(officer.last_event_at)}
                        </td>
                      </Tr>
                    ))}
                  </Tbody>
                </TableWrap>
              )}
            </Panel>
          </div>
        </>
      ) : null}
    </>
  );
}
