import Link from "next/link";
import { Filter } from "lucide-react";

import { pageRange } from "../pager";
import { Input, Select } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import {
  Badge,
  EmptyState,
  Mono,
  PageHeader,
  Panel,
  buttonClass,
  cx,
  type BadgeTone,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDate, fmtNumber, fmtRelative, fmtTime, istToday } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AuditLog, Profile } from "@/lib/types";

export const metadata = { title: "Audit log — Admin" };

/**
 * The stored actor_role is still "officer" - it is a column value written by
 * every row already in the table, so only the label a reader sees changed.
 */
type RoleView = "officer" | "admin" | "all";

const ROLE_LABEL: Record<RoleView, string> = {
  officer: "Account activity",
  admin: "Admin activity",
  all: "Everything",
};

const PAGE_SIZE = 50;

function isRoleView(value: string | undefined): value is RoleView {
  return value === "officer" || value === "admin" || value === "all";
}

/**
 * Tone from the verb rather than a list of every action.
 *
 * A hardcoded map went stale the moment a new action was added, and a missing
 * entry is invisible - the row just renders grey. The verb is the last segment
 * of every action name we write, so read that instead.
 */
function toneFor(action: string): BadgeTone {
  const verb = action.split(".").pop() ?? "";
  if (/^(create|add|grant|reactivate|activate|login|purchase)$/.test(verb)) return "good";
  if (/^(delete|remove|suspend|purge|fail)$/.test(verb)) return "bad";
  if (/^(archive|deactivate|reset_password|set_overrides|update_payment|backup)$/.test(verb)) {
    return "warn";
  }
  if (/^(update|assign_plan|save|edit|reorder)$/.test(verb)) return "brand";
  return "neutral";
}

/**
 * The log broken into IST days, in the order it came back.
 *
 * One unbroken column of fifty entries reads as a wall - the eye has nothing to
 * stop on, and "when did this happen" needs the timestamp on every single row.
 * Grouped, the date is said once and each row only has to say the time.
 */
function byDay(rows: AuditLog[]): { date: string; rows: AuditLog[] }[] {
  const days: { date: string; rows: AuditLog[] }[] = [];
  for (const row of rows) {
    const date = new Date(row.created_at).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    const last = days[days.length - 1];
    if (last && last.date === date) last.rows.push(row);
    else days.push({ date, rows: [row] });
  }
  return days;
}

/**
 * The log narrowed to one person, keeping the view and the action filter. Never
 * the page number: entry 400 of everybody is not entry 400 of one account.
 */
function actorHref(actorId: string, view: RoleView, action: string | undefined): string {
  const query = new URLSearchParams({ actor: actorId });
  if (view !== "officer") query.set("role", view);
  if (action) query.set("action", action);
  return `/admin/audit?${query.toString()}`;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    action?: string;
    q?: string;
    actor?: string;
    page?: string;
  }>;
}) {
  await requireSuperAdmin();
  const { role, action, q, actor, page: pageParam } = await searchParams;
  // Account activity first: what a user looked up is the record worth having.
  // The admin's own changes are still here, one filter away, because they are
  // the record of who altered a plan or a rate.
  const view: RoleView = isRoleView(role) ? role : "officer";
  const admin = getSupabaseAdmin();

  const requested = pageFromParam(pageParam);
  const { from, to } = pageRange(requested, PAGE_SIZE);

  // Rows written before actor_role existed, and any left unstamped, are ours:
  // only the admin console wrote to this table then.
  const roleFilter = "actor_role.eq.super_admin,actor_role.is.null";

  const base = admin
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  let query =
    view === "officer"
      ? base.eq("actor_role", "officer")
      : view === "admin"
        ? base.or(roleFilter)
        : base;
  if (action) query = query.eq("action", action);
  // One person's entries only, which is what "whose history is this" asks. The
  // link is on every row's email, so narrowing to one account is one click.
  if (actor) query = query.eq("actor_id", actor);
  if (q) query = query.or(`entity_label.ilike.%${q}%,actor_email.ilike.%${q}%`);

  // The action dropdown lists what this view actually contains, so an account
  // view never offers "plan.archive" and a new action needs no code change.
  const seenBase = admin
    .from("audit_logs")
    .select("action")
    .order("created_at", { ascending: false })
    .limit(500);

  const vocabulary =
    view === "officer"
      ? seenBase.eq("actor_role", "officer")
      : view === "admin"
        ? seenBase.or(roleFilter)
        : seenBase;

  const [{ data, error, count }, { data: seen }, { data: who }] = await Promise.all([
    query,
    vocabulary,
    actor
      ? admin.from("profiles").select("id, full_name, email").eq("id", actor).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rows = (data ?? []) as AuditLog[];
  const total = count ?? rows.length;
  const actions = [...new Set((seen ?? []).map((row) => row.action as string))].sort();
  const actorProfile = (who ?? null) as Pick<Profile, "id" | "full_name" | "email"> | null;
  const days = byDay(rows);
  const today = istToday();

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={
          actorProfile ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                Only what {actorProfile.full_name ?? actorProfile.email} did, newest first.
              </span>
              <Link
                href={`/admin/officers/${actorProfile.id}`}
                className="text-brand-400 hover:underline"
              >
                Their account
              </Link>
            </span>
          ) : (
            "What people did, when, and to what. Click an email to narrow the log to that one person, or switch the view to see the changes you made from this console."
          )
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {/* The chosen person survives a filter change, so narrowing to one
            account and then picking an action does not throw the account away. */}
        <input type="hidden" name="actor" value={actor ?? ""} />
        <Select name="role" defaultValue={view} className="w-48">
          {(Object.keys(ROLE_LABEL) as RoleView[]).map((value) => (
            <option key={value} value={value}>
              {ROLE_LABEL[value]}
            </option>
          ))}
        </Select>
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Person, truck, plan or email"
          className="min-w-52 flex-1"
        />
        <Select name="action" defaultValue={action ?? ""} className="w-64">
          <option value="">Any action</option>
          {actions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {action || q || actor || view !== "officer" ? (
          <Link href="/admin/audit" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState title="Could not load the audit log" description={error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              total > 0
                ? "That page is past the end of the log"
                : actorProfile
                  ? "Nothing logged for this person yet"
                  : view === "officer"
                    ? "No account activity yet"
                    : "Nothing logged yet"
            }
            description={
              total > 0
                ? `The log holds ${fmtNumber(total)} matching entries. Use the page links below to get back.`
                : view === "officer"
                  ? "Searches, trucks and alerts are recorded here as people use the portal."
                  : "Changes you make in this console show up here."
            }
          />
        ) : (
          days.map((day, index) => (
            <section key={day.date}>
              {/* No line above the first heading: the panel edge is already there. */}
              <h2
                className={cx(
                  'flex items-baseline justify-between gap-3 border-b border-divider bg-raised/70',
                  'px-5 py-2 text-xs font-semibold text-muted',
                  index > 0 && 'border-t',
                )}
              >
                <span>
                  {fmtDate(day.rows[0].created_at)}
                  {day.date === today ? <span className="text-brand-400"> · today</span> : null}
                </span>
                <span className="font-normal tabular-nums text-faint">
                  {fmtNumber(day.rows.length)} on this page
                </span>
              </h2>

              <ul className="divide-y divide-divider">
                {day.rows.map((entry) => {
                  const changes = (entry.meta?.changes ?? null) as Record<
                    string,
                    { from: unknown; to: unknown }
                  > | null;
                  const hasDetail = Boolean(
                    (changes && Object.keys(changes).length > 0) ||
                      (entry.meta && Object.keys(entry.meta).length > 0),
                  );

                  return (
                    <li key={entry.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={toneFor(entry.action)}>
                              <Mono>{entry.action}</Mono>
                            </Badge>
                            {view === "all" ? (
                              <Badge tone={entry.actor_role === "officer" ? "neutral" : "brand"}>
                                {entry.actor_role === "officer" ? "account" : "admin"}
                              </Badge>
                            ) : null}
                            {entry.entity_label ? (
                              <span className="text-sm text-ink">{entry.entity_label}</span>
                            ) : null}
                            {entry.entity === "profile" && entry.entity_id ? (
                              <Link
                                href={`/admin/officers/${entry.entity_id}`}
                                className="text-xs text-brand-400 hover:underline"
                              >
                                open account
                              </Link>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-faint">
                            {entry.actor_id && entry.actor_id !== actor ? (
                              <Link
                                href={actorHref(entry.actor_id, view, action)}
                                className="text-muted hover:text-brand-400 hover:underline"
                              >
                                {entry.actor_email ?? "unknown"}
                              </Link>
                            ) : (
                              (entry.actor_email ?? "unknown")
                            )}{" "}
                            · {fmtTime(entry.created_at)} · {fmtRelative(entry.created_at)}
                          </p>
                        </div>
                      </div>

                      {changes && Object.keys(changes).length > 0 ? (
                        <ul className="mt-2 space-y-0.5">
                          {Object.entries(changes).map(([field, change]) => (
                            <li key={field} className="text-xs text-muted">
                              <Mono className="text-muted">{field}</Mono>{" "}
                              <span className="text-bad-500/80">{JSON.stringify(change.from)}</span>
                              {" → "}
                              <span className="text-good-500">{JSON.stringify(change.to)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : hasDetail ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-faint hover:text-muted">
                            details
                          </summary>
                          <pre className="mt-1 overflow-x-auto rounded-lg border border-divider bg-page/60 p-2 text-[11px] text-muted">
                            {JSON.stringify(entry.meta, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </Panel>

      <Pager
        page={requested}
        pageSize={PAGE_SIZE}
        total={total}
        noun="entries"
        // The default view needs no role in the URL, so it is left out.
        href={{
          path: "/admin/audit",
          params: { role: view === "officer" ? "" : view, action, q, actor },
        }}
      />
    </>
  );
}
