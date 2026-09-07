import Link from "next/link";
import { BellOff, Plus } from "lucide-react";

import { AddTruckForm } from "./AddTruckForm";
import { Modal } from "@/components/Modal";
import { TruckCard, isWatching } from "@/components/TruckCard";
import { EmptyState, PageHeader, Panel, buttonClass, cx } from "@/components/ui";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertRuleTemplate, TrackedTruck, TruckAlertWithTemplate } from "@/lib/types";

export const metadata = { title: "My trucks — Rahdari" };

/** Enough to fill a phone screen a few times over without scrolling for ever. */
const PAGE_SIZE = 12;

/**
 * A truck is being tracked, or it is on the list waiting. Two places, no third.
 *
 * There were three tabs and the first was All - which is not a state a truck
 * can be in, it is the absence of a question. It also meant the default view
 * mixed live lorries with parked ones, so the number an officer actually wants
 * ("how many am I paying to watch right now") was never on screen and the list
 * they scanned was always the longest one.
 *
 * The names are the officer's words rather than the column's. is_active is a
 * boolean about a database row; "Live tracking" and "Watchlist" say what the
 * platform is doing about the lorry - the second deliberately not "Paused",
 * because a paused truck has not been removed and its history is intact. It is
 * still on the list, just not costing anything.
 */
type Filter = "live" | "watchlist";

const FILTER_LABEL: Record<Filter, string> = {
  live: "Live tracking",
  watchlist: "Watchlist",
};

/** What each tab means, for the empty state and the tab's own title. */
const FILTER_NOTE: Record<Filter, string> = {
  live: "Being checked automatically",
  watchlist: "On your list, not being checked",
};

/*
 * Live is the default, and ?filter=paused still lands somewhere sensible.
 * Links to this page exist in alert messages and in the admin console, and a
 * stale one that silently showed the wrong tab would be worse than a 404.
 */
function parseFilter(raw: string | undefined): Filter {
  if (raw === "watchlist" || raw === "paused") return "watchlist";
  return "live";
}

function hrefFor(filter: Filter, page: number): string {
  const params = new URLSearchParams();
  if (filter !== "live") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/portal/trucks?${query}` : "/portal/trucks";
}

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const { overview } = await requirePortalSession();
  const params = await searchParams;
  const admin = getSupabaseAdmin();

  const filter = parseFilter(params.filter);

  const [{ data: trucks }, { data: alerts }, { data: templates }, settings] = await Promise.all([
    admin
      .from("tracked_trucks")
      .select("*")
      .eq("user_id", overview.id)
      .order("last_event_at", { ascending: false, nullsFirst: false }),
    admin
      .from("truck_alerts")
      .select("*, template:alert_rule_templates(*)")
      .eq("user_id", overview.id),
    admin
      .from("alert_rule_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    loadSettings(admin),
  ]);

  const all = (trucks ?? []) as TrackedTruck[];
  const templateList = (templates ?? []) as AlertRuleTemplate[];

  const byTruck = new Map<string, TruckAlertWithTemplate[]>();
  for (const alert of (alerts ?? []) as TruckAlertWithTemplate[]) {
    const list = byTruck.get(alert.tracked_truck_id) ?? [];
    list.push(alert);
    byTruck.set(alert.tracked_truck_id, list);
  }

  /* Both reads are capped by the plan's truck limit, so counting and paging in
     memory keeps the tallies honest without a second round of queries. Swap
     the pager below for src/components/Pager.tsx once that lands. */
  const watching = new Set(
    all
      .filter((truck) => truck.is_active && isWatching(byTruck.get(truck.id) ?? []))
      .map((truck) => truck.id),
  );

  const counts: Record<Filter, number> = {
    live: all.filter((truck) => truck.is_active).length,
    watchlist: all.filter((truck) => !truck.is_active).length,
  };

  const matching = all.filter((truck) =>
    filter === "live" ? truck.is_active : !truck.is_active,
  );

  /* A live truck with no enabled alert is never checked. That used to be its
     own tab; it is a line under the tabs now, so it is seen without going
     looking for it. */
  const silentCount = all.filter((truck) => truck.is_active && !watching.has(truck.id)).length;

  const pageCount = Math.max(Math.ceil(matching.length / PAGE_SIZE), 1);
  const page = Math.min(Math.max(Number(params.page) || 1, 1), pageCount);
  const shown = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const slots = truckSlotsLeft(overview);
  const canAdd = slots > 0 && Boolean(overview.plan_id);

  return (
    <>
      <PageHeader
        title="My trucks"
        /* No subtitle. It said "what you are watching, and what each one will
           tell you", which the two tabs and the rows below now say better -
           and on a phone it pushed the first truck below the fold. */
        actions={
          <Modal
            triggerLabel="Add truck"
            triggerIcon={<Plus size={15} />}
            title="Add a truck and its first alert"
            description={
              canAdd
                ? slots === Number.POSITIVE_INFINITY
                  ? "Unlimited tracking slots on your plan."
                  : `${slots} slot${slots === 1 ? "" : "s"} free on your plan.`
                : "No slots free — pause or remove a truck first."
            }
            width="md"
          >
            <AddTruckForm
              templates={templateList}
              defaultFailureCutoff={settings.trackingFailureCutoff}
              defaultInactiveHours={settings.inactivePauseHours}
            />
          </Modal>
        }
      />

      {all.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="No trucks yet"
            description="Add a truck and pick what you want to hear about it."
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {/* One tap to the only question this page really answers: which of
              my trucks will actually tell me something? */}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((value) => (
              <Link
                key={value}
                href={hrefFor(value, 1)}
                title={FILTER_NOTE[value]}
                className={cx(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
                  value === filter
                    ? "border-brand-500 bg-brand-500/10 text-brand-500"
                    : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {FILTER_LABEL[value]}
                <span className="tabular-nums opacity-70">{counts[value]}</span>
                <span className="sr-only"> — {FILTER_NOTE[value]}</span>
              </Link>
            ))}
          </div>

          {/*
            The rule that surprises people, and the only place it still gets
            screen space: a truck is checked because an alert came due, so one
            with no alert is watched in name only. It used to be a folded
            HelpNote at the top of the page that everybody read once and then
            scrolled past for ever. Now it appears only when it is true of this
            officer's list, says how many, and the rows themselves carry a "no
            alert" mark so there is something to look for.
          */}
          {filter === "live" && silentCount > 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-500">
              <BellOff size={13} className="shrink-0" />
              <span className="min-w-0">
                {silentCount === 1 ? "1 truck has" : `${silentCount} trucks have`} no alert, so
                nothing is checked. Open one to add an alert.
              </span>
            </p>
          ) : null}

          {shown.length === 0 ? (
            <Panel bodyClassName="p-0">
              <EmptyState
                title={filter === "live" ? "Nothing is being tracked" : "Your watchlist is empty"}
                description={
                  filter === "live"
                    ? "Every truck on your list is paused. Switch one on to start checking it."
                    : "Every truck on your list is being checked."
                }
              />
            </Panel>
          ) : (
            /* One column, always. These are rows now rather than cards, and
               two columns of rows on a wide screen means the eye has to
               scan two places for the number it is looking for. */
            <div className="space-y-2">
              {shown.map((truck) => (
                <TruckCard key={truck.id} truck={truck} alerts={byTruck.get(truck.id) ?? []} />
              ))}
            </div>
          )}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              {page > 1 ? (
                <Link href={hrefFor(filter, page - 1)} className={buttonClass("secondary", "sm")}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={hrefFor(filter, page + 1)} className={buttonClass("secondary", "sm")}>
                  Next
                </Link>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
