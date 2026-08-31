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

import { CapNote, pageRange } from "../pager";
import { Input } from "@/components/form";
import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
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
  CreditActivity,
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

/** How many account matches get the full profile treatment before it is a list. */
const FULL_PROFILE_LIMIT = 3;

/* Page sizes. Each list on this page carries its own page number, so opening
   one does not reset the others. */
const GROUPS_PAGE = 10;
const MATCHES_PAGE = 20;
const SHARED_PAGE = 12;
const BUSY_PAGE = 10;
const ACCOUNTS_PAGE = 10;
const TRUCKS_PER_ACCOUNT = 25;
const ACTIVITY_PER_ACCOUNT = 8;

/**
 * A search groups its hits by number before showing them, so they cannot be
 * paged in the database. This is the cap on what one search reads.
 */
const SEARCH_ROW_CAP = 500;

/** The overview's scan of the directory, walked because one select is capped. */
const SCAN_BATCH = 1000;
const MAX_SCAN_BATCHES = 20;

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Only the columns the overview counts on. "Watched by two or more" is a
 * question about every row at once, so it cannot be paged away - but read four
 * narrow columns instead of the whole join and the scan stays cheap.
 */
type ScanRow = Pick<
  TruckDirectoryRow,
  "tracked_truck_id" | "truck_number" | "officer_id" | "officer_name" | "officer_email" | "event_count" | "last_event_at"
>;

const SCAN_COLUMNS =
  "tracked_truck_id, truck_number, officer_id, officer_name, officer_email, event_count, last_event_at";

/**
 * A search term is going into a PostgREST `or` filter, where a comma or a
 * bracket would be read as filter syntax. Nothing here is ever a real part of a
 * name, so dropping the characters is safer than trying to escape them.
 */
function safeTerm(raw: string): string {
  return raw.replace(/[(),*%\\]/g, " ").trim();
}

async function scanDirectory(admin: Admin): Promise<{ rows: ScanRow[]; capped: boolean }> {
  const rows: ScanRow[] = [];
  let after = "";
  let capped = false;

  for (let batch = 0; batch < MAX_SCAN_BATCHES; batch += 1) {
    let query = admin
      .from("truck_directory")
      .select(SCAN_COLUMNS)
      .order("tracked_truck_id", { ascending: true })
      .limit(SCAN_BATCH);
    if (after) query = query.gt("tracked_truck_id", after);

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    const page = data as unknown as ScanRow[];
    rows.push(...page);
    after = page[page.length - 1].tracked_truck_id;
    if (page.length < SCAN_BATCH) break;
    capped = batch === MAX_SCAN_BATCHES - 1;
  }

  return { rows, capped };
}

/** One truck number and every row watching it. */
type NumberGroup<T extends { truck_number: string }> = { number: string; rows: T[] };

function groupByNumber<T extends { truck_number: string }>(rows: T[]): NumberGroup<T>[] {
  const groups = new Map<string, T[]>();
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
  searchParams: Promise<{
    q?: string;
    page?: string;
    matches?: string;
    shared?: string;
    busy?: string;
    accounts?: string;
  }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const { q, page: pageParam, matches: matchesParam } = params;
  const admin = getSupabaseAdmin();

  const term = (q ?? "").trim();
  const plate = normalizeTruckNumber(term);
  const like = safeTerm(term);

  const groupsPage = pageFromParam(pageParam);
  const matchesPage = pageFromParam(matchesParam);

  /* --------------------------------------------------------------------- */
  /* A search runs both ways at once - the box does not ask which you meant  */
  /* --------------------------------------------------------------------- */

  const truckHits: TruckDirectoryRow[] = [];
  let accountHits: OfficerOverview[] = [];
  let accountTotal = 0;
  let accountTrucks = new Map<string, TruckDirectoryRow[]>();
  let accountActivity = new Map<string, CreditActivity[]>();

  if (term) {
    const matchRange = pageRange(matchesPage, MATCHES_PAGE);
    const [{ data: byNumber }, { data: byAccount, count }] = await Promise.all([
      plate.length >= 3
        ? admin
            .from("truck_directory")
            .select("*")
            .ilike("truck_number", `%${plate}%`)
            .order("truck_number")
            .limit(SEARCH_ROW_CAP)
        : Promise.resolve({ data: [] }),
      like
        ? admin
            .from("officer_overview")
            .select("*", { count: "exact" })
            .eq("role", "officer")
            .or(
              `full_name.ilike.%${like}%,email.ilike.%${like}%,phone.ilike.%${like}%,office.ilike.%${like}%,district.ilike.%${like}%`,
            )
            .order("full_name")
            .range(matchRange.from, matchRange.to)
        : Promise.resolve({ data: [], count: 0 }),
    ]);

    truckHits.push(...((byNumber ?? []) as TruckDirectoryRow[]));
    accountHits = (byAccount ?? []) as OfficerOverview[];
    accountTotal = count ?? accountHits.length;

    /**
     * The follow-ups are one query per matched account, and only while few
     * enough match to be worth opening. Each is capped at a page's worth with
     * a link to the paginated view for the rest, rather than a silent cut.
     */
    if (accountTotal <= FULL_PROFILE_LIMIT && accountHits.length > 0) {
      const loaded = await Promise.all(
        accountHits.map(async (account) => {
          const [{ data: trucks }, { data: activity }] = await Promise.all([
            admin
              .from("truck_directory")
              .select("*")
              .eq("officer_id", account.id)
              .order("last_event_at", { ascending: false, nullsFirst: false })
              .limit(TRUCKS_PER_ACCOUNT),
            // credit_activity, not the raw ledger: top-ups stay itemised and a
            // week of half-credit checks is a handful of lines, not hundreds.
            admin
              .from("credit_activity")
              .select("*")
              .eq("user_id", account.id)
              .order("created_at", { ascending: false })
              .limit(ACTIVITY_PER_ACCOUNT),
          ]);
          return {
            id: account.id,
            trucks: (trucks ?? []) as TruckDirectoryRow[],
            activity: (activity ?? []) as CreditActivity[],
          };
        }),
      );

      accountTrucks = new Map(loaded.map((row) => [row.id, row.trucks]));
      accountActivity = new Map(loaded.map((row) => [row.id, row.activity]));
    }
  }

  const allHitGroups = groupByNumber(truckHits).sort(
    (a, b) => b.rows.length - a.rows.length || a.number.localeCompare(b.number),
  );
  const groups = pageSlice(allHitGroups, groupsPage, GROUPS_PAGE);
  const nothingFound = Boolean(term) && allHitGroups.length === 0 && accountTotal === 0;

  /* --------------------------------------------------------------------- */
  /* With an empty box, the interesting thing is the fleet as a whole        */
  /* --------------------------------------------------------------------- */

  let scan: ScanRow[] = [];
  let scanCapped = false;
  let trackedTotal = 0;
  let accounts: OfficerOverview[] = [];

  if (!term) {
    const [scanned, { data: all }, { count: tracked }] = await Promise.all([
      scanDirectory(admin),
      admin.from("officer_overview").select("*").eq("role", "officer"),
      admin.from("truck_directory").select("tracked_truck_id", { count: "exact", head: true }),
    ]);
    scan = scanned.rows;
    scanCapped = scanned.capped;
    accounts = (all ?? []) as OfficerOverview[];
    trackedTotal = tracked ?? scanned.rows.length;
  }

  const allGroups = groupByNumber(scan);
  const sharedNumbers = allGroups
    .filter((group) => new Set(group.rows.map((row) => row.officer_id)).size > 1)
    .sort((a, b) => b.rows.length - a.rows.length);
  const busiestNumbers = [...allGroups].sort(
    (a, b) =>
      b.rows.reduce((sum, row) => sum + row.event_count, 0) -
      a.rows.reduce((sum, row) => sum + row.event_count, 0),
  );
  const bySpend = [...accounts].sort(
    (a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0),
  );

  const sharedPage = pageFromParam(params.shared);
  const busyPage = pageFromParam(params.busy);
  const accountsPage = pageFromParam(params.accounts);

  return (
    <>
      <PageHeader
        title="Explore"
        subtitle="One box for both questions: who is watching this truck, and what is this account watching?"
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
            placeholder="Truck number, or a name, email, phone or office"
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
            description="Truck numbers are matched with spaces and dashes ignored. People are matched on name, email, phone, office and district."
          />
        </Panel>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Truck number -> every account watching it                           */}
      {/* ------------------------------------------------------------------ */}
      {allHitGroups.length > 0 ? (
        <section className="mb-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">
            {allHitGroups.length === 1
              ? "1 truck number matches"
              : `${fmtNumber(allHitGroups.length)} truck numbers match`}
          </h2>

          {groups.map((group) => {
            const watchers = new Set(group.rows.map((row) => row.officer_id)).size;
            return (
              <Panel
                key={group.number}
                title={group.number}
                description={
                  watchers === 1
                    ? "Watched by one account."
                    : `Watched by ${watchers} accounts — the same number is on more than one list.`
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
                    <th className="th">Account</th>
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
                            <Avatar size="sm" text={initials(row.officer_name, row.officer_email)} />
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

          <Pager
            page={groupsPage}
            pageSize={GROUPS_PAGE}
            total={allHitGroups.length}
            noun="truck numbers"
            href={{ path: "/admin/explore", params: { q: term, matches: matchesParam } }}
          />

          {truckHits.length === SEARCH_ROW_CAP ? (
            <CapNote>
              A search reads at most {fmtNumber(SEARCH_ROW_CAP)} tracked trucks, and that many were
              found — there may be more numbers than the pages below show. Type more of the number to
              narrow it.
            </CapNote>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Account -> profile, trucks, credit history                          */}
      {/* ------------------------------------------------------------------ */}
      {accountTotal > FULL_PROFILE_LIMIT ? (
        <section className="mb-6">
          <Panel
            title={`${fmtNumber(accountTotal)} accounts match`}
            description="Too many to open at once. Pick one."
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-divider">
              {accountHits.map((account) => (
                <li key={account.id}>
                  <Link
                    href={`/admin/explore?q=${encodeURIComponent(account.email)}`}
                    className="flex items-center gap-3 px-5 py-3 transition hover:bg-raised/60"
                  >
                    <Avatar size="sm" text={initials(account.full_name, account.email)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {account.full_name ?? account.email}
                      </span>
                      <span className="block truncate text-xs text-faint">
                        {account.email} · {account.office ?? "no office recorded"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {fmtNumber(account.active_trucks)} trucks
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Pager
            page={matchesPage}
            pageSize={MATCHES_PAGE}
            total={accountTotal}
            noun="accounts"
            href={{
              path: "/admin/explore",
              params: { q: term, page: pageParam },
              pageKey: "matches",
            }}
          />
        </section>
      ) : (
        accountHits.map((account) => {
          const trucks = accountTrucks.get(account.id) ?? [];
          const activity = accountActivity.get(account.id) ?? [];
          const balance = Number(account.credits ?? 0);

          return (
            <section key={account.id} className="mb-6 space-y-5">
              <Panel
                title={account.full_name ?? account.email}
                description={account.designation ?? "No designation recorded"}
                actions={
                  <Link
                    href={`/admin/officers/${account.id}`}
                    className="text-xs text-brand-400 hover:underline"
                  >
                    Full account page
                  </Link>
                }
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="flex items-center gap-1.5 text-muted">
                    <Mail size={13} className="text-faint" />
                    <a href={`mailto:${account.email}`} className="hover:text-brand-500">
                      {account.email}
                    </a>
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    <Phone size={13} className="text-faint" />
                    {account.phone ?? "--"}
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    <Building2 size={13} className="text-faint" />
                    {account.office ?? "--"}
                  </span>
                  <span className="flex items-center gap-1.5 text-muted">
                    <MapPin size={13} className="text-faint" />
                    {[account.district, account.state].filter(Boolean).join(", ") || "--"}
                  </span>
                  <Badge tone={account.status === "suspended" ? "bad" : "good"}>
                    {account.status === "suspended" ? "Suspended" : "Active"}
                  </Badge>
                  {/* No plan is where a new signup starts, so it reads as a
                      state rather than a fault. */}
                  {account.plan_name ? (
                    <Badge tone={account.plan_active ? "brand" : "warn"}>
                      {account.plan_name}
                      {account.plan_active ? "" : " — not live"}
                    </Badge>
                  ) : (
                    <Badge>No plan yet</Badge>
                  )}
                </div>
              </Panel>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="Credits left"
                  value={formatCredits(balance)}
                  sub={`${formatCredits(account.credits_purchased)} bought in total`}
                  tone={balance <= 0 ? "bad" : balance < 20 ? "warn" : "brand"}
                />
                <StatCard
                  label="Spent this month"
                  value={formatCredits(account.credits_spent_month)}
                  sub={`${formatCredits(account.credits_spent_today)} today`}
                />
                <StatCard
                  label="Calls this month"
                  value={fmtNumber(
                    account.manual_searches_month + account.tracking_queries_month,
                  )}
                  sub={`${fmtNumber(account.manual_searches_month)} manual · ${fmtNumber(account.tracking_queries_month)} automatic`}
                />
                <StatCard
                  label="Trucks tracked"
                  value={fmtNumber(account.active_trucks)}
                  sub={`${fmtNumber(account.total_trucks)} on the list in all`}
                  tone="brand"
                />
              </div>

              <Panel
                title="Trucks they track"
                description={
                  account.total_trucks > trucks.length
                    ? `The ${trucks.length} with the newest events, out of ${fmtNumber(account.total_trucks)}.`
                    : "Every number on this list, newest event first."
                }
                bodyClassName="p-0"
                actions={
                  <Link
                    href={`/admin/trucks?officer=${account.id}`}
                    className="text-xs text-brand-400 hover:underline"
                  >
                    All of them, paged
                  </Link>
                }
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
                description="Top-ups one by one; usage totalled per day, so a week of checks is a few lines."
                bodyClassName="p-0"
                actions={
                  <Link
                    href={`/admin/officers/${account.id}`}
                    className="text-xs text-brand-400 hover:underline"
                  >
                    Full history
                  </Link>
                }
              >
                {activity.length === 0 ? (
                  <EmptyState title="Nothing charged yet" />
                ) : (
                  <ul className="divide-y divide-divider">
                    {activity.map((row) => (
                      <li
                        key={`${row.activity_date}-${row.reason}-${row.created_at}`}
                        className="flex items-center justify-between gap-3 px-5 py-2.5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">
                            {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                            {row.truck_number ? (
                              <span className="text-faint"> · {row.truck_number}</span>
                            ) : null}
                            {row.is_rollup ? (
                              <span className="text-faint">
                                {" "}
                                · {fmtNumber(row.entries)} charges
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-xs text-faint">
                            {row.is_rollup ? row.activity_date : fmtDateTime(row.created_at)}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-sm font-medium tabular-nums ${
                            Number(row.amount) < 0 ? "text-muted" : "text-good-500"
                          }`}
                        >
                          {Number(row.amount) > 0 ? "+" : "-"}
                          {formatCredits(Math.abs(Number(row.amount)))}
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
              value={fmtNumber(trackedTotal)}
              sub="Rows across every account's list"
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
                  ? "Same number, different accounts"
                  : "No number is on two lists"
              }
              tone={sharedNumbers.length > 0 ? "warn" : "neutral"}
            />
            <StatCard
              label="Accounts"
              value={fmtNumber(accounts.length)}
              sub={`${accounts.filter((row) => row.status === "active").length} active`}
              icon={<Users size={15} />}
            />
          </div>

          {scanCapped ? (
            <CapNote>
              The three figures above and the two panels below are worked out from the first{" "}
              {fmtNumber(SCAN_BATCH * MAX_SCAN_BATCHES)} tracked trucks, which is as far as one
              sweep reads. Everything past that is missing from them — the fleet view has the
              complete, paged list.
            </CapNote>
          ) : null}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div>
              <Panel
                title="Watched by more than one account"
                description="The same registration number on two lists. Usually two people working the same consignment, and worth knowing before either of them calls."
                bodyClassName="p-0"
              >
                {sharedNumbers.length === 0 ? (
                  <EmptyState
                    title="No overlap"
                    description="Every tracked number belongs to exactly one account."
                  />
                ) : (
                  <ul className="divide-y divide-divider">
                    {pageSlice(sharedNumbers, sharedPage, SHARED_PAGE).map((group) => (
                      <li key={group.number} className="px-5 py-3">
                        <Link
                          href={`/admin/explore?q=${group.number}`}
                          className="flex items-center justify-between gap-3"
                        >
                          <Mono className="font-semibold text-ink hover:text-brand-500">
                            {group.number}
                          </Mono>
                          <Badge tone="warn">{group.rows.length} accounts</Badge>
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

              <Pager
                page={sharedPage}
                pageSize={SHARED_PAGE}
                total={sharedNumbers.length}
                noun="numbers"
                href={{
                  path: "/admin/explore",
                  params: { busy: params.busy, accounts: params.accounts },
                  pageKey: "shared",
                }}
              />
            </div>

            <div>
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
                      {pageSlice(busiestNumbers, busyPage, BUSY_PAGE).map((group) => {
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

              <Pager
                page={busyPage}
                pageSize={BUSY_PAGE}
                total={busiestNumbers.length}
                noun="numbers"
                href={{
                  path: "/admin/explore",
                  params: { shared: params.shared, accounts: params.accounts },
                  pageKey: "busy",
                }}
              />
            </div>

            <div className="xl:col-span-2">
              <Panel
                title="Accounts by credits spent this month"
                description="Who is actually working the platform. Click through for their trucks and contact details."
                bodyClassName="p-0"
              >
                {bySpend.length === 0 ? (
                  <EmptyState title="No accounts yet" />
                ) : (
                  <TableWrap>
                    <Thead>
                      <th className="th">Account</th>
                      <th className="th">Contact</th>
                      <th className="th">Posting</th>
                      <th className="th text-right">Trucks</th>
                      <th className="th text-right">Credits left</th>
                      <th className="th text-right">Spent this month</th>
                      <th className="th">Last event</th>
                    </Thead>
                    <Tbody>
                      {pageSlice(bySpend, accountsPage, ACCOUNTS_PAGE).map((account) => (
                        <Tr key={account.id}>
                          <td className="td">
                            <Link
                              href={`/admin/officers/${account.id}`}
                              className="group flex items-center gap-2.5"
                            >
                              <Avatar size="sm" text={initials(account.full_name, account.email)} />
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                                  {account.full_name ?? account.email}
                                </span>
                                <span className="block truncate text-xs text-faint">
                                  {account.designation ?? "--"}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="td">
                            <span className="block truncate text-xs text-muted">
                              {account.email}
                            </span>
                            <span className="block text-xs text-faint">
                              {account.phone ?? "--"}
                            </span>
                          </td>
                          <td className="td">
                            <span className="block text-sm text-ink">{account.office ?? "--"}</span>
                            <span className="block text-xs text-faint">
                              {[account.district, account.state].filter(Boolean).join(", ") || "--"}
                            </span>
                          </td>
                          <td className="td text-right text-sm tabular-nums text-muted">
                            {fmtNumber(account.active_trucks)}
                          </td>
                          <td className="td text-right">
                            <Badge
                              tone={
                                Number(account.credits ?? 0) <= 0
                                  ? "bad"
                                  : Number(account.credits ?? 0) < 20
                                    ? "warn"
                                    : "good"
                              }
                            >
                              {formatCredits(account.credits)}
                            </Badge>
                          </td>
                          <td className="td text-right text-sm font-medium tabular-nums text-ink">
                            {formatCredits(account.credits_spent_month)}
                          </td>
                          <td className="td text-xs whitespace-nowrap text-muted">
                            {fmtRelative(account.last_event_at)}
                          </td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableWrap>
                )}
              </Panel>

              <Pager
                page={accountsPage}
                pageSize={ACCOUNTS_PAGE}
                total={bySpend.length}
                noun="accounts"
                href={{
                  path: "/admin/explore",
                  params: { shared: params.shared, busy: params.busy },
                  pageKey: "accounts",
                }}
              />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
