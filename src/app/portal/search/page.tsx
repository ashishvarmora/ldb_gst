import { SearchWorkspace } from "@/components/SearchWorkspace";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Pager, pageFromParam } from "@/components/Pager";
import { SearchBox } from "@/components/SearchBox";
import { publicSettings } from "@/components/SiteFooter";
import {
  TOPUP_HREF,
  creditStanding,
  formatCredits,
  searchesLeft,
  searchesLeftLabel,
} from "@/lib/credits";
import { fmtDateTime } from "@/lib/format";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";
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
  const [{ overview }, searchCost] = await Promise.all([
    requirePortalSession(),
    // Cached for the request - the header pill has already read it.
    loadSearchCost(),
  ]);
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
  const standing = creditStanding(overview.credits, searchCost);

  /*
   * Two states now, and neither of them is about the plan.
   *
   * This ladder used to test !plan_active first and say "your plan has ended,
   * so searching is paused", which 0038 made false twice over: blockedReason()
   * gates a search on the balance alone, and credits never expire. Testing it
   * first also made the two credit branches unreachable without a plan - so
   * the one customer who most needed a top-up, lapsed and still holding
   * credits they could still spend, was the one sent off to buy a plan.
   *
   * What a plan does and does not cover is automatic tracking, and that is
   * reported where it applies - the dashboard and My trucks. This page is
   * manual search, so it answers only what can stop one.
   */
  const notice =
    standing === "empty"
      ? {
          /* Not "you have run out": empty covers a balance still showing a
             figure that is under the price of one search, and telling somebody
             holding 1 credit that they have none invites a support call. */
          text: "Your balance is too low for a search, so searching is paused until you top up.",
          href: TOPUP_HREF,
          cta: "Top up",
          /* Empty is a blocker and low is a nudge, so they do not share a
             colour either - the words say which, and this agrees with them. */
          blocking: true,
        }
      : standing === "low"
        ? {
            text: `Running low — only ${searchesLeftLabel(searchesLeft(overview.credits, searchCost))} at today's rate.`,
            href: TOPUP_HREF,
            cta: "Top up",
            blocking: false,
          }
        : null;

  return <SearchWorkspace
    form={<SearchBox hint={`${formatCredits(searchCost)} credits per search. Spaces and dashes are ignored.`} />}
    history={history.map(log => ({ id: log.id, truck: log.truck_number, date: fmtDateTime(log.created_at), crossings: log.events_found, ok: log.ok }))}
    total={total}
    notice={notice ? <div className={`workspace-notice ${notice.blocking ? "is-blocking" : ""}`}><AlertTriangle size={18}/><p>{notice.text}</p><Link href={notice.href}>{notice.cta}</Link></div> : null}
    pager={<Pager page={page} total={total} pageSize={PAGE_SIZE} noun="searches" href={{path:"/portal/search"}}/>}
  />;
}
