import Link from "next/link";
import { BellOff, Plus } from "lucide-react";

import { AddTruckForm } from "./AddTruckForm";
import { Modal } from "@/components/Modal";
import { TruckCard, isWatching } from "@/components/TruckCard";
import { HelpNote } from "@/components/Disclosure";
import { EmptyState, PageHeader, Panel, buttonClass, cx } from "@/components/ui";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertRuleTemplate, TrackedTruck, TruckAlertWithTemplate } from "@/lib/types";

export const metadata = { title: "My trucks — Truck Watch" };

/** Enough to fill a phone screen a few times over without scrolling for ever. */
const PAGE_SIZE = 12;

/**
 * A truck is live or it is paused. There is no third thing.
 *
 * There were four tabs: All, Watching, Needs an alert, Paused. "Watching" and
 * "Needs an alert" were both live trucks - the split was really "has an
 * enabled alert", which is a property of one truck rather than a place to
 * keep it. It reads better as a badge on the row that needs it than as a tab
 * somebody has to visit to discover the row exists.
 */
type Filter = "all" | "live" | "paused";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  live: "Live",
  paused: "Paused",
};

function parseFilter(raw: string | undefined): Filter {
  return raw === "live" || raw === "paused" ? raw : "all";
}

function hrefFor(filter: Filter, page: number): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
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

  const [{ data: trucks }, { data: alerts }, { data: templates }] = await Promise.all([
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
    all: all.length,
    live: all.filter((truck) => truck.is_active).length,
    paused: all.filter((truck) => !truck.is_active).length,
  };

  const matching = all.filter((truck) => {
    if (filter === "live") return truck.is_active;
    if (filter === "paused") return !truck.is_active;
    return true;
  });

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
        subtitle="What you are watching, and what each one will tell you."
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
            <AddTruckForm templates={templateList} />
          </Modal>
        }
      />

      {/* The rule that surprises people - an alert is what causes a check, so a
          truck with none is watched in name only. Kept on the page because it
          decides whether this page does anything, folded because it is read
          once. */}
      <HelpNote title="When is a truck actually checked?" className="mb-4">
        Only when one of its alerts is due. A truck with no alert is never
        checked and nothing about it reaches you.
      </HelpNote>

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
                className={cx(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
                  value === filter
                    ? "border-brand-500 bg-brand-500/10 text-brand-500"
                    : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {FILTER_LABEL[value]}
                <span className="tabular-nums opacity-70">{counts[value]}</span>
              </Link>
            ))}
          </div>

          {/* Not a link any more: there is no tab to send anyone to, and there
              does not need to be - the cards below carry the badge, so the
              count says how many to look for rather than hiding them behind a
              fourth place to visit. */}
          {filter !== "paused" && silentCount > 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-warn-500">
              <BellOff size={14} className="mt-px shrink-0" />
              <span>
                {silentCount === 1
                  ? "1 live truck has no alert switched on, so it is never checked."
                  : `${silentCount} live trucks have no alert switched on, so they are never checked.`}{" "}
                Open one to add an alert.
              </span>
            </p>
          ) : null}

          {shown.length === 0 ? (
            <Panel bodyClassName="p-0">
              <EmptyState
                title={`No ${FILTER_LABEL[filter].toLowerCase()} trucks`}
                description={
                  filter === "paused"
                    ? "Every truck on your list is being checked."
                    : undefined
                }
              />
            </Panel>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
