import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  CheckCircle2,
  History,
  MoonStar,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Share2,
  Timer,
  Wallet,
} from "lucide-react";

import { checkTruckNow, removeTruck, setTruckPaused, updateTruck } from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { ShareTrip } from "@/components/TripControls";
import { TruckActivityTimeline, type LedgerDay } from "@/components/TruckActivityTimeline";
import { TruckMenu } from "@/components/TruckMenu";
import { Field, FormActions, Input } from "@/components/form";
import { RouteHistory, directionLabel } from "@/components/Timeline";
import {
  AutoPauseField,
  FailureLimitField,
  TruckAlertForm,
  type TakenAlert,
} from "@/components/TruckAlertForm";
import { TruckAlertRow, type AlertRowData } from "@/components/TruckAlertRow";
import { TruckTabs } from "@/components/TruckTabs";
import { lastCheckedLabel } from "@/components/TruckCard";
import { Badge, LinkCard, Panel, buttonClass, cx } from "@/components/ui";
import { alertCadence, alertIdentity, hoursLabel } from "@/lib/alerts";
import { CREDIT_ACTIONS, TOPUP_HREF, costOf, formatCredits, loadRate } from "@/lib/credits";
import { maskPlate } from "@/lib/destination";
import { env } from "@/lib/env";
import { fmtWhen, fmtWhenAgo } from "@/lib/format";
import {
  PAUSE_HELP_LINE,
  autoPauseCountdown,
  deleteTruckMessage,
  pauseCopyFor,
  pauseWhy,
  truckChip,
} from "@/lib/pause";
import { getSignedInUser } from "@/lib/auth";
import { loadTruckActivity } from "@/lib/truck-activity";
import { SupportLine } from "@/components/SupportLine";
import { loadSettings } from "@/lib/settings";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AlertLog,
  AlertRuleTemplate,
  TrackedTruck,
  TruckAlertWithTemplate,
  TruckEvent,
} from "@/lib/types";

/**
 * How much of the route is loaded onto the page. RouteHistory shows the
 * newest few and folds the rest; the Records page owns the full history.
 */
const ROUTE_LIMIT = 60;

/** Crossings before the fold - about a phone screen. */
const ROUTE_VISIBLE = 10;

/**
 * The truck row, read once per request: generateMetadata and the page both
 * ask for it, and cache() makes that one query instead of two. Scoped to the
 * reader, so another account's number cannot leak through the title.
 */
const loadOwnTruck = cache(async (userId: string, id: string): Promise<TrackedTruck | null> => {
  const { data } = await getSupabaseAdmin()
    .from("tracked_trucks")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<TrackedTruck>();
  return data ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSignedInUser();
  if (!user) return { title: "Truck — Rahdari" };
  const truck = await loadOwnTruck(user.id, id);
  return { title: `${truck?.truck_number ?? "Truck"} — Rahdari` };
}

/**
 * One truck, phone first (owner, 20 Nov 2026).
 *
 * A top card that is always there - plate, ONE status chip, where it was last
 * seen, and the action row - then a tab bar with four panels shown one at a
 * time: Alerts, Route, Activity, Settings. Every panel is rendered here on the
 * server; TruckTabs only chooses which is visible, so a tap fetches nothing.
 *
 * Top card in reading order (24 Nov 2026): plate + chip + label + ⋯ menu /
 * pause reason / last crossing and checks / Go live | Check now | Pause /
 * Share trip. Then the tabs. Destination, distance left, "moving away" and
 * the live-location card left this page that day: they belong to the
 * separate Live module, and this is the toll module.
 *
 * TABS ARE CLIENT-SIDE: all four panels are rendered in this one request and
 * TruckTabs only toggles `hidden` (and the #hash), so switching tabs makes no
 * request at all. Saving a form does not re-render twice either: the actions
 * revalidate this path, so their own response carries the new page and the
 * forms here pass refresh={false} (see ActionForm).
 */
export default async function TruckDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string }>;
}) {
  /*
   * SPEED. Two database round trips deep instead of three: everything keyed
   * on the truck id starts the moment the signed-in user id is known (checked
   * locally from the cookie), beside the portal gate's own profile and
   * overview reads; only the reads that need the truck NUMBER wait for the row.
   */
  const user = await getSignedInUser();
  if (!user) await requirePortalSession(); // redirects to /login
  const userId = user!.id;
  const admin = getSupabaseAdmin();

  const [{ id }, { added }] = await Promise.all([params, searchParams]);

  const [
    ,
    truck,
    { data: rules },
    { data: templates },
    manualRate,
    settings,
    { data: shareRow },
  ] = await Promise.all([
    requirePortalSession(),
    loadOwnTruck(userId, id),
    admin
      .from("truck_alerts")
      .select("*, template:alert_rule_templates(*)")
      .eq("user_id", userId)
      .eq("tracked_truck_id", id)
      .order("created_at", { ascending: true }),
    admin
      .from("alert_rule_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    loadRate(admin, CREDIT_ACTIONS.manualSearch),
    loadSettings(admin),
    /* The truck's live trip link, if any (0077). Before the migration this
       errors and reads as "no link". */
    admin
      .from("truck_shares")
      .select("token,expires_at")
      .eq("tracked_truck_id", id)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ token: string; expires_at: string }>(),
  ]);

  if (!truck) notFound();

  const [{ data: events, count: eventCount }, { data: alerts }, activity, { data: ledger }] =
    await Promise.all([
      admin
        .from("truck_events")
        .select("*", { count: "exact" })
        .eq("user_id", userId)
        .eq("truck_number", truck.truck_number)
        .order("event_time", { ascending: false, nullsFirst: false })
        .limit(ROUTE_LIMIT),
      admin
        .from("alert_logs")
        .select("id,kind,title,message,delivered,created_at")
        .eq("user_id", userId)
        .eq("truck_number", truck.truck_number)
        .order("created_at", { ascending: false })
        .limit(25),
      loadTruckActivity(userId, truck.truck_number, 40),
      /* Checks and their cost, one row per day and reason - also where the
         last automatic and last manual check times come from. */
      admin
        .from("credit_ledger_daily")
        .select("ist_date,reason,entries,credits,last_at")
        .eq("user_id", userId)
        .eq("truck_number", truck.truck_number)
        .in("reason", ["auto_check", "manual_search", "search_refund"])
        .order("last_at", { ascending: false })
        .limit(30),
    ]);

  const pausedCopy = pauseCopyFor(truck);
  const pauseNote = pauseWhy(truck, settings);
  const countdown = autoPauseCountdown(truck);

  const eventList = (events ?? []) as TruckEvent[];
  const ledgerRows = (ledger ?? []) as LedgerDay[];
  const alertList = (alerts ?? []) as AlertLog[];
  const ruleList = (rules ?? []) as TruckAlertWithTemplate[];
  const templateList = (templates ?? []) as AlertRuleTemplate[];

  const enabledRules = ruleList.filter((rule) => rule.is_enabled);

  const summaryOf = (rule: TruckAlertWithTemplate) =>
    alertCadence({
      kind: rule.template.kind,
      intervalMinutes: rule.interval_minutes,
      plaza: rule.plaza,
      haltAfterHours: rule.halt_after_hours,
      pauseAfterHours: rule.pause_after_hours,
    });

  /* What this truck is already watched for, so the add form offers each kind
     at most once and points at the row that exists - see offeredTemplates(). */
  const taken: TakenAlert[] = ruleList.map((rule) => ({
    identity: alertIdentity(rule.template.kind, rule.plaza),
    name: rule.template.name,
    plaza: rule.plaza,
    intervalMinutes: rule.interval_minutes,
    summary: summaryOf(rule),
    isEnabled: rule.is_enabled,
    href: `#alert-${rule.id}`,
  }));

  const rows: AlertRowData[] = ruleList.map((rule) => ({
    id: rule.id,
    name: rule.template.name,
    kind: rule.template.kind,
    summary: summaryOf(rule),
    intervalMinutes: rule.interval_minutes,
    floorMinutes: rule.template.min_interval_minutes,
    haltAfterHours: rule.halt_after_hours ?? null,
    pauseAfterHours: rule.pause_after_hours ?? null,
    isEnabled: rule.is_enabled,
    withdrawn: !rule.template.is_active,
    halted: rule.template.kind === "halt" && rule.is_enabled && (rule.halt_active ?? false),
  }));

  const manualCost = costOf(manualRate);
  const totalCrossings = eventCount ?? eventList.length;

  /*
   * ONE status chip, derived from the truck rather than from truck.status.
   *
   * The page used to show TRUCK_STATUS_LABEL[is_active ? status : "unknown"],
   * so every paused truck read "Not checked yet" - even one checked a hundred
   * times. Now: Paused when tracking is off (the reason is the line under the
   * plate), Halted when an enabled halt alert has reported a halt, else Live.
   */
  const chip = truckChip(truck, ruleList);

  /* Last automatic and last manual check, told apart from the ledger: the
     truck row has one last_polled_at that both kinds of check write. */
  const lastAt = (reason: string) =>
    ledgerRows.filter((row) => row.reason === reason).map((row) => row.last_at).sort().pop() ?? null;
  const lastAuto = lastAt("auto_check");
  const lastManual = lastAt("manual_search");
  const latest = eventList[0] ?? null;
  const heading = latest ? directionLabel(latest.direction) : null;

  const shareUrl = shareRow ? `${env.siteUrl}/t/${shareRow.token}` : null;
  const shareText = `Trip status of truck ${maskPlate(truck.truck_number)}:`;

  /* Where the pause (i) sends somebody who wants to change the limit that
     stopped this truck. The stopped-moving pause belongs to the halt alert. */
  const fixHref = truck.paused_reason === "inactive" ? "#alerts" : "#tracking";

  const creditWord = `${formatCredits(manualCost)} credit${manualCost === 1 ? "" : "s"}`;

  /* ------------------------------------------------------------------ */
  /* the four panels                                                      */
  /* ------------------------------------------------------------------ */

  const alertsPanel = (
    <section className="truck-section" aria-label="Alerts on this truck">
      {ruleList.length === 0 ? (
        <p className="truck-note is-warn">
          <BellOff size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>No alert yet, so {truck.truck_number} is never checked.</span>
        </p>
      ) : (
        <ul className="alert-rows">
          {rows.map((row) => (
            <TruckAlertRow key={row.id} alert={row} truckNumber={truck.truck_number} />
          ))}
        </ul>
      )}

      {ruleList.length > 0 && enabledRules.length === 0 ? (
        <p className="truck-note is-warn">
          <BellOff size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>Every alert is off, so this truck is not being checked.</span>
        </p>
      ) : null}

      <details className="add-alert" open={ruleList.length === 0}>
        <summary className={cx(buttonClass("secondary", "sm"), "add-alert-toggle")}>
          <Plus size={14} aria-hidden />
          Add alert
        </summary>
        <div className="add-alert-body">
          <TruckAlertForm truckId={truck.id} templates={templateList} taken={taken} />
        </div>
      </details>
    </section>
  );

  const routePanel = (
    <section className="truck-section">
      <p className="truck-section-hint">
        {totalCrossings === 0
          ? "No toll crossings on record."
          : `${totalCrossings} toll crossing${totalCrossings === 1 ? "" : "s"}, newest first.`}
      </p>
      <RouteHistory events={eventList} total={totalCrossings} recent={ROUTE_VISIBLE} />
    </section>
  );

  const activityPanel = (
    <div className="space-y-3">
      <section className="truck-section" aria-label="Activity on this truck">
        <TruckActivityTimeline activity={activity} alertLogs={alertList} ledger={ledgerRows} />
      </section>

      {/* Every check is a charge and every charge is on the ledger, so the
          complete list lives on the activity page, narrowed to this lorry. */}
      <LinkCard
        href={`/portal/activity?truck=${encodeURIComponent(truck.truck_number)}&by=none`}
        icon={<History size={16} />}
        title="Every check, and its cost"
      />
    </div>
  );

  /*
   * WHAT STOPS THIS TRUCK BY ITSELF - the halt/pause mapping (24 Nov 2026),
   * with this truck's own values, in one list:
   *
   *   End time          tracked_trucks.auto_pause_at       set here
   *   No toll crossing  tracked_trucks.inactive_pause_hours  set in the HALT
   *                     alert (its "pause after" is mirrored onto the truck;
   *                     migration 0080 makes the database keep it in step)
   *   Checks fail       tracked_trucks.max_consecutive_failures  set here
   *   Credits run out   account-wide, always on
   *
   * The value shown for "no toll crossing" is the TRUCK column, because that
   * is what the worker reads - so a truck still carrying a per-truck value
   * from before 20 Nov is shown honestly instead of as "off".
   */
  const haltRule =
    ruleList.find((rule) => rule.template.kind === "halt" && rule.is_enabled) ?? null;
  const inactiveHours =
    truck.inactive_pause_hours && truck.inactive_pause_hours >= 1 ? truck.inactive_pause_hours : null;
  const failureLimit = truck.max_consecutive_failures;

  const settingsPanel = (
    <section id="tracking" className="truck-section">
      <div className="stop-rules">
        <InfoTip
          label="automatic pauses"
          rowClassName="flex-nowrap"
          info={
            <>
              <p>
                Whichever comes first pauses tracking on this truck. A paused truck uses no credits
                and keeps its history; Go live at the top starts it again.
              </p>
              <p>
                Alerts only send messages, with one exception: the halt alert&apos;s pause time is
                this truck&apos;s &ldquo;no toll crossing&rdquo; pause.
              </p>
            </>
          }
        >
          <h2 className="stop-rules-title">Tracking pauses by itself when</h2>
        </InfoTip>
        <ul className="stop-rules-list">
          <li>
            <Timer size={14} aria-hidden className="stop-rules-icon" />
            <span className="stop-rules-what">The end time is reached</span>
            <span className="stop-rules-value">{countdown ?? "No end time"}</span>
          </li>
          <li>
            <MoonStar size={14} aria-hidden className="stop-rules-icon" />
            <span className="stop-rules-what">No toll crossing</span>
            <span className="stop-rules-value">
              {inactiveHours ? `for ${hoursLabel(inactiveHours)}` : "Off"}
              {haltRule ? (
                <a href={`#alert-${haltRule.id}`} className="stop-rules-link">
                  Halt alert
                </a>
              ) : inactiveHours ? (
                <span className="stop-rules-note">older setting</span>
              ) : (
                <a href="#alerts" className="stop-rules-link">
                  Add halt alert
                </a>
              )}
            </span>
          </li>
          <li>
            <AlertTriangle size={14} aria-hidden className="stop-rules-icon" />
            <span className="stop-rules-what">Checks fail</span>
            <span className="stop-rules-value">
              {failureLimit ? `${failureLimit} times in a row` : "Not set"}
            </span>
          </li>
          <li>
            <Wallet size={14} aria-hidden className="stop-rules-icon" />
            <span className="stop-rules-what">Credits run out</span>
            <span className="stop-rules-value">Always on</span>
          </li>
        </ul>
      </div>

      {/* Settings only. Go live / Pause at the top switch tracking; the
          "no toll crossing" pause is edited on the halt alert. */}
      <ActionForm action={updateTruck} closeOnSuccess={false} refresh={false}>
        <input type="hidden" name="truck_id" value={truck.id} />
        <div className="space-y-4">
          <Field label="Remark" name="label">
            <Input
              name="label"
              defaultValue={truck.label ?? ""}
              maxLength={80}
              placeholder="e.g. Supplier vehicle"
            />
          </Field>

          <AutoPauseField countdown={countdown} keep />

          <FailureLimitField defaultValue={truck.max_consecutive_failures} />
        </div>

        <FormActions>
          <SubmitButton>Save</SubmitButton>
        </FormActions>
      </ActionForm>

      {/* A small red link at the very bottom; the consequences are in the
          confirmation, read at the one moment they can change the answer. */}
      <ActionForm action={removeTruck} closeOnSuccess={false} className="truck-remove">
        <input type="hidden" name="truck_id" value={truck.id} />
        <ConfirmSubmitButton
          message={deleteTruckMessage(truck.truck_number)}
          variant="ghost"
          className="truck-remove-link"
        >
          Delete truck
        </ConfirmSubmitButton>
      </ActionForm>
    </section>
  );

  return (
    <div className="truck-page space-y-3">
      <Link
        href="/portal/trucks"
        className="inline-flex min-h-10 items-center gap-1.5 text-xs text-muted transition hover:text-brand-500"
      >
        <ArrowLeft size={13} />
        All my trucks
      </Link>

      {/* --------------------------- the top card -------------------------- */}
      <Panel bodyClassName="p-4" className="truck-top">
        <div className="truck-top-head">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="font-mono text-xl font-semibold tracking-wide text-strong sm:text-2xl">
              {truck.truck_number}
            </h1>
            <Badge tone={chip.tone}>{chip.label}</Badge>
            {truck.label ? (
              <span className="min-w-0 truncate text-xs text-muted">{truck.label}</span>
            ) : null}
          </div>
          <TruckMenu
            truckId={truck.id}
            truckNumber={truck.truck_number}
            active={truck.is_active}
            resumable={pausedCopy?.resumable ?? true}
            place="page"
          />
        </div>

        {/* Paused: one short line with the reason, and the detail behind (i). */}
        {pausedCopy ? (
          <InfoTip
            label={`why ${truck.truck_number} is paused`}
            className="mt-1"
            rowClassName="gap-x-1 text-xs flex-nowrap items-start"
            info={
              <>
                <p>{pauseNote ?? pausedCopy.detail}</p>
                {pauseNote ? <p>{pausedCopy.detail}</p> : null}
                {truck.paused_at ? <p>Paused at {fmtWhenAgo(truck.paused_at)}.</p> : null}
                <p>
                  {PAUSE_HELP_LINE}{" "}
                  {truck.paused_reason === "no_credits" || truck.paused_reason === "plan_expired" ? (
                    <Link href={TOPUP_HREF} className="font-medium text-brand-500 hover:underline">
                      {truck.paused_reason === "no_credits"
                        ? "Top up to start checking again"
                        : "Renew the plan to start checking again"}
                    </Link>
                  ) : truck.paused_reason === "repeated_failures" ||
                    truck.paused_reason === "schedule" ||
                    truck.paused_reason === "inactive" ? (
                    <a href={fixHref} className="font-medium text-brand-500 hover:underline">
                      {truck.paused_reason === "inactive"
                        ? "Change the halt alert"
                        : "Change when it stops by itself"}
                    </a>
                  ) : null}
                </p>
              </>
            }
          >
            <span className={cx("truck-pause-line", `is-${pausedCopy.tone}`)}>{pausedCopy.line}</span>
          </InfoTip>
        ) : null}

        {/* Clear timestamps: exact IST time, then how long ago. */}
        <dl className="truck-facts">
          <div>
            <dt>Last crossing:</dt>
            <dd>
              {latest ? (
                <>
                  <strong>{latest.loc_name ?? "Unnamed plaza"}</strong>
                  {heading ? ` (${heading})` : ""} · {fmtWhenAgo(latest.event_time)}
                </>
              ) : (
                "None recorded yet"
              )}
            </dd>
          </div>
          {lastAuto ? (
            <div>
              <dt>Last auto check:</dt>
              <dd>{fmtWhenAgo(lastAuto)}</dd>
            </div>
          ) : null}
          {lastManual ? (
            <div>
              <dt>Last manual check:</dt>
              <dd>{fmtWhenAgo(lastManual)}</dd>
            </div>
          ) : null}
          {!lastAuto && !lastManual ? (
            <div>
              <dt>Last check:</dt>
              <dd>
                {truck.last_polled_at
                  ? fmtWhenAgo(truck.last_polled_at)
                  : truck.is_active
                    ? lastCheckedLabel(truck, ruleList)
                    : "Not checked yet"}
              </dd>
            </div>
          ) : null}
        </dl>

        {truck.consecutive_errors > 0 ? (
          <p className="mt-3 rounded-lg border border-bad-500/35 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
            {truck.consecutive_errors === 1
              ? "The last check could not be completed."
              : `The last ${truck.consecutive_errors} checks could not be completed.`}
          </p>
        ) : null}

        {/* The action row: the only full-width buttons on the page. */}
        <div className={cx("truck-actions", truck.is_active ? "is-live" : "is-paused")}>
          {truck.is_active ? null : (
            <InlineActionForm
              refresh={false}
              action={setTruckPaused}
              hidden={{ truck_id: truck.id, is_active: "true" }}
            >
              <SubmitButton className="w-full" pendingLabel="Going live…">
                <PlayCircle size={15} aria-hidden />
                Go live
              </SubmitButton>
            </InlineActionForm>
          )}

          <ActionForm action={checkTruckNow} closeOnSuccess={false} refresh={false}>
            <input type="hidden" name="truck_id" value={truck.id} />
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Checking…">
              <RefreshCw size={14} aria-hidden />
              <span className="truck-check-label">
                Check now <small>· {creditWord}</small>
              </span>
            </SubmitButton>
          </ActionForm>

          {truck.is_active ? (
            <InlineActionForm
              refresh={false}
              action={setTruckPaused}
              hidden={{ truck_id: truck.id, is_active: "false" }}
            >
              <SubmitButton variant="secondary" pendingLabel="Pausing…">
                <PauseCircle size={15} aria-hidden />
                Pause
              </SubmitButton>
            </InlineActionForm>
          ) : null}
        </div>

        {/* The public trip link. Free - no credits, no message sent. */}
        <div className="truck-share-row">
          <Modal
            triggerLabel={shareUrl ? "Trip link shared" : "Share trip"}
            triggerIcon={<Share2 size={14} aria-hidden />}
            triggerVariant="secondary"
            triggerSize="sm"
            triggerClassName="w-full"
            title="Share this trip"
            description="A read-only link for your customer or driver. No sign-in, no cost."
            width="sm"
          >
            <ShareTrip
              truckId={truck.id}
              shareUrl={shareUrl}
              expiresLabel={shareRow ? `Works until ${fmtWhen(shareRow.expires_at)}.` : null}
              shareText={shareText}
            />
          </Modal>
        </div>
      </Panel>

      {added ? (
        <p className="flex items-start gap-2 rounded-xl border border-good-500/40 bg-good-500/10 px-3 py-2.5 text-sm text-good-500">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span>
            {truck.truck_number} is on your list.
            {enabledRules.length > 0 ? "" : " Add an alert below to start checking it."}
          </span>
        </p>
      ) : null}

      {/* --------------------------- the tabs ------------------------------ */}
      <TruckTabs
        tabs={[
          { id: "alerts", label: "Alerts", content: alertsPanel },
          { id: "route", label: "Route", content: routePanel },
          { id: "activity", label: "Activity", content: activityPanel },
          { id: "settings", label: "Settings", content: settingsPanel },
        ]}
      />

      <SupportLine
        support={{ email: settings.supportEmail, phone: settings.supportPhone }}
        className="mt-1"
      />
    </div>
  );
}
