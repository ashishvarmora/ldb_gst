import { History as PageIcon, Trash2 } from "lucide-react";
import { HelpNote } from "@/components/Disclosure";
import { CreditLedger, CreditSummary, type LedgerQuery } from "@/components/CreditLedger";
import { publicSettings } from "@/components/SiteFooter";
import { Mono, PageHeader, Panel } from "@/components/ui";
import { fmtWhenAgo } from "@/lib/format";
import { loadRemovedTrucks } from "@/lib/truck-activity";
import { getSignedInUser } from "@/lib/auth";
import { creditStanding } from "@/lib/credits";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";
import { LedgerLinks } from "../credits/LedgerNav";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Activity — ${brandName}` };
}

/**
 * Where the credits went - the only page that answers it, and now only that.
 *
 * This was 450 lines reading a my_activity view that unioned search_logs with
 * credit_transactions, while the plan page showed the same history again from a
 * different view that had rolled the truck away. Two screens, two queries, two
 * sets of totals, and one of them could not reconcile to a balance because
 * search_logs is only written when a check finds something.
 *
 * All of that is now one component over one view, mounted here for the account
 * holder and again in the admin console for a named customer. The page itself
 * is deliberately this short: it decides whose ledger to show and nothing else.
 *
 * SPEND ONLY, since the credit history page took the other half. The grants
 * were never analysed here - nobody groups a coupon by truck - and keeping them
 * meant a Show pill whose two useful settings were on different pages and whose
 * third mixed them. What is left is one question asked properly: what did the
 * spending go on. Reasons narrow to the two spending ones, and the totals strip
 * has dropped the column that would read zero for ever.
 *
 * The grouping, the drill-down and the filters are untouched - that is the part
 * the owner asked us to keep.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<LedgerQuery>;
}) {
  const user = await getSignedInUser();
  if (!user) await requirePortalSession(); // redirects to /login
  const [{ overview }, searchCost, query, removed] = await Promise.all([
    requirePortalSession(),
    // Cached for the request - the header pill has already read it.
    loadSearchCost(),
    searchParams,
    /* Account-level truck history: trucks deleted from My trucks (0072).
       Empty, and the panel hidden, until the migration is applied. */
    loadRemovedTrucks(user!.id, 10),
  ]);

  return (
    <>
      {/* No subtitle. "By day, by truck, and charge by charge" was the three
          Group by toggles read out in a sentence, a few inches above the
          toggles themselves. */}
      <PageHeader
        icon={<PageIcon size={22} strokeWidth={2} />}
        title="Activity"
        subtitle="Every charge your credits paid for, by day and by truck."
      />

      <div className="space-y-3">
        {/* Where the grants and the money went, both of which used to be
            somewhere on this page. Above the tiles rather than under the
            ledger: somebody who came here looking for a top-up that has not
            appeared needs the pointer before they have scrolled past fifty
            charges deciding it is missing. */}
        <LedgerLinks current="activity" />

        {/* This is the page somebody opens when the balance looks wrong, so the
            way to fix it belongs on the tile rather than one page further on. */}
        <CreditSummary
          userId={overview.id}
          balance={overview.credits}
          standing={creditStanding(overview.credits, searchCost)}
        />

        {/*
          ONE FOLD, and it is the only one on this page.

          There were two. The second, "How do I find one particular charge?",
          was a paragraph teaching the controls immediately below it - the
          toggles, the sort, the pills, the split bar - and every one of those
          reads out what it is currently doing, turns blue when it is doing
          something and can be switched off from inside itself. A manual for a
          control that describes itself is the prose the owner keeps asking us
          to take off these screens, so it has gone rather than moved.

          This one stays because it is not on screen anywhere: what a credit is
          spent on, and that watching more closely costs more. It is the
          question support is actually asked, and the reason a bill can look
          wrong when it is not.
        */}
        <HelpNote title="What actually costs credits?">
          Searches and automatic checks both use credits. Automatic checks are charged at your
          plan&apos;s rate and are usually the larger share: a truck on a 15-minute alert is
          checked about 96 times a day. Check less often, or pause a truck, to use fewer credits.
        </HelpNote>

        {/*
          only="used" is the whole of the page split. The admin console mounts
          the same component without it and keeps the full ledger.

          NO SPEND SPLIT ANY MORE. This mount was the only one that turned it
          on: a proportion bar under the totals reading "Automatic check 98% /
          Manual search 2%", with each segment a link to that reason. The
          owner's verdict was that on a phone it took space it had not earned,
          and it did - 57px of bar and legend, hanging under an 87px totals
          card that has itself become one 34px line. The reader who wants that
          breakdown has the Reason pill in the row above, which is the same
          filter the bar's segments were; what has gone is the picture, not the
          answer. The prop and the component are both gone rather than left
          switched off, because a bar nothing turns on is a bar that comes back.
        */}
        <CreditLedger
          userId={overview.id}
          basePath="/portal/activity"
          query={query}
          title="Credits used"
          only="used"
        />

        {removed.length > 0 ? (
          <Panel title="Trucks deleted" bodyClassName="p-0">
            <ul className="divide-y divide-divider">
              {removed.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Trash2 size={14} aria-hidden className="shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      <Mono className="font-semibold">{row.truck_number}</Mono> deleted from My trucks
                    </p>
                    <p className="text-[11.5px] text-muted">
                      {fmtWhenAgo(row.created_at)} · its crossings and charges are kept
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
