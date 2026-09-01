import Link from "next/link";
import { ArrowLeft, Bell, ClipboardList, Search } from "lucide-react";

import { Badge, EmptyState, Mono, Panel, buttonClass, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, AuditLog, SearchLog } from "@/lib/types";

/**
 * Every log the platform keeps, in one place.
 *
 * There were four screens showing logs and a fifth previewing them: the audit
 * page, the alert delivery log, the alert-rules page's preview, the overview's
 * "recent admin activity" panel, and a customer's activity tab. Each had its
 * own filters, its own pager and its own row layout for the same three tables,
 * so "find what happened around 4pm on Tuesday" meant guessing which screen
 * held it and then learning that screen's controls.
 *
 * One surface, three record types, one set of filters that mean the same thing
 * in all three. Everything else links here rather than rendering its own copy -
 * a panel that says "3 failed deliveries" and sends you to the filtered list is
 * more useful than the list repeated in a corner of a dashboard.
 *
 * URL-driven, like the credit ledger and for the same reasons: no JavaScript, a
 * filtered view can be pasted into a message, and the back button behaves. On a
 * page whose whole purpose is investigating something, being able to link to
 * exactly what you are looking at matters more than a smooth transition.
 */

export type LogType = "searches" | "alerts" | "admin";

export type LogQuery = {
  type?: string;
  officer?: string;
  truck?: string;
  date?: string;
  status?: string;
  action?: string;
  page?: string;
};

const PAGE_SIZE = 50;
/** How far back the filters reach. Past this, the retention purge has been. */
const WINDOW_DAYS = 90;

const TYPES: { key: LogType; label: string; icon: typeof Search; hint: string }[] = [
  { key: "searches", label: "Searches & checks", icon: Search, hint: "Every lookup, manual or automatic" },
  { key: "alerts", label: "Alerts sent", icon: Bell, hint: "What went out, and what failed to" },
  { key: "admin", label: "Admin actions", icon: ClipboardList, hint: "Who changed what in the console" },
];

function parseType(raw: string | undefined): LogType {
  return raw === "alerts" || raw === "admin" ? raw : "searches";
}

/** One IST day as the UTC instants that bound it, so an index can still be used. */
function istDayBounds(date: string): { from: string; to: string } | null {
  const start = new Date(`${date}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) return null;
  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

function href(basePath: string, query: LogQuery, patch: Partial<LogQuery>): string {
  const merged = { ...query, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (key === "page" && patch.page === undefined) continue;
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export async function LogExplorer({
  basePath = "/admin/logs",
  query,
}: {
  basePath?: string;
  query: LogQuery;
}) {
  const admin = getSupabaseAdmin();
  const type = parseType(query.type);
  const page = Math.max(Number(query.page) || 1, 1);
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const bounds = query.date ? istDayBounds(query.date) : null;

  /* Named once, here, so a row can show who did something without every list
     joining profiles itself and formatting the name differently. */
  const { data: people } = await admin
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name");
  const nameOf = new Map(
    ((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [
      p.id,
      p.full_name?.trim() || p.email,
    ]),
  );

  return (
    <div className="space-y-3">
      {/* One row of cards rather than a tab strip: each type needs a sentence
          to be picked correctly, and a tab has room for two words. */}
      <div className="grid gap-2 sm:grid-cols-3">
        {TYPES.map(({ key, label, icon: Icon, hint }) => {
          const active = type === key;
          return (
            <Link
              key={key}
              href={href(basePath, query, { type: key, status: undefined, action: undefined })}
              className={cx(
                "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition",
                active
                  ? "border-brand-500 bg-brand-500/8"
                  : "border-line bg-panel hover:border-line-strong",
              )}
            >
              <span
                className={cx(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border",
                  active
                    ? "border-brand-500/30 bg-brand-500/12 text-brand-500"
                    : "border-line bg-raised text-muted",
                )}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span
                  className={cx(
                    "block text-sm font-medium",
                    active ? "text-brand-500" : "text-ink",
                  )}
                >
                  {label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{hint}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <Panel bodyClassName="p-0">
        <div className="space-y-3 border-b border-divider px-4 py-3">
          {/* Same three filters on every type, because "whose", "which lorry"
              and "which day" are the questions regardless of which log holds
              the answer. Only the fourth chip row changes with the type. */}
          <FilterForm basePath={basePath} query={query} type={type} people={people ?? []} />

          {type === "searches" ? (
            <ChipRow label="Result">
              {[
                { value: undefined, label: "Any" },
                { value: "ok", label: "Succeeded" },
                { value: "failed", label: "Failed" },
              ].map((option) => (
                <Chip
                  key={option.label}
                  href={href(basePath, query, { status: option.value })}
                  active={(query.status ?? undefined) === option.value}
                >
                  {option.label}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {type === "alerts" ? (
            <ChipRow label="Delivery">
              {[
                { value: undefined, label: "Any" },
                { value: "ok", label: "Delivered" },
                { value: "failed", label: "Not delivered" },
              ].map((option) => (
                <Chip
                  key={option.label}
                  href={href(basePath, query, { status: option.value })}
                  active={(query.status ?? undefined) === option.value}
                >
                  {option.label}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {query.officer || query.truck || query.date || query.status ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-3">
              <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                Filtered
              </span>
              {query.officer ? (
                <span className="text-xs text-ink">{nameOf.get(query.officer) ?? "Unknown"}</span>
              ) : null}
              {query.truck ? <Mono className="text-xs">{query.truck}</Mono> : null}
              {query.date ? <span className="text-xs text-ink">{query.date}</span> : null}
              <Link
                href={href(basePath, { type: query.type }, {})}
                className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
              >
                <ArrowLeft size={12} />
                Clear all
              </Link>
            </div>
          ) : null}
        </div>

        {type === "searches" ? (
          <SearchRows
            basePath={basePath}
            query={query}
            page={page}
            since={since}
            bounds={bounds}
            nameOf={nameOf}
          />
        ) : type === "alerts" ? (
          <AlertRows
            basePath={basePath}
            query={query}
            page={page}
            since={since}
            bounds={bounds}
            nameOf={nameOf}
          />
        ) : (
          <AdminRows basePath={basePath} query={query} page={page} since={since} bounds={bounds} />
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* the three lists                                                             */
/* -------------------------------------------------------------------------- */

type ListProps = {
  basePath: string;
  query: LogQuery;
  page: number;
  since: string;
  bounds: { from: string; to: string } | null;
  nameOf: Map<string, string>;
};

async function SearchRows({ basePath, query, page, since, bounds, nameOf }: ListProps) {
  let request = getSupabaseAdmin()
    .from("search_logs")
    .select("*", { count: "exact" })
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (query.officer) request = request.eq("user_id", query.officer);
  if (query.truck) request = request.ilike("truck_number", `%${query.truck}%`);
  if (query.status === "ok") request = request.eq("ok", true);
  if (query.status === "failed") request = request.eq("ok", false);
  if (bounds) request = request.gte("created_at", bounds.from).lt("created_at", bounds.to);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await request.range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as SearchLog[];

  if (rows.length === 0) return <NoRows />;

  return (
    <>
      <ul className="divide-y divide-divider">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={href(basePath, query, { truck: row.truck_number })}
                  className="font-mono text-xs font-medium text-ink hover:text-brand-500"
                >
                  {row.truck_number}
                </Link>
                <Badge tone={row.source === "tracking" ? "neutral" : "brand"}>
                  {row.source === "tracking" ? "automatic" : "manual"}
                </Badge>
                {row.ok ? null : <Badge tone="bad">failed</Badge>}
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">
                {fmtDateTime(row.created_at)}
                {" · "}
                <Link
                  href={href(basePath, query, { officer: row.user_id })}
                  className="hover:text-brand-500"
                >
                  {nameOf.get(row.user_id) ?? "Unknown account"}
                </Link>
                {row.error ? ` · ${row.error}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right text-[11px] text-faint tabular-nums">
              <span className="block">
                {row.new_events > 0 ? `${row.new_events} new` : "nothing new"}
              </span>
              {row.response_ms === null ? null : <span className="block">{row.response_ms} ms</span>}
            </span>
          </li>
        ))}
      </ul>
      <Pager basePath={basePath} query={query} page={page} count={count ?? rows.length} />
    </>
  );
}

async function AlertRows({ basePath, query, page, since, bounds, nameOf }: ListProps) {
  let request = getSupabaseAdmin()
    .from("alert_logs")
    .select("*", { count: "exact" })
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (query.officer) request = request.eq("user_id", query.officer);
  if (query.truck) request = request.ilike("truck_number", `%${query.truck}%`);
  if (query.status === "ok") request = request.eq("delivered", true);
  if (query.status === "failed") request = request.eq("delivered", false);
  if (bounds) request = request.gte("created_at", bounds.from).lt("created_at", bounds.to);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await request.range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as AlertLog[];

  if (rows.length === 0) return <NoRows />;

  return (
    <>
      <ul className="divide-y divide-divider">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-medium text-ink">{row.title}</span>
                {row.truck_number ? (
                  <Link
                    href={href(basePath, query, { truck: row.truck_number })}
                    className="font-mono text-[11px] text-muted hover:text-brand-500"
                  >
                    {row.truck_number}
                  </Link>
                ) : null}
                {row.delivered ? null : <Badge tone="warn">not sent</Badge>}
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">
                {fmtDateTime(row.created_at)}
                {" · "}
                <Link
                  href={href(basePath, query, { officer: row.user_id })}
                  className="hover:text-brand-500"
                >
                  {nameOf.get(row.user_id) ?? "Unknown account"}
                </Link>
                {row.delivery_error ? ` · ${row.delivery_error}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Pager basePath={basePath} query={query} page={page} count={count ?? rows.length} />
    </>
  );
}

async function AdminRows({
  basePath,
  query,
  page,
  since,
  bounds,
}: Omit<ListProps, "nameOf">) {
  let request = getSupabaseAdmin()
    .from("audit_logs")
    .select("*", { count: "exact" })
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (query.officer) request = request.eq("actor_id", query.officer);
  if (query.action) request = request.eq("action", query.action);
  if (bounds) request = request.gte("created_at", bounds.from).lt("created_at", bounds.to);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await request.range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as AuditLog[];

  if (rows.length === 0) return <NoRows />;

  return (
    <>
      <ul className="divide-y divide-divider">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-medium text-ink">
                  {row.action.replace(/[._]/g, " ")}
                </span>
                {row.entity_label ? (
                  <span className="text-[11px] text-muted">{row.entity_label}</span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">
                {fmtDateTime(row.created_at)}
                {row.actor_email ? ` · ${row.actor_email}` : ""}
                {row.entity ? ` · ${row.entity}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Pager basePath={basePath} query={query} page={page} count={count ?? rows.length} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* small pieces                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Officer, truck and day as a GET form.
 *
 * A form rather than chips because two of these are free text - a truck number
 * and a date cannot be a fixed list of links, and offering every account as a
 * chip stops working at thirty customers.
 */
function FilterForm({
  basePath,
  query,
  type,
  people,
}: {
  basePath: string;
  query: LogQuery;
  type: LogType;
  people: { id: string; full_name: string | null; email: string }[];
}) {
  return (
    <form method="get" action={basePath} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
      <input type="hidden" name="type" value={type} />
      {query.status ? <input type="hidden" name="status" value={query.status} /> : null}

      <select
        name="officer"
        defaultValue={query.officer ?? ""}
        aria-label={type === "admin" ? "Who did it" : "Which account"}
        className="field appearance-none py-1.5 text-xs"
      >
        <option value="">{type === "admin" ? "Anyone" : "Every account"}</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.full_name?.trim() || person.email}
          </option>
        ))}
      </select>

      {type === "admin" ? (
        <span />
      ) : (
        <input
          name="truck"
          defaultValue={query.truck ?? ""}
          placeholder="Any truck number"
          aria-label="Truck number"
          className="field py-1.5 font-mono text-xs uppercase placeholder:font-sans placeholder:normal-case"
        />
      )}

      <input
        name="date"
        type="date"
        defaultValue={query.date ?? ""}
        aria-label="One day only"
        className="field py-1.5 text-xs"
      />

      <button type="submit" className={buttonClass("secondary", "sm")}>
        Apply
      </button>
    </form>
  );
}

function NoRows() {
  return (
    <EmptyState
      title="Nothing matches"
      description="No entries for that combination in the last 90 days. Older entries may already have been purged by the retention rules."
    />
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 shrink-0 text-[11px] font-semibold tracking-wider text-faint uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  href: to,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={to}
      className={cx(
        "inline-flex min-h-8 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition",
        active
          ? "border-brand-500 bg-brand-500/10 text-brand-500"
          : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

function Pager({
  basePath,
  query,
  page,
  count,
}: {
  basePath: string;
  query: LogQuery;
  page: number;
  count: number;
}) {
  const pageCount = Math.max(Math.ceil(count / PAGE_SIZE), 1);
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-divider px-4 py-3">
      {page > 1 ? (
        <Link
          href={href(basePath, query, { page: String(page - 1) })}
          className={buttonClass("secondary", "sm")}
        >
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-[11px] text-faint tabular-nums">
        Page {page} of {pageCount} · {count.toLocaleString("en-IN")} entries
      </span>
      {page < pageCount ? (
        <Link
          href={href(basePath, query, { page: String(page + 1) })}
          className={buttonClass("secondary", "sm")}
        >
          Next
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
