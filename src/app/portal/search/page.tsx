import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { SearchBox } from "@/components/SearchBox";
import { Badge, EmptyState, Mono, PageHeader, Panel } from "@/components/ui";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
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
  const unlimited = overview.manual_search_limit_per_day === -1;
  const left = unlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(overview.manual_search_limit_per_day - overview.manual_searches_today, 0);

  return (
    <>
      <PageHeader
        title="Search a truck"
        subtitle="Any registration number, whether or not you are tracking it. Results are kept, so you can come back to them without spending another credit."
      />

      {blocked ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">{blocked}</p>
        </div>
      ) : null}

      <Panel className="mb-5">
        <SearchBox
          autoFocus
          hint={
            unlimited
              ? "Unlimited manual searches on your plan."
              : `${left} of ${formatLimit(overview.manual_search_limit_per_day)} searches left today. Resets at midnight IST.`
          }
        />
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="Your searches"
            description="Every manual lookup, newest first. Tap one to reopen the result."
            bodyClassName="p-0"
          >
            {history.length === 0 ? (
              <EmptyState
                title="No searches yet"
                description="Type a registration number above to make your first lookup."
              />
            ) : (
              <ul className="divide-y divide-ink-800">
                {history.map((log) => (
                  <li key={log.id}>
                    <Link
                      href={`/portal/search/${log.truck_number}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-ink-850/60"
                    >
                      <span className="min-w-0">
                        <Mono className="block font-semibold text-ink-100">{log.truck_number}</Mono>
                        <span className="block text-xs text-ink-500">
                          {fmtDateTime(log.created_at)} · {fmtRelative(log.created_at)}
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-2">
                        {log.ok ? (
                          <>
                            <span className="text-xs text-ink-400">
                              {log.events_found} crossing{log.events_found === 1 ? "" : "s"}
                            </span>
                            {log.new_events > 0 ? (
                              <Badge tone="good">{log.new_events} new</Badge>
                            ) : null}
                          </>
                        ) : (
                          <Badge tone="bad">{(log.error ?? "failed").slice(0, 30)}</Badge>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="How searching works">
          <ul className="space-y-3 text-xs leading-relaxed text-ink-400">
            <li className="flex gap-2">
              <Info size={13} className="mt-0.5 shrink-0 text-brand-400" />
              <span>
                One search = one credit, counted against your{" "}
                <strong className="text-ink-200">daily</strong> limit. Background tracking uses a
                separate monthly pool, so searching never eats into it.
              </span>
            </li>
            <li className="flex gap-2">
              <Info size={13} className="mt-0.5 shrink-0 text-brand-400" />
              <span>
                The portal only reports crossings from roughly the last week. An empty result usually
                means the truck has not passed a toll plaza recently.
              </span>
            </li>
            <li className="flex gap-2">
              <Info size={13} className="mt-0.5 shrink-0 text-brand-400" />
              <span>
                Searching does <strong className="text-ink-200">not</strong> start tracking. Add the
                truck from the result page if you want it checked automatically.
              </span>
            </li>
            <li className="flex gap-2">
              <Info size={13} className="mt-0.5 shrink-0 text-brand-400" />
              <span>
                Spaces and dashes are ignored — <Mono>gj 02 at 8546</Mono> works.
              </span>
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
