import { Star } from "lucide-react";

import { SavedList } from "./SavedList";
import { InfoTip } from "@/components/InfoTip";
import { publicSettings } from "@/components/SiteFooter";
import { formatCredits } from "@/lib/credits";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";
import { SAVED_LIMIT, loadSavedTrucks } from "@/lib/saved-trucks";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Saved trucks — ${brandName}` };
}

/**
 * Saved trucks (0066): the customer's own short list to check by hand - "the
 * ten trucks I look at every day". One tap per truck, or Check all.
 */
export default async function SavedTrucksPage() {
  const [{ overview }, searchCost] = await Promise.all([requirePortalSession(), loadSearchCost()]);
  const saved = await loadSavedTrucks(getSupabaseAdmin(), overview.id);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-4 flex items-start gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-500">
          <Star size={22} className="fill-amber-400" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-strong">
            <InfoTip
              label="About saved trucks"
              info={
                <>
                  <p>Your own list of up to {SAVED_LIMIT} trucks to check on demand.</p>
                  <p>
                    Each check is a normal search, at {formatCredits(searchCost)} credit
                    {searchCost === 1 ? "" : "s"}. Saved trucks are not checked automatically; for
                    that, add the truck to My trucks.
                  </p>
                  <p>No plan needed. Remove trucks you no longer need to keep the list short.</p>
                </>
              }
            >
              Saved trucks
            </InfoTip>
          </h1>
          <p className="text-sm text-muted">Check your regular trucks with one tap.</p>
        </div>
      </header>

      <SavedList initial={saved} searchCost={Number(searchCost)} limit={SAVED_LIMIT} />
    </div>
  );
}
