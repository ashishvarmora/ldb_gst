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
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Audit log — Admin" };

const ACTION_TONE: Record<string, "good" | "warn" | "bad" | "brand" | "neutral"> = {
  "officer.create": "good",
  "officer.update": "neutral",
  "officer.assign_plan": "brand",
  "officer.set_overrides": "warn",
  "officer.clear_overrides": "neutral",
  "officer.suspend": "bad",
  "officer.reactivate": "good",
  "officer.reset_password": "warn",
  "officer.update_integrations": "neutral",
  "officer.reset_usage": "warn",
  "officer.delete": "bad",
  "plan.create": "good",
  "plan.update": "brand",
  "plan.duplicate": "neutral",
  "plan.archive": "warn",
  "plan.reactivate": "good",
  "plan.delete": "bad",
  "settings.update": "brand",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; q?: string }>;
}) {
  await requireSuperAdmin();
  const { action, q } = await searchParams;
  const admin = getSupabaseAdmin();

  let query = admin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (action) query = query.eq("action", action);
  if (q) query = query.or(`entity_label.ilike.%${q}%,actor_email.ilike.%${q}%`);

  const { data, error } = await query;
  const rows = (data ?? []) as AuditLog[];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change made from this console: who did it, when, and exactly what changed."
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Officer, plan or admin email"
          className="min-w-52 flex-1"
        />
        <Select name="action" defaultValue={action ?? ""} className="w-64">
          <option value="">Any action</option>
          {Object.keys(ACTION_TONE).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {action || q ? (
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
            title="Nothing logged yet"
            description="Actions you take in this console show up here."
          />
        ) : (
          <ul className="divide-y divide-ink-800">
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
                        <Badge tone={ACTION_TONE[entry.action] ?? "neutral"}>
                          <Mono>{entry.action}</Mono>
                        </Badge>
                        {entry.entity_label ? (
                          <span className="text-sm text-ink-100">{entry.entity_label}</span>
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
                      <p className="mt-1 text-xs text-ink-500">
                        {entry.actor_email ?? "unknown admin"} · {fmtDateTime(entry.created_at)} ·{" "}
                        {fmtRelative(entry.created_at)}
                      </p>
                    </div>
                  </div>

                  {changes && Object.keys(changes).length > 0 ? (
                    <ul className="mt-2 space-y-0.5">
                      {Object.entries(changes).map(([field, change]) => (
                        <li key={field} className="text-xs text-ink-400">
                          <Mono className="text-ink-300">{field}</Mono>{" "}
                          <span className="text-bad-500/80">{JSON.stringify(change.from)}</span>
                          {" → "}
                          <span className="text-good-500">{JSON.stringify(change.to)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : hasDetail ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
                        details
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded-lg border border-ink-800 bg-ink-950/60 p-2 text-[11px] text-ink-300">
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
        <p className="mt-3 text-xs text-ink-500">Showing the 200 most recent entries.</p>
      ) : null}
    </>
  );
}
