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

type Filter = "all" | "watching" | "silent" | "paused";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  watching: "Watching",
  silent: "Needs an alert",
  paused: "Paused",
};

function parseFilter(raw: string | undefined): Filter {
  return raw === "watching" || raw === "silent" || raw === "paused" ? raw : "all";
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
    watching: watching.size,
    silent: all.filter((truck) => truck.is_active && !watching.has(truck.id)).length,
    paused: all.filter((truck) => !truck.is_active).length,
  };

  const matching = all.filter((truck) => {
    if (filter === "watching") return watching.has(truck.id);
    if (filter === "silent") return truck.is_active && !watching.has(truck.id);
    if (filter === "paused") return !truck.is_active;
    return true;
  });

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

          {filter === "all" && counts.silent > 0 ? (
            <Link
              href={hrefFor("silent", 1)}
              className="flex items-start gap-2 rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-warn-500 transition hover:border-warn-500/70"
            >
              <BellOff size={14} className="mt-px shrink-0" />
              <span>
                {counts.silent === 1
                  ? "1 truck has no alert switched on, so it is never checked."
                  : `${counts.silent} trucks have no alert switched on, so they are never checked.`}{" "}
                Show them.
              </span>
            </Link>
          ) : null}

          {shown.length === 0 ? (
            <Panel bodyClassName="p-0">
              <EmptyState
                title={
                  filter === "silent"
                    ? "Every truck has an alert on it"
                    : `No trucks under "${FILTER_LABEL[filter]}"`
                }
                description={
                  filter === "silent"
                    ? "Nothing is sitting silent. Anything the trucks do will reach you."
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
