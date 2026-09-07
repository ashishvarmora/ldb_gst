import Link from "next/link";
import { BellOff, Download, Plus } from "lucide-react";

import { AddTruckForm, type TelegramReadiness } from "./AddTruckForm";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { TruckCard, isWatching } from "@/components/TruckCard";
import { EmptyState, PageHeader, Panel, buttonClass, cx } from "@/components/ui";
import { AUTO_PAUSE_RULES, PAUSE_HELP_LINE } from "@/lib/pause";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AlertRuleTemplate,
  TelegramConfig,
  TrackedTruck,
  TruckAlertWithTemplate,
} from "@/lib/types";

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
  live: "Being checked automatically, and spending credits",
  watchlist: "On your list, not being checked and not spending credits",
};

/**
 * The one line under the tabs, and the only place on this screen where what
 * pausing is FOR gets any words at all.
 *
 * One line per tab rather than a paragraph, because the rest of the answer is
 * behind the (i) beside it. An officer arriving on the watchlist is asking "have
 * I lost anything by pausing these?" and the answer is the owner's own sentence;
 * an officer on the live tab is being told, once, that these lorries are the
 * ones costing money and that they can stop themselves.
 */
const FILTER_LEAD: Record<Filter, string> = {
  live: "Each of these is being checked and charged a credit a check.",
  watchlist: "Paused trucks keep their history but do not consume tracking credits.",
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

/**
 * Would an alert this officer sets up actually be messaged to them?
 *
 * The same test dispatchAlerts() applies in src/lib/tracking.ts, deliberately
 * spelled the same way round: an alert with no chat id, or with the switch off,
 * is still evaluated, still charged and still written to alert_logs - so it
 * shows in the bell - and no message is ever sent. Nothing on the add-truck
 * form used to say so, which made the first alert somebody created the way they
 * found out.
 *
 * A missing row and a row with a null chat id are the same answer to the
 * officer, so both collapse to "no-chat-id" - they are told to go and add one
 * either way.
 */
function telegramReadiness(
  config: Pick<TelegramConfig, "chat_id" | "is_enabled"> | null,
): TelegramReadiness {
  if (!config?.chat_id) return "no-chat-id";
  return config.is_enabled ? "ready" : "switched-off";
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

  const [{ data: trucks }, { data: alerts }, { data: templates }, settings, { data: telegram }] =
    await Promise.all([
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
      /* Read on this screen rather than inside the modal, because the add form
         is a Client Component and this is one more row on a query that was
         already going out. See telegramReadiness() above for why the answer is
         worth a round trip at all. */
      admin
        .from("telegram_configs")
        .select("chat_id, is_enabled")
        .eq("user_id", overview.id)
        .maybeSingle<Pick<TelegramConfig, "chat_id" | "is_enabled">>(),
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
          <div className="flex flex-wrap items-center gap-2">
            {/*
              The account-wide crossings export. It lost its only button when
              the Records screen went, and the route survived that deletion on
              purpose: it is the ONLY on-demand crossings CSV a customer has.
              The Sheets backup is not a substitute - it copies only rows the
              retention purge is about to delete, and needs an integration that
              is switched off.

              Only offered once there is something to export: a download that
              hands back an empty file is worse than no button.
            */}
            {all.length > 0 ? (
              <a
                href="/portal/records/export?range=all"
                className={buttonClass("secondary", "md")}
                download
              >
                <Download size={15} />
                Crossings CSV
              </a>
            ) : null}
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
                telegram={telegramReadiness(telegram)}
              />
            </Modal>
          </div>
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
            One line, and the whole of the auto-pause explanation behind the (i)
            beside it.

            The rules used to be nowhere on this screen, which meant the first
            time an officer met one was a truck that had gone quiet on its own.
            Putting them on the page would cost a paragraph on the screen that
            is scanned more than any other, and the owner has asked repeatedly
            for this list to stay short - so the rules, the links and the
            arithmetic live in the panel, and the row keeps one sentence.

            No count in the sentence below, deliberately. It said "four" here,
            "Four things" on the truck's own page and "one of four limits" on
            the support page, all written by hand off the same array - so
            adding the empty-balance rule made three screens wrong at once.
            What the rules are FOR does not change when one is added.
          */}
          <InfoTip
            label="auto-pause"
            rowClassName="gap-x-1.5"
            info={
              <>
                <p className="font-medium text-ink">Auto-pause rules</p>
                <p>
                  A tracked truck is checked every fifteen minutes and each check costs one credit
                  — about 96 credits a day for one lorry. Pausing one is the largest thing you can
                  do about that, and checking also stops by itself in these situations, each of
                  them there to keep credits from going on an answer you already have:
                </p>
                <ul className="mt-2 space-y-1.5">
                  {AUTO_PAUSE_RULES.map((rule) => (
                    <li key={rule.label}>
                      <span className="font-medium text-ink">{rule.label}.</span> {rule.body}
                    </li>
                  ))}
                </ul>
                {/* mt-2 by hand: InfoTip's panel spaces p+p for itself, and the
                    list above this one breaks that adjacency. */}
                <p className="mt-2">{PAUSE_HELP_LINE}</p>
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  <Link
                    href={hrefFor("watchlist", 1)}
                    className="font-medium text-brand-500 hover:underline"
                  >
                    See your watchlist
                  </Link>
                  {/* Where the two per-truck limits actually live. There is no
                      account-wide page for them - they are set on the truck, or
                      left to follow the platform default - so this points at
                      the truck itself rather than inventing a settings URL. */}
                  <span className="text-faint">
                    Open any truck to set its own limits under Settings.
                  </span>
                  <Link
                    href="/support#watching"
                    className="font-medium text-brand-500 hover:underline"
                  >
                    More on pausing
                  </Link>
                </p>
              </>
            }
          >
            {/* flex-1 min-w-0 so the note wraps under itself and the (i) stays
                on the first line beside it. A plain <p> here is a flex item as
                wide as its text, which on a phone filled the row and left the
                icon stranded alone on a third line. */}
            <p className="min-w-0 flex-1 text-xs text-muted">{FILTER_LEAD[filter]}</p>
          </InfoTip>

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
                    ? "Every truck on your list is paused, so nothing is being checked and no credits are going out. Take one live to start checking it."
                    : "Every truck on your list is being checked. Pause any that are parked — a checked lorry costs a credit a check."
                }
              />
            </Panel>
          ) : (
            /* One column, always. These are rows now rather than cards, and
               two columns of rows on a wide screen means the eye has to
               scan two places for the number it is looking for. */
            <div className="space-y-2">
              {shown.map((truck) => (
                <TruckCard
                  key={truck.id}
                  truck={truck}
                  alerts={byTruck.get(truck.id) ?? []}
                  settings={settings}
                />
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
