import Link from "next/link";
import { Filter } from "lucide-react";

import { Input, Select } from "@/components/form";
import {
  Badge,
  EmptyState,
  Mono,
  PageHeader,
  Panel,
  buttonClass,
  type BadgeTone,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Audit log — Admin" };

type RoleView = "officer" | "admin" | "all";

const ROLE_LABEL: Record<RoleView, string> = {
  officer: "Officer activity",
  admin: "Admin activity",
  all: "Everything",
};

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

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; action?: string; q?: string }>;
}) {
  await requireSuperAdmin();
  const { role, action, q } = await searchParams;
  // Officers first: what an officer looked up is the record worth having. The
  // admin's own changes are still here, one filter away, because they are the
  // record of who altered a plan or a rate.
  const view: RoleView = isRoleView(role) ? role : "officer";
  const admin = getSupabaseAdmin();

  // Rows written before actor_role existed, and any left unstamped, are ours:
  // only the admin console wrote to this table then.
  const roleFilter = "actor_role.eq.super_admin,actor_role.is.null";

  const base = admin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  let query =
    view === "officer"
      ? base.eq("actor_role", "officer")
      : view === "admin"
        ? base.or(roleFilter)
        : base;
  if (action) query = query.eq("action", action);
  if (q) query = query.or(`entity_label.ilike.%${q}%,actor_email.ilike.%${q}%`);

  // The action dropdown lists what this view actually contains, so an officer
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

  const [{ data, error }, { data: seen }] = await Promise.all([query, vocabulary]);

  const rows = (data ?? []) as AuditLog[];
  const actions = [...new Set((seen ?? []).map((row) => row.action as string))].sort();

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="What officers did, when, and to what. Switch the view to see the changes you made from this console instead."
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
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
          placeholder="Officer, truck, plan or email"
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
        {action || q || view !== "officer" ? (
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
            title={view === "officer" ? "No officer activity yet" : "Nothing logged yet"}
            description={
              view === "officer"
                ? "Searches, trucks and alerts an officer works on are recorded here as they use the portal."
                : "Changes you make in this console show up here."
            }
          />
        ) : (
          <ul className="divide-y divide-divider">
            {rows.map((entry) => {
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
                            {entry.actor_role === "officer" ? "officer" : "admin"}
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
                            open officer
                          </Link>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-faint">
                        {entry.actor_email ?? "unknown"} · {fmtDateTime(entry.created_at)} ·{" "}
                        {fmtRelative(entry.created_at)}
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
        )}
      </Panel>

      {rows.length === 200 ? (
        <p className="mt-3 text-xs text-faint">Showing the 200 most recent entries.</p>
      ) : null}
    </>
  );
}
