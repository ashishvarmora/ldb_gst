import { HelpNote } from "@/components/Disclosure";
import { CreditLedger, CreditSummary, type LedgerQuery } from "@/components/CreditLedger";
import { publicSettings } from "@/components/SiteFooter";
import { PageHeader } from "@/components/ui";
import { requirePortalSession } from "@/lib/officer";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Credits and activity — ${brandName}` };
}

/**
 * Where the credits went - the only page that answers it.
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
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<LedgerQuery>;
}) {
  const { overview } = await requirePortalSession();
  const query = await searchParams;

  return (
    <>
      <PageHeader
        title="Credits and activity"
        subtitle="Every credit you have been given and every one you have spent."
      />

      <div className="space-y-3">
        <CreditSummary userId={overview.id} balance={overview.credits} />

        {/* The one thing about this page that surprises people, and the reason
            a bill can look wrong when it is not. */}
        {/* Two folds, not two paragraphs. The first is the question support is
            actually asked; the second is the one that stops somebody thinking
            the list is missing rows. */}
        <div className="space-y-2">
          <HelpNote title="Why does one truck cost so much in a day?">
            A truck is checked on the beat you set for it. At every 15 minutes that is ninety-odd
            checks a day, and each one is charged at the rate on the plan page. Slowing a truck down
            is the single biggest lever on what it costs — a truck checked hourly costs a quarter of
            the same truck checked every fifteen minutes, and still records every crossing.
          </HelpNote>

          <HelpNote title="How do I find one particular charge?">
            Turn the <strong>Group by</strong> toggles off and you get every individual charge,
            newest first. Leave them on to fold the same charges up — by day, by truck, or both:
            with both on, one row is one truck on one day. Tapping any folded row opens the charges
            behind it. <strong>Sort</strong> sits at the end of that same row and only changes the
            order. The pills underneath are what narrow the list — each reads out what it is
            currently doing, turns blue when it is doing something, and can be tapped off again
            from inside itself. <strong>Reason</strong> takes as many as you like, and the three
            figures above the list always describe everything the filters match, not just the page
            you are looking at.
          </HelpNote>
        </div>

        <CreditLedger userId={overview.id} basePath="/portal/activity" query={query} />
      </div>
    </>
  );
}
