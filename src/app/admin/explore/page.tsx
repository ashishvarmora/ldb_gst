import Link from "next/link";
import { Coins, Eye, Search, Truck, User } from "lucide-react";

import {
  Avatar,
  Badge,
  EmptyState,
  LinkCard,
  Mono,
  PageHeader,
  Panel,
  buttonClass,
  cx,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtNumber, fmtRelative, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, TruckDirectoryRow } from "@/lib/types";

export const metadata = { title: "Explore — Rahdari admin" };

/**
 * One box, two questions: who has taken an interest in this lorry, and what has
 * this account taken an interest in?
 *
 * It used to answer neither properly. It searched truck_directory, which says
 * who is TRACKING a truck - a standing arrangement - and had nothing for who has
 * SEARCHED one, which is the question that actually gets asked when a number
 * comes up. And with an empty box it scanned the entire directory in batches to
 * draw platform-wide statistics, which is the dashboard's job: the same figures
 * were on the overview, computed differently, and the scan was the most
 * expensive query in the console.
 *
 * So it is a resolver now. It turns what you typed into a subject, shows the
 * compact profile of that subject, and hands off to the screens that own the
 * detail - the log for individual lookups, the ledger for money. Nothing here
 * renders a list that lives somewhere else, which is what keeps it short.
 */

/** Enough matches to choose from; past this, the term needs to be narrower. */
const MATCH_LIMIT = 25;
/** Accounts shown against one truck number before the rest are summarised. */
const PER_TRUCK = 8;

type SearchSummary = {
  truck_number: string;
  user_id: string;
  searches: number;
  manual: number;
  automatic: number;
  failed: number;
  last_at: string;
};

/** Strips what would otherwise break a PostgREST or/ilike filter. */
function safeTerm(raw: string): string {
  return raw.replace(/[(),*%\\]/g, " ").trim();
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const raw = (await searchParams).q ?? "";
  const term = safeTerm(raw).slice(0, 60);
  const plate = term.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  /*
   * Both interpretations are tried at once rather than guessing from the shape
   * of the input. "GJ27" is a plate; "Sharma" is a person; "27" could be
   * either, and running both costs two indexed queries.
   */
  const [searchHits, directoryHits, accountHits] = term
    ? await Promise.all([
        plate.length >= 3
          ? admin
              .from("truck_search_summary")
              .select("*")
              .ilike("truck_number", `%${plate}%`)
              .order("last_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [] }),
        plate.length >= 3
          ? admin
              .from("truck_directory")
              .select("*")
              .ilike("truck_number", `%${plate}%`)
              .limit(200)
          : Promise.resolve({ data: [] }),
        admin
          .from("officer_overview")
          .select("*")
          .eq("role", "officer")
          .or(
            `full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,office.ilike.%${term}%,district.ilike.%${term}%`,
          )
          .order("full_name")
          .limit(MATCH_LIMIT),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const summaries = (searchHits.data ?? []) as SearchSummary[];
  const tracking = (directoryHits.data ?? []) as TruckDirectoryRow[];
  const accounts = (accountHits.data ?? []) as OfficerOverview[];

  /* Names once, here, so no row has to join profiles for a label. */
  const { data: people } = await admin.from("profiles").select("id, full_name, email");
  const nameOf = new Map(
    ((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [
      p.id,
      p.full_name?.trim() || p.email,
    ]),
  );

  /* One entry per truck number, carrying who searched it and who tracks it. */
  const byNumber = new Map<
    string,
    { searchers: SearchSummary[]; trackers: TruckDirectoryRow[] }
  >();
  for (const row of summaries) {
    const entry = byNumber.get(row.truck_number) ?? { searchers: [], trackers: [] };
    entry.searchers.push(row);
    byNumber.set(row.truck_number, entry);
  }
  for (const row of tracking) {
    const entry = byNumber.get(row.truck_number) ?? { searchers: [], trackers: [] };
    entry.trackers.push(row);
    byNumber.set(row.truck_number, entry);
  }

  const trucks = [...byNumber.entries()]
    .sort((a, b) => b[1].searchers.length - a[1].searchers.length || a[0].localeCompare(b[0]))
    .slice(0, MATCH_LIMIT);

  const nothingFound = Boolean(term) && trucks.length === 0 && accounts.length === 0;

  return (
    <>
      <PageHeader
        title="Explore"
        subtitle="Type a registration number to see which accounts have looked it up, or a name to see what one account has been doing."
      />

      <Panel className="mb-5">
        <form method="get" action="/admin/explore" className="flex gap-2">
          <input
            name="q"
            defaultValue={raw}
            autoFocus
            placeholder="GJ27TD6880, or a name, email, phone or office"
            aria-label="Registration number, name, email, phone or office"
            className="field flex-1"
          />
          <button type="submit" className={buttonClass("primary", "md")}>
            <Search size={15} />
            Find
          </button>
        </form>
      </Panel>

      {!term ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="Two questions, one box"
            description="A registration number answers “which accounts have taken an interest in this lorry, and who is tracking it”. A name, email, phone or office answers “what has this account been doing”. Platform-wide figures are on the overview; individual lookups are in the logs."
          />
        </Panel>
      ) : null}

      {nothingFound ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title={`Nothing matches “${term}”`}
            description="No account and no recorded lookup matches that. Note that logs older than the retention window have been purged, so a lorry looked up months ago may leave no trace."
          />
        </Panel>
      ) : null}

      {/* ----------------------------- trucks ----------------------------- */}
      {trucks.length > 0 ? (
        <div className="mb-5 space-y-3">
          <h2 className="text-sm font-semibold text-strong">
            {trucks.length === 1 ? "1 registration number" : `${trucks.length} registration numbers`}
          </h2>

          {trucks.map(([number, { searchers, trackers }]) => {
            const total = searchers.reduce((sum, r) => sum + Number(r.searches), 0);
            const manual = searchers.reduce((sum, r) => sum + Number(r.manual), 0);
            const shown = [...searchers]
              .sort((a, b) => Number(b.searches) - Number(a.searches))
              .slice(0, PER_TRUCK);

            return (
              <Panel key={number} bodyClassName="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-3">
                  <span className="flex items-center gap-2">
                    <Truck size={15} className="shrink-0 text-faint" />
                    <Mono className="text-base font-semibold text-strong">{number}</Mono>
                    {trackers.length > 0 ? (
                      <Badge tone="brand">
                        tracked by {trackers.length === 1 ? "1 account" : `${trackers.length} accounts`}
                      </Badge>
                    ) : (
                      <Badge>not tracked</Badge>
                    )}
                    {searchers.length > 1 ? (
                      <Badge tone="warn">{searchers.length} accounts interested</Badge>
                    ) : null}
                  </span>
                  <Link
                    href={`/admin/logs?type=searches&truck=${encodeURIComponent(number)}`}
                    className={buttonClass("secondary", "sm")}
                  >
                    <Eye size={13} />
                    Every lookup
                  </Link>
                </div>

                {shown.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-muted">
                    Nobody has looked this number up inside the retention window.
                  </p>
                ) : (
                  <ul className="divide-y divide-divider">
                    {shown.map((row) => (
                      <li key={row.user_id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1">
                          <Link
                            href={`/admin/officers/${row.user_id}`}
                            className="block truncate text-sm font-medium text-ink hover:text-brand-500"
                          >
                            {nameOf.get(row.user_id) ?? "Unknown account"}
                          </Link>
                          <span className="mt-0.5 block text-[11px] text-faint">
                            {fmtNumber(row.manual)} manual · {fmtNumber(row.automatic)} automatic
                            {Number(row.failed) > 0 ? ` · ${fmtNumber(row.failed)} failed` : ""} ·
                            last {fmtRelative(row.last_at)}
                          </span>
                        </span>
                        <Link
                          href={`/admin/logs?type=searches&truck=${encodeURIComponent(number)}&officer=${row.user_id}`}
                          className="shrink-0 text-xs font-medium text-brand-500 hover:underline"
                        >
                          {fmtNumber(row.searches)} lookups
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                {/* A count that was cut is said out loud rather than silently
                    dropped - a truncated list reads as a complete one. */}
                {searchers.length > shown.length ? (
                  <p className="border-t border-divider px-4 py-2 text-[11px] text-faint">
                    {searchers.length - shown.length} more account(s) have looked this number up.{" "}
                    <Link
                      href={`/admin/logs?type=searches&truck=${encodeURIComponent(number)}`}
                      className="text-brand-500 hover:underline"
                    >
                      See every lookup
                    </Link>
                    .
                  </p>
                ) : null}

                <p className="border-t border-divider bg-raised/40 px-4 py-2 text-[11px] text-muted tabular-nums">
                  {fmtNumber(total)} lookups in all — {fmtNumber(manual)} typed by hand,{" "}
                  {fmtNumber(total - manual)} from background checking.
                </p>
              </Panel>
            );
          })}
        </div>
      ) : null}

      {/* ---------------------------- accounts ---------------------------- */}
      {accounts.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-strong">
            {accounts.length === 1 ? "1 account" : `${accounts.length} accounts`}
            {accounts.length === MATCH_LIMIT ? " (narrow the term for more)" : ""}
          </h2>

          {accounts.map((account) => (
            <Panel key={account.id} bodyClassName="p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-4 py-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar size="sm" text={initials(account.full_name, account.email)} />
                  <span className="min-w-0">
                    <Link
                      href={`/admin/officers/${account.id}`}
                      className="block truncate text-sm font-semibold text-ink hover:text-brand-500"
                    >
                      {account.full_name?.trim() || account.email}
                    </Link>
                    <span className="block truncate text-[11px] text-faint">
                      {account.email}
                      {account.office ? ` · ${account.office}` : ""}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={account.status === "active" ? "good" : "warn"}>
                    {account.status}
                  </Badge>
                  <Badge tone={account.plan_active ? "brand" : "warn"}>
                    {account.plan_name ?? "no plan"}
                  </Badge>
                </span>
              </div>

              <dl className="grid grid-cols-2 divide-x divide-divider border-b border-divider sm:grid-cols-4">
                {[
                  { label: "Trucks tracked", value: fmtNumber(account.active_trucks) },
                  { label: "Manual, month", value: fmtNumber(account.manual_searches_month) },
                  { label: "Automatic, month", value: fmtNumber(account.tracking_queries_month) },
                  { label: "Credits left", value: fmtNumber(account.credits) },
                ].map(({ label, value }) => (
                  <div key={label} className="px-4 py-2.5">
                    <dt className="text-[10px] font-semibold tracking-wider text-faint uppercase">
                      {label}
                    </dt>
                    <dd
                      className={cx(
                        "mt-0.5 text-sm font-semibold tabular-nums",
                        label === "Credits left" && account.credits <= 0
                          ? "text-bad-500"
                          : "text-strong",
                      )}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* The detail lives on screens that own it. */}
              <div className="space-y-2 p-3">
                <LinkCard
                  href={`/admin/logs?type=searches&officer=${account.id}`}
                  icon={<Search size={16} />}
                  title="Everything they have looked up"
                  description="Filter by truck or by day."
                />
                <LinkCard
                  href={`/admin/officers/${account.id}?tab=credits`}
                  icon={<Coins size={16} />}
                  title="Credits and activity"
                  description="Per truck per day, per day, or charge by charge."
                />
                <LinkCard
                  href={`/admin/officers/${account.id}`}
                  icon={<User size={16} />}
                  title="Open the account"
                  description="Profile, plan, limits, trucks and settings."
                />
              </div>
            </Panel>
          ))}
        </div>
      ) : null}
    </>
  );
}
