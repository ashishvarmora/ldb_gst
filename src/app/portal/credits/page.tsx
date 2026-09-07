import Link from "next/link";
import { Coins } from "lucide-react";

import { CreditLedger, type LedgerQuery } from "@/components/CreditLedger";
import { HelpNote } from "@/components/Disclosure";
import { TopUpLink } from "@/components/CreditBalance";
import { publicSettings } from "@/components/SiteFooter";
import { PageHeader, cx } from "@/components/ui";
import { creditStanding, formatCredits } from "@/lib/credits";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";
import { LedgerLinks, SideTabs, parseSide } from "./LedgerNav";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Credit history — ${brandName}` };
}

/**
 * The statement: how the balance got to the number in the header.
 *
 * This is the half that was split out of the activity page, which had grown
 * into two audits sharing one list of filters. A grant and a charge are read
 * for different reasons - "did my top-up land" against "what is this lorry
 * costing me" - and a single Show pill made the reader do the splitting on
 * every visit.
 *
 * TWO SIDES, ONE PAGE, DIFFERENT SHAPES. Credits added is the raw ledger with
 * every filter the component has: a grant is an event somebody wants to find,
 * it has no truck to group by, and folding a purchase and a coupon into one
 * "12 Aug" line hides exactly what was being looked for. Credits used is one
 * row per day and nothing else, because the day is the unit a burn rate is read
 * in, and because the charge-by-charge breakdown already has a page of its own.
 *
 * WHICH IS WHY THIS IS NOT A COPY OF THE ACTIVITY PAGE. A day here is one line,
 * a total and a chevron; that chevron opens the same day on the activity page,
 * grouped by truck. This page owns the balance and the grants, that one owns
 * the analysis, and the only figure they share is the one the chevron crosses on.
 *
 * The two halves are a query parameter rather than client state, so a side is
 * linkable and a Server Action comes back to the one you were on - the same
 * reasoning as the console's account tabs.
 */
export default async function CreditHistoryPage({
  searchParams,
}: {
  searchParams: Promise<LedgerQuery & { side?: string }>;
}) {
  const [{ overview }, searchCost, params] = await Promise.all([
    requirePortalSession(),
    // Cached for the request - the header pill has already read it.
    loadSearchCost(),
    searchParams,
  ]);

  /* `side` is this page's own parameter and no business of the ledger's, which
     merges everything it is handed into every link it builds. Stripped here
     rather than filtered there, so the component keeps one query shape. */
  const { side: rawSide, ...query } = params;
  const side = parseSide(rawSide);

  const balance = Number(overview.credits ?? 0);
  const standing = creditStanding(balance, searchCost);

  return (
    <>
      <PageHeader
        title="Credit history"
        subtitle="Every credit this account has been given, and what each day has cost."
      />

      <div className="space-y-3">
        <LedgerLinks current="credits" />

        {/*
          One figure, not a row of tiles.

          The balance is what both halves of this page are reconciling towards,
          so it belongs at the top of it - but the activity page already spends
          three tiles on the balance and the spend, and repeating them here is
          the mirroring the owner keeps asking us to stop. A statement needs one
          anchor and gets one line.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-line bg-panel px-4 py-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
            <Coins size={12} className="shrink-0" />
            Balance now
          </span>
          <span className="flex items-baseline gap-2">
            <span
              className={cx(
                "text-xl font-semibold tabular-nums",
                standing === "ok"
                  ? "text-strong"
                  : standing === "empty"
                    ? "text-bad-500"
                    : "text-warn-500",
              )}
            >
              {formatCredits(balance)}
            </span>
            <span className="text-xs text-muted">credits</span>
            <TopUpLink standing={standing} />
          </span>
        </div>

        <SideTabs current={side} query={query} />

        {side === "added" ? (
          <CreditLedger
            userId={overview.id}
            basePath="/portal/credits"
            query={query}
            title="Credits added"
            only="added"
            /* No grouping at all. A grant has no truck, and two purchases on
               one day are two facts rather than one. */
            groupBy={[]}
            description={
              <>
                Every credit that has ever arrived on this account — bought, given by an
                administrator, or free. Spending is on the{" "}
                <Link href="/portal/credits?side=used" className="text-brand-500 hover:underline">
                  Credits used
                </Link>{" "}
                tab.
              </>
            }
          />
        ) : (
          <CreditLedger
            userId={overview.id}
            basePath="/portal/credits"
            query={query}
            /* Every link the ledger builds keeps the side it was built on, so
               a filter, a page turn or a Clear does not drop the reader back
               onto the other half. */
            keep={{ side: "used" }}
            title="Credits used"
            only="used"
            groupBy={["day"]}
            /* The detail behind a day is not on this page and is not going to
               be. One chevron, one place it lives. */
            drillBase="/portal/activity"
            description={
              <>
                What each day cost, and the balance it closed on. Tap a day for the truck-by-truck
                breakdown on{" "}
                <Link href="/portal/activity" className="text-brand-500 hover:underline">
                  Activity
                </Link>
                .
              </>
            }
          />
        )}

        {/* Under the ledger rather than above it. The two things somebody
            actually asks support are answered by the rows themselves in almost
            every case, and a page that opens with two folds of explanation is
            a page whose content starts a screen down on a phone. */}
        <div className="space-y-2">
          <HelpNote title="Which of these is a payment?">
            None of them, directly. A credit arrives here as <strong>Purchased</strong> when money
            has gone through the gateway, and as <strong>Included with plan</strong> when a plan
            term starts — but a plan an administrator assigned by hand grants credits with no
            payment behind them, and a payment that failed grants none. What actually changed hands
            is on{" "}
            <Link href="/portal/payments" className="text-brand-500 hover:underline">
              Payments
            </Link>
            .
          </HelpNote>

          <HelpNote title="Why is my spending only one row a day?">
            Because a day is the unit a balance is worth reading in, and this page exists to show
            how the balance moved rather than what each lorry did. Tap any day, or open{" "}
            <Link href="/portal/activity" className="text-brand-500 hover:underline">
              Activity
            </Link>
            , for the search-by-search breakdown. Only searches you run yourself appear here —
            automatic checks are included in your plan, cost nothing and are not recorded as
            spending at all. Credits an administrator has taken back do appear, on the used side,
            because that is the direction they moved the balance.
          </HelpNote>
        </div>
      </div>
    </>
  );
}
