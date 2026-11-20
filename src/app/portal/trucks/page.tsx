import Link from "next/link";
import { BellOff, Download, Layers, Plus, ShieldCheck, Truck as PageIcon } from "lucide-react";

import { AddTruckForm } from "./AddTruckForm";
import { loadAlertDelivery } from "@/components/AlertDeliveryBanner";
import { FleetToolbar, type FleetSort } from "@/components/FleetToolbar";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { MoreMenu } from "@/components/MoreMenu";
import { TruckCard, type TruckRowAlert, type TruckRowTruck } from "@/components/TruckCard";
import { EmptyState, PageHeader, Panel, buttonClass, cx } from "@/components/ui";
import { getSignedInUser } from "@/lib/auth";
import { AUTO_PAUSE_RULES, PAUSE_HELP_LINE, truckChip } from "@/lib/pause";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertRuleTemplate } from "@/lib/types";

export const metadata = { title: "My trucks — Rahdari" };

/** Rows per page - a few phone screens of 64px rows. */
const PAGE_SIZE = 20;

/** The search box appears once the list is longer than this. */
const SEARCH_FROM = 5;

/**
 * Two places a truck can be: Tracking (checked automatically, using credits)
 * or Paused (on the list, history kept, no credits). ?filter=paused and the
 * older ?filter=watchlist both land on Paused.
 */
type Filter = "live" | "watchlist";

const FILTER_LABEL: Record<Filter, string> = { live: "Tracking", watchlist: "Paused" };

function parseFilter(raw: string | undefined): Filter {
  return raw === "watchlist" || raw === "paused" ? "watchlist" : "live";
}

function parseSort(raw: string | undefined): FleetSort {
  return raw === "number" ? "number" : "crossing";
}

/** Upper-case, no spaces or dashes - how numbers are stored. */
function squash(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hrefFor(filter: Filter, page: number, q: string, sort: FleetSort): string {
  const params = new URLSearchParams();
  if (filter !== "live") params.set("filter", "paused");
  if (q) params.set("q", q);
  if (sort !== "crossing") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/portal/trucks?${query}` : "/portal/trucks";
}

/**
 * My trucks (owner, 20 Nov 2026).
 *
 * FIRST VIEW, before any tap:
 *   heading            "My trucks"   [+ Add truck] [⋯ CSV · Groups]
 *   one summary line   12 trucks · 2 halted · Growth, 9 of 25 slots used (i)
 *   primary filter     [ Tracking 9 | Paused 3 ]
 *   tools (>5 trucks)  [search number or label] [sort]
 *   rows               plate + status chip / last crossing, switch, ⋯
 *
 * AFTER A TAP: the ⋯ menus (Pause / Go live, Delete; CSV, Groups), the (i)
 * with the auto-pause rules, and the truck page for everything else.
 *
 * SPEED: every read here starts as soon as the signed-in user id is known
 * (verified locally from the cookie), in parallel with the profile and
 * overview reads the portal gate does - so the page is one database round
 * trip deep instead of two. Columns are narrowed to what a row shows.
 */
export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; q?: string; sort?: string }>;
}) {
  const user = await getSignedInUser();
  if (!user) await requirePortalSession(); // redirects to /login
  const userId = user!.id;
  const admin = getSupabaseAdmin();

  const [{ overview }, params, { data: trucks }, { data: alerts }, { data: templates }, telegram] =
    await Promise.all([
      requirePortalSession(),
      searchParams,
      admin
        .from("tracked_trucks")
        .select("id,truck_number,label,is_active,paused_reason,last_event_at,last_location")
        .eq("user_id", userId)
        .order("last_event_at", { ascending: false, nullsFirst: false }),
      admin
        .from("truck_alerts")
        .select("tracked_truck_id,is_enabled,halt_active,template_kind")
        .eq("user_id", userId),
      admin
        .from("alert_rule_templates")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      /* Cached with the layout's own read of the same thing - no extra trip. */
      loadAlertDelivery(userId),
    ]);

  const filter = parseFilter(params.filter);
  const sort = parseSort(params.sort);
  const q = (params.q ?? "").trim().slice(0, 40);

  const all = (trucks ?? []) as TruckRowTruck[];
  const templateList = (templates ?? []) as AlertRuleTemplate[];

  const byTruck = new Map<string, TruckRowAlert[]>();
  for (const alert of (alerts ?? []) as TruckRowAlert[]) {
    const list = byTruck.get(alert.tracked_truck_id) ?? [];
    list.push(alert);
    byTruck.set(alert.tracked_truck_id, list);
  }

  const chips = new Map(all.map((truck) => [truck.id, truckChip(truck, byTruck.get(truck.id) ?? [])]));
  const counts: Record<Filter, number> = {
    live: all.filter((truck) => truck.is_active).length,
    watchlist: all.filter((truck) => !truck.is_active).length,
  };
  const halted = all.filter((truck) => chips.get(truck.id)?.label === "Halted").length;
  const silent = all.filter((truck) => chips.get(truck.id)?.label === "Live · no alert").length;

  const needle = squash(q);
  const lowered = q.toLowerCase();
  let matching = all.filter((truck) => (filter === "live" ? truck.is_active : !truck.is_active));
  if (q) {
    matching = matching.filter(
      (truck) =>
        (needle && truck.truck_number.includes(needle)) ||
        (truck.label ?? "").toLowerCase().includes(lowered),
    );
  }
  if (sort === "number") {
    matching = [...matching].sort((a, b) => a.truck_number.localeCompare(b.truck_number));
  }

  const pageCount = Math.max(Math.ceil(matching.length / PAGE_SIZE), 1);
  const page = Math.min(Math.max(Number(params.page) || 1, 1), pageCount);
  const shown = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const slots = truckSlotsLeft(overview);
  const canAdd = slots > 0 && Boolean(overview.plan_id);
  const limit = overview.truck_limit;

  return (
    <div className="fleet-workspace">
      <PageHeader
        icon={<PageIcon size={22} strokeWidth={2} />}
        title="My trucks"
        actions={
          <div className="fleet-actions">
            <Modal
              triggerLabel="Add truck"
              openHash="add-truck"
              triggerIcon={<Plus size={15} />}
              title="Add a truck and its first alert"
              description={
                canAdd
                  ? slots === Number.POSITIVE_INFINITY
                    ? "Unlimited tracking slots on your plan."
                    : `${slots} tracking slot${slots === 1 ? "" : "s"} free on your plan.`
                  : "No tracking slots free — pause or delete a truck first."
              }
              width="md"
            >
              <AddTruckForm templates={templateList} telegram={telegram} />
            </Modal>
            {/* Secondary tools, one tap further. The crossings CSV is the only
                on-demand export of every crossing, so it stays reachable. */}
            <MoreMenu label="More on My trucks" buttonClassName="fleet-more">
              {all.length > 0 ? (
                <a role="menuitem" href="/portal/records/export?range=all" download className="more-menu-item">
                  <Download size={15} aria-hidden />
                  Crossings CSV
                </a>
              ) : null}
              <Link role="menuitem" href="/portal/cases" className="more-menu-item">
                <Layers size={15} aria-hidden />
                Groups
              </Link>
              <Link role="menuitem" href="/portal/plan" className="more-menu-item">
                <ShieldCheck size={15} aria-hidden />
                Plan and credits
              </Link>
            </MoreMenu>
          </div>
        }
      />

      {/* One calm summary line; the rules behind it are one tap away. */}
      <InfoTip
        label="auto-pause rules"
        className="fleet-summary"
        rowClassName="gap-x-1.5 flex-nowrap"
        info={
          <>
            <p className="font-medium text-ink">When tracking stops by itself</p>
            <p>
              Each automatic check uses credits, so checking stops by itself in these cases:
            </p>
            <ul className="mt-2 space-y-1.5">
              {AUTO_PAUSE_RULES.map((rule) => (
                <li key={rule.label}>
                  <span className="font-medium text-ink">{rule.label}.</span> {rule.body}
                </li>
              ))}
            </ul>
            <p className="mt-2">{PAUSE_HELP_LINE}</p>
            <p>
              <Link href="/support#watching" className="font-medium text-brand-500 hover:underline">
                More on pausing
              </Link>
            </p>
          </>
        }
      >
        <p className="fleet-summary-line">
          <span>
            {all.length} truck{all.length === 1 ? "" : "s"}
          </span>
          {halted > 0 ? <span className="is-warn">{halted} halted</span> : null}
          {overview.plan_name ? (
            <span>
              {overview.plan_name}
              {limit === -1 ? "" : `, ${counts.live} of ${limit} slots used`}
            </span>
          ) : (
            <Link href="/portal/plan" className="is-link">
              Choose a plan to add trucks
            </Link>
          )}
        </p>
      </InfoTip>

      {all.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            icon={<PageIcon size={28} />}
            title="No trucks yet"
            description="Tap Add truck, enter the registration number and choose an alert. Its toll crossings will appear here."
          />
        </Panel>
      ) : (
        <div className="fleet-list-wrap">
          <nav className="fleet-filter-tabs" aria-label="Show trucks">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((value) => (
              <Link
                key={value}
                href={hrefFor(value, 1, q, sort)}
                aria-current={value === filter ? "page" : undefined}
                className={cx(value === filter && "is-active")}
              >
                {FILTER_LABEL[value]}
                <span className="fleet-filter-count">{counts[value]}</span>
              </Link>
            ))}
          </nav>

          <FleetToolbar
            basePath="/portal/trucks"
            params={filter === "live" ? {} : { filter: "paused" }}
            query={q}
            sort={sort}
            showSearch={all.length > SEARCH_FROM || q !== ""}
          />

          {/* A live truck with no enabled alert is never checked: the one
              surprise worth a line, and only when it is true. */}
          {filter === "live" && silent > 0 ? (
            <p className="fleet-warn">
              <BellOff size={13} aria-hidden className="shrink-0" />
              <span>
                {silent === 1 ? "1 live truck has" : `${silent} live trucks have`} no alert, so{" "}
                {silent === 1 ? "it is" : "they are"} not checked.
              </span>
            </p>
          ) : null}

          {shown.length === 0 ? (
            <Panel bodyClassName="p-0">
              {q ? (
                <EmptyState
                  title={`No ${filter === "live" ? "tracked" : "paused"} truck matches “${q}”`}
                  description="Check the number or label, or look in the other list."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Link
                        href={hrefFor(filter === "live" ? "watchlist" : "live", 1, q, sort)}
                        className={buttonClass("secondary", "sm", "whitespace-nowrap")}
                      >
                        Search {filter === "live" ? "paused" : "tracked"} trucks
                      </Link>
                      <Link
                        href={hrefFor(filter, 1, "", sort)}
                        className={buttonClass("ghost", "sm", "whitespace-nowrap")}
                      >
                        Clear search
                      </Link>
                    </div>
                  }
                />
              ) : (
                <EmptyState
                  title={filter === "live" ? "Nothing is being tracked" : "No paused trucks"}
                  description={
                    filter === "live"
                      ? "Every truck is paused, so no credits are being used. Open Paused and take a truck live to start checking it."
                      : "Every truck is being tracked. Pause a parked truck to save credits."
                  }
                />
              )}
            </Panel>
          ) : (
            <div className="fleet-rows">
              {shown.map((truck) => (
                <TruckCard key={truck.id} truck={truck} alerts={byTruck.get(truck.id) ?? []} />
              ))}
            </div>
          )}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              {page > 1 ? (
                <Link href={hrefFor(filter, page - 1, q, sort)} className={buttonClass("secondary", "sm")}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={hrefFor(filter, page + 1, q, sort)} className={buttonClass("secondary", "sm")}>
                  Next
                </Link>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
