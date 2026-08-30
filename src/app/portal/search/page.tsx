import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { SearchBox } from "@/components/SearchBox";
import { Badge, EmptyState, Mono, PageHeader, Panel } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime } from "@/lib/format";
import { blockedReason, requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SearchLog } from "@/lib/types";

export const metadata = { title: "Search — Truck Watch" };

export default async function SearchPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const { data: logs } = await admin
    .from("search_logs")
    .select("*")
    .eq("user_id", overview.id)
    .eq("source", "manual")
    .order("created_at", { ascending: false })
    .limit(30);

  const history = (logs ?? []) as SearchLog[];
  const blocked = blockedReason(overview);

  return (
    <>
      <PageHeader
        title="Search a truck"
        subtitle="Any registration number, tracked or not. Results are kept, so reopening one costs nothing."
      />

      {blocked ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">{blocked}</p>
        </div>
      ) : null}

      <Panel className="mb-4">
        <SearchBox
          autoFocus
          hint={`${formatCredits(overview.credits)} credits left. Spaces and dashes are ignored. Searching does not start tracking.`}
        />
      </Panel>

      <Panel
        title="Your searches"
        description="Every lookup you have made. Tap one to reopen its result."
        bodyClassName="p-0"
      >
        {history.length === 0 ? (
          <EmptyState
            title="No searches yet"
            description="Type a registration number above to make your first lookup."
          />
        ) : (
          <ul className="divide-y divide-divider">
            {history.map((log) => (
              <li key={log.id}>
                <Link
                  href={`/portal/search/${log.truck_number}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition hover:bg-raised/60"
                >
                  <span className="min-w-0">
                    <Mono className="block font-semibold text-ink">{log.truck_number}</Mono>
                    <span className="block text-xs text-faint">{fmtDateTime(log.created_at)}</span>
                  </span>

                  <span className="shrink-0">
                    {log.ok ? (
                      <span className="text-xs text-muted">
                        {log.events_found} crossing{log.events_found === 1 ? "" : "s"}
                      </span>
                    ) : (
                      /* The stored error is a portal or database message. The
                         officer only needs to know the lookup did not land. */
                      <Badge tone="bad">did not go through</Badge>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
