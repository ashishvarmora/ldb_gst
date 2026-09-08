import { Coins } from "lucide-react";

import { CreditLedger, type LedgerQuery } from "@/components/CreditLedger";
import { InfoTip } from "@/components/InfoTip";
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
 *
 * THE EXPLANATION IS ALL BEHIND ONE (i) NOW. This page used to open with a
 * subtitle, carry a paragraph inside each half's panel header, and close with
 * two folded notes - and every one of them was explaining the same three
 * things. The owner's verdict was that the prose has to go or go behind a
 * button; it has gone behind a button, on the balance, which is the figure all
 * of it is actually about and the one somebody is looking at when the question
 * occurs to them. What was only reassurance was deleted outright: the
 * "spending is on the other tab" line sat directly under the switch that says
 * so, and the ledger already names its own rows.
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
      {/* No subtitle. It said "every credit this account has been given, and
          what each day has cost" - which is the two tab labels two inches
          below, in longer words. */}
      <PageHeader title="Credit history" />

      {/*
        space-y-2, not 3. Four bands stacked - the sibling links, the balance,
        the side switch, the ledger - and the prose that used to separate them
        has gone, so the 12px gaps were holding apart things that now read as
        one column of controls. 8px still groups them as four bands rather than
        one slab; what it stops doing is pushing the first row of the ledger
        down the screen. The remaining margin above all of this is PageHeader's
        own mb-5, in src/components/ui.tsx.
      */}
      <div className="space-y-2">
        <LedgerLinks current="credits" />

        {/*
          One figure, not a row of tiles.

          The balance is what both halves of this page are reconciling towards,
          so it belongs at the top of it - but the activity page already spends
          three tiles on the balance and the spend, and repeating them here is
          the mirroring the owner keeps asking us to stop. A statement needs one
          anchor and gets one line.
        */}
        {/* py-2 rather than py-3: everything in this card is on one 28px line -
            the label, the figure and the (i) - so 24px of vertical padding was
            making a 54px card out of a 46px row. px-4 stays, because it is what
            lines the label up with "Credits used" in the panel below. */}
        <div className="rounded-xl border border-line bg-panel px-4 py-2">
          {/*
            The whole of this page's explanation, on the figure it explains.

            InfoTip appends its (i) after the row's children, so the balance
            carries `order-1` to sit after it: the icon belongs beside the words
            it annotates, not stranded past the top-up button at the far edge.
            ml-auto still holds the figure to the right, and on a phone narrow
            enough to wrap it drops to a second line right-aligned rather than
            colliding with the label.

            Opens inline, under the whole card, which is why the copy can afford
            three short paragraphs: it pushes the ledger down instead of
            covering it, and nothing above the fold is spent on it while it is
            shut.
          */}
          <InfoTip
            label="credit history"
            info={
              <>
                {/* This said automatic checks were included with the plan and
                    cost nothing - wrong three times over, and the ledger
                    directly below it lists auto_check rows. One credit a check,
                    either kind. */}
                <p>
                  Every look at a lorry costs {formatCredits(searchCost)} credit
                  {searchCost === 1 ? "" : "s"} — a search you run yourself and an automatic check
                  alike. Credits never expire. Pausing a truck stops its checks, so it stops
                  spending.
                </p>
                <p>
                  Credits can arrive without a payment: a plan an administrator assigned by hand, a
                  bonus code, a referral. What actually changed hands is on Payments.
                </p>
                <p>
                  Spending is one row a day, because a day is the unit a balance is read in. Tap
                  any day for the truck-by-truck breakdown on Activity.
                </p>
              </>
            }
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
              <Coins size={12} className="shrink-0" />
              Balance now
            </span>
            <span className="order-1 ml-auto flex items-baseline gap-2">
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
          </InfoTip>
        </div>

        <SideTabs current={side} query={query} />

        {/*
          NEITHER MOUNT HAS A DESCRIPTION, AND NEITHER CAN.

          Both used to override it with a sentence naming the page's own other
          half - the switch immediately above already does that, and a link out
          of a panel header to a tab six inches higher is a reader being sent
          in a circle. Dropping the overrides left CreditLedger's own derived
          one-liner standing, which was the text the owner quoted back at us:
          "Every credit you have spent, straight from the ledger. Nothing here
          is recalculated." That default and the prop behind it are both gone
          now - see CreditLedger - along with the "One row per day" note inside
          the panel. What was load-bearing in all of it, what a row covers and
          where a day opens, is in the (i) on the balance above; the rest was
          the title in longer words.
        */}
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
          />
        )}
      </div>
    </>
  );
}
