import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { HelpNote } from "@/components/Disclosure";
import { Pager, pageFromParam } from "@/components/Pager";
import { SearchBox } from "@/components/SearchBox";
import { publicSettings } from "@/components/SiteFooter";
import { Badge, EmptyState, LinkButton, Mono, PageHeader, Panel } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtNumber, istToday } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SearchLog } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Search — ${brandName}` };
}

/** Searches per page. Short enough to scan on a phone without scrolling far. */
const PAGE_SIZE = 20;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const page = pageFromParam((await searchParams).page);
  const from = (page - 1) * PAGE_SIZE;

  // Counted as well as read: the history is kept in full, so the page can say
  // how much of it there is rather than implying these are all of them.
  const { data: logs, count } = await admin
    .from("search_logs")
    .select("*", { count: "exact" })
    .eq("user_id", overview.id)
    .eq("source", "manual")
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const history = (logs ?? []) as SearchLog[];
  const total = count ?? history.length;

  /* The shared blockedReason() text is written for the worker, which cannot
     link anywhere. Here the fix is one tap away, so the portal says it in its
     own words and points at the page that solves it. */
  const planEnded = overview.plan_expires_on !== null && overview.plan_expires_on < istToday();
  const notice = !overview.plan_active
    ? planEnded
      ? "Your plan has ended, so searching is paused. Renew it to start again."
      : "Choose a plan to start searching. It comes with the credits a search spends."
    : overview.credits <= 0
      ? "You have run out of credits, so searching is paused until you top up."
      : null;

  return (
    <>
      <PageHeader
        title="Search a truck"
        subtitle="Any registration number, tracked or not."
      />

      {notice ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <p className="flex items-start gap-2.5 text-sm text-warn-500">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {notice}
          </p>
          <LinkButton href="/portal/plan" size="sm" variant="secondary">
            Go to plan
          </LinkButton>
        </div>
      ) : null}

      <Panel className="mb-3">
        {/* The hint under the input is the one number that decides whether the
            next tap works. The two rules that used to be crammed in beside it
            are below, where they are read once instead of on every visit. */}
        <SearchBox autoFocus hint={`${formatCredits(overview.credits)} credits left.`} />
      </Panel>

      <HelpNote title="What a search does, and what it costs" className="mb-4">
        <p>Spaces and dashes are ignored, so type the number however you have it.</p>
        <p className="mt-2">
          Searching does not start tracking — the truck is only watched once you add it in{" "}
          <Link href="/portal/trucks" className="font-medium text-brand-500 hover:underline">
            My trucks
          </Link>
          . Every result is kept, so reopening one from the list below costs nothing.
        </p>
      </HelpNote>

      <Panel
        title="Your searches"
        description={
          total === 0
            ? "Every lookup you make is kept here."
            : `${fmtNumber(total)} lookup${total === 1 ? "" : "s"} kept, newest first. Tap one to reopen its result.`
        }
        bodyClassName="p-0"
      >
        {history.length === 0 ? (
          <EmptyState
            title={page > 1 ? "Nothing on this page" : "No searches yet"}
            description={
              page > 1
                ? "There are no searches this far back."
                : "Type a registration number above to make your first lookup."
            }
            action={page > 1 ? <LinkButton href="/portal/search">Back to the first page</LinkButton> : null}
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
                      /* The stored error is a toll-network or database message.
                         All anyone needs here is that it did not land. */
                      <Badge tone="bad">did not go through</Badge>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Pager
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        noun="searches"
        href={{ path: "/portal/search" }}
      />
    </>
  );
}
