import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  BellPlus,
  CheckCircle2,
  ChevronDown,
  History,
  Info,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Timer,
  Trash2,
} from "lucide-react";

import {
  checkTruckNow,
  deleteTruckAlert,
  removeTruck,
  setTruckAlertEnabled,
  setTruckPaused,
  updateTruck,
} from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Disclosure, HelpNote } from "@/components/Disclosure";
import { InfoTip, LabelWithInfo } from "@/components/InfoTip";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { LatestPosition, RouteHistory } from "@/components/Timeline";
import { TruckAlertForm } from "@/components/TruckAlertForm";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE, lastCheckedLabel } from "@/components/TruckCard";
import { Badge, EmptyState, LinkCard, Panel, cx } from "@/components/ui";
import { alertSentence } from "@/lib/alerts";
import { intervalLabel } from "@/lib/intervals";
import { CREDIT_ACTIONS, TOPUP_HREF, costOf, formatCredits, loadRate } from "@/lib/credits";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import {
  AUTO_PAUSE_RULES,
  PAUSE_HELP_LINE,
  autoPauseCountdown,
  pauseCopyFor,
  pauseWhy,
} from "@/lib/pause";
import { getSessionUser } from "@/lib/auth";
import { SupportLine } from "@/components/SupportLine";
import { loadSettings } from "@/lib/settings";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AlertLog,
  AlertRuleTemplate,
  SearchLog,
  TrackedTruck,
  TruckAlertWithTemplate,
  TruckEvent,
} from "@/lib/types";

/**
 * How much of the route is loaded onto the page.
 *
 * Was 400. RouteHistory shows the newest few and folds the rest behind one tap,
 * so that fold could open onto 375 rows in a single burst - honest, since the
 * summary counts them, but unusable on a phone and pointless when the Records
 * page owns the full history and pages through it properly. Sixty keeps a
 * fortnight of a busy lorry on the page and hands the rest over.
 */
const ROUTE_LIMIT = 60;

/**
 * Crossings before the fold. Ten is about a phone screen, which is the point at
 * which somebody either has what they came for or wants the whole journey.
 */
const ROUTE_VISIBLE = 10;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /*
   * Scoped to the reader, exactly as the page body is.
   *
   * This ran on the service-role client with only .eq("id", …), so a signed-in
   * account that knew another account's truck id got that registration number
   * back in the document title while the body itself 404'd. A small leak, and
   * a whole registration number is not a small thing to leak. The session is
   * read here rather than trusted from the page, because metadata is generated
   * independently of it.
   */
  const session = await getSessionUser();
  if (!session) return { title: "Truck — Rahdari" };

  const { data } = await getSupabaseAdmin()
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", id)
    .eq("user_id", session.id)
    .maybeSingle();

  return { title: `${data?.truck_number ?? "Truck"} — Rahdari` };
}

/**
 * One truck, phone first.
 *
 * The top of the page answers the only three questions it is opened for:
 * where is it, when was it last checked, and what is watching it. Everything
 * else - the route, past alerts, past checks, settings, removal - sits behind
 * a collapsible section, so the page is a short list of headings rather than a
 * wall of panels.
 */
export default async function TruckDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string }>;
}) {
  const { id } = await params;
  const { added } = await searchParams;
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("*")
    .eq("id", id)
    .eq("user_id", overview.id)
    .maybeSingle<TrackedTruck>();

  if (!truck) notFound();

  const [
    { data: events, count: eventCount },
    { data: alerts },
    { data: checks },
    { data: rules },
    { data: templates },
    manualRate,
    settings,
  ] = await Promise.all([
    admin
      .from("truck_events")
      .select("*", { count: "exact" })
      .eq("user_id", overview.id)
      .eq("truck_number", truck.truck_number)
      .order("event_time", { ascending: false, nullsFirst: false })
      .limit(ROUTE_LIMIT),
    admin
      .from("alert_logs")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truck.truck_number)
      .order("created_at", { ascending: false })
      .limit(15),
    admin
      .from("search_logs")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truck.truck_number)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("truck_alerts")
      .select("*, template:alert_rule_templates(*)")
      .eq("user_id", overview.id)
      .eq("tracked_truck_id", truck.id)
      .order("created_at", { ascending: true }),
    admin
      .from("alert_rule_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    loadRate(admin, CREDIT_ACTIONS.manualSearch),
    loadSettings(admin),
  ]);

  /* Shown in the failure field so the officer can see what "empty" actually
     means today, rather than being asked to trust a word. */
  const defaultFailureCutoff = settings.trackingFailureCutoff;
  const defaultInactiveHours = settings.inactivePauseHours;

  /* Why it stopped, and - if it has not - when it is going to. Both read from
     the shared table so this page and the fleet card agree. */
  const pausedCopy = pauseCopyFor(truck);
  const pauseNote = pauseWhy(truck, settings);
  const countdown = autoPauseCountdown(truck);

  const eventList = (events ?? []) as TruckEvent[];
  const alertList = (alerts ?? []) as AlertLog[];
  const checkList = (checks ?? []) as SearchLog[];
  const ruleList = (rules ?? []) as TruckAlertWithTemplate[];
  const templateList = (templates ?? []) as AlertRuleTemplate[];

  const enabledRules = ruleList.filter((rule) => rule.is_enabled);
  const manualCost = costOf(manualRate);
  const status = truck.is_active ? truck.status : "unknown";
  const totalCrossings = eventCount ?? eventList.length;

  return (
    <div className="space-y-3">
      <Link
        href="/portal/trucks"
        className="inline-flex min-h-9 items-center gap-1.5 text-xs text-muted transition hover:text-brand-500"
      >
        <ArrowLeft size={13} />
        All my trucks
      </Link>

      {/* --------------------------- the first screen ---------------------- */}
      <Panel bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="font-mono text-xl font-semibold tracking-wide text-strong sm:text-2xl">
            {truck.truck_number}
          </h1>
          <Badge tone={TRUCK_STATUS_TONE[status]}>{TRUCK_STATUS_LABEL[status]}</Badge>
          {/*
            The badge answers "is it running"; the (i) answers the question that
            immediately follows it - paused since when, and for how long an
            idle window or how many failures. The full paragraph is in Settings
            further down the page, which is the right place to read it and the
            wrong place to have to scroll to for one number.
          */}
          {pausedCopy && pauseNote ? (
            <InfoTip
              label={`why ${truck.truck_number} is paused`}
              info={
                <>
                  <p>{pauseNote}</p>
                  {/* Where to go next depends on which kind of stop it was.
                      The per-truck limits are edited in Settings below; an
                      empty balance and a lapsed plan are not on this truck at
                      all, and pointing an officer at this lorry's fields to fix
                      either would send them looking for a setting that does not
                      exist. */}
                  <p>
                    {PAUSE_HELP_LINE}{" "}
                    {truck.paused_reason === "no_credits" ||
                    truck.paused_reason === "plan_expired" ? (
                      <Link
                        href={TOPUP_HREF}
                        className="font-medium text-brand-500 hover:underline"
                      >
                        {truck.paused_reason === "no_credits"
                          ? "Top up to start checking again"
                          : "Renew the plan to start checking again"}
                      </Link>
                    ) : (
                      <Link href="#tracking" className="font-medium text-brand-500 hover:underline">
                        Change when it stops by itself
                      </Link>
                    )}
                    .
                  </p>
                </>
              }
            >
              <Badge tone={pausedCopy.tone}>{pausedCopy.badge}</Badge>
            </InfoTip>
          ) : pausedCopy ? (
            <Badge tone={pausedCopy.tone}>{pausedCopy.badge}</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted">
          {truck.label ? `${truck.label} · ` : ""}
          {lastCheckedLabel(truck, ruleList)}
        </p>

        <div className="mt-3">
          <LatestPosition event={eventList[0] ?? null} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ActionForm action={checkTruckNow} closeOnSuccess={false}>
            <input type="hidden" name="truck_id" value={truck.id} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Checking...">
              <RefreshCw size={13} />
              Check now · {formatCredits(manualCost)} credit{manualCost === 1 ? "" : "s"}
            </SubmitButton>
          </ActionForm>

          <InlineActionForm
            action={setTruckPaused}
            hidden={{ truck_id: truck.id, is_active: truck.is_active ? "false" : "true" }}
          >
            {/* "Go live" is the owner's word for resuming, and the one that
                says what happens: checking restarts and the credits start
                again. "Resume" reads as undoing a UI state. */}
            <SubmitButton variant="ghost" size="sm">
              {truck.is_active ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
              {truck.is_active ? "Pause" : "Go live"}
            </SubmitButton>
          </InlineActionForm>
        </div>

        {truck.consecutive_errors > 0 ? (
          <p className="mt-3 rounded-lg border border-bad-500/35 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
            The last {truck.consecutive_errors} check
            {truck.consecutive_errors === 1 ? "" : "s"} did not go through. Checking carries on;
            tell your administrator if it stays this way.
          </p>
        ) : null}
      </Panel>

      {/* --------------------------- alerts, always open ------------------- */}
      {added ? (
        <p className="flex items-start gap-2 rounded-xl border border-good-500/40 bg-good-500/10 px-3 py-2.5 text-sm text-good-500">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span>
            {truck.truck_number} is on your list.{" "}
            {enabledRules.length > 0
              ? "Here is what will reach you about it."
              : "Nothing is watching it yet — add an alert below."}
          </span>
        </p>
      ) : null}

      <Panel
        title="Alerts on this truck"
        description="Checked only when one of these is due, and every automatic check costs one credit."
      >
        {ruleList.length === 0 ? (
          <p className="flex items-start gap-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-sm leading-relaxed text-warn-500">
            <BellOff size={15} className="mt-0.5 shrink-0" />
            <span>
              Nothing is watching {truck.truck_number}. It will not be checked and nothing will
              reach you until you add an alert below.
            </span>
          </p>
        ) : (
          <ul className="divide-y divide-divider overflow-hidden rounded-lg border border-line">
            {ruleList.map((rule) => (
              /*
                Stacked on a phone, side by side from sm up.
                The row was one flex line at every width: the sentence wrapped to
                three lines and the two controls sat vertically centred beside
                it, so a narrow screen showed a tall block of text with two
                buttons floating in the middle of its right-hand edge. Giving
                the text the full width and putting the controls on their own
                right-aligned line underneath costs one row of height and reads
                as a list again.
              */
              <li key={rule.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap sm:items-center">
                  {/*
                    The full sentence - "we look every 15 minutes and message
                    you only when..." - is three lines on a phone, and three of
                    those stacked buried the controls. It moves behind the (i),
                    so a row is one line saying what the alert is and how often,
                    and the promise is one tap away for whoever wants it.
                  */}
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-medium text-ink">{rule.template.name}</p>
                      {rule.is_enabled ? null : <Badge>off</Badge>}
                      {rule.template.is_active ? null : <Badge tone="warn">withdrawn</Badge>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-faint">
                      every {intervalLabel(rule.interval_minutes)}
                      {rule.plaza ? ` · ${rule.plaza}` : ""}
                    </p>
                    {/*
                      A native <details> rather than the (i) component, for two
                      reasons: it needs no client component, and its panel opens
                      in normal flow INSIDE the text column - so it cannot
                      overlap the Turn off and delete controls the way a popover
                      anchored in a flex row would.
                    */}
                    <details className="group/why mt-1">
                      <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-brand-500">
                        <Info size={11} className="shrink-0" />
                        What this does
                        <ChevronDown
                          size={11}
                          className="shrink-0 transition group-open/why:rotate-180"
                        />
                      </summary>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {alertSentence(rule.template.kind, rule.interval_minutes, rule.plaza)}
                      </p>
                    </details>
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <InlineActionForm
                      action={setTruckAlertEnabled}
                      hidden={{ alert_id: rule.id, is_enabled: rule.is_enabled ? "false" : "true" }}
                    >
                      <SubmitButton variant={rule.is_enabled ? "ghost" : "secondary"} size="sm">
                        {rule.is_enabled ? "Turn off" : "Turn on"}
                      </SubmitButton>
                    </InlineActionForm>

                    <InlineActionForm action={deleteTruckAlert} hidden={{ alert_id: rule.id }}>
                      <ConfirmSubmitButton
                        message={`Remove the "${rule.template.name}" alert from ${truck.truck_number}?`}
                        variant="ghost"
                      >
                        <Trash2 size={13} />
                        <span className="sr-only">Remove alert</span>
                      </ConfirmSubmitButton>
                    </InlineActionForm>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* lastCheckedLabel goes quiet about this once a truck has been
            checked at least once, so it is worth saying here. */}
        {ruleList.length > 0 && enabledRules.length === 0 ? (
          <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-500">
            Every alert here is switched off, so this truck is not being checked.
          </p>
        ) : null}

        <div className="mt-4">
          <Disclosure
            title={ruleList.length === 0 ? "Add the first alert" : "Add another alert"}
            hint="Pick what you want to hear about, then how often we check."
            defaultOpen={ruleList.length === 0}
            badge={<BellPlus size={13} className="text-brand-500" />}
          >
            <TruckAlertForm truckId={truck.id} templates={templateList} />
          </Disclosure>
        </div>
      </Panel>

      {/* --------------------------- everything else ----------------------- */}
      <Disclosure
        title="Route"
        hint={
          totalCrossings === 0
            ? "No toll crossings on record"
            : `${totalCrossings} toll crossing${totalCrossings === 1 ? "" : "s"}, newest first`
        }
      >
        <RouteHistory events={eventList} total={totalCrossings} recent={ROUTE_VISIBLE} />
      </Disclosure>

      <Disclosure
        title="Alerts raised"
        hint={
          alertList.length === 0
            ? "Nothing raised yet"
            : `Last one ${fmtRelative(alertList[0].created_at)}`
        }
        bodyClassName="p-0"
      >
        {alertList.length === 0 ? (
          <EmptyState
            title="No alerts raised for this truck"
            description="Anything an alert reports shows up here and on Telegram."
          />
        ) : (
          <ul className="divide-y divide-divider">
            {alertList.map((alert) => (
              <li key={alert.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-ink">{alert.title}</p>
                  {alert.delivered ? null : <Badge tone="warn">not sent</Badge>}
                </div>
                <p className="mt-0.5 text-[11px] text-faint">{fmtDateTime(alert.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>

      {/*
        The check list used to live here, from search_logs - which keeps seven
        days and is only written when a check FINDS something. So it showed a
        fraction of what had been charged and labelled the rest invisible, which
        is the opposite of what somebody checking their bill needs.

        Every check is a charge, and every charge is on the ledger for ever. So
        the complete list is one tap away on the activity page, already narrowed
        to this lorry, instead of an incomplete one being repeated here.
      */}
      <LinkCard
        href={`/portal/activity?truck=${encodeURIComponent(truck.truck_number)}&by=none`}
        icon={<History size={16} />}
        title="Every check on this truck"
        description="All of them, with what each one cost — not just the ones that found a movement."
      />

      {/* Not folded away like the sections above it. There are only two fields
          and a remove button, and hiding them behind a dropdown made people
          hunt for the pause switch. */}
      {/* id, because the pause (i) at the top of the page and the auto-pause
          help on My trucks both need to land on these fields rather than on
          the page - the route and the alert history sit between them. */}
      <Panel
        id="tracking"
        title="Settings"
        description="Label, pause, the limits that stop it by itself, and removing this truck."
      >
        {/*
          Why it stopped, said here where the switch to restart it is - not only
          on the card in a list the officer may not go back to.

          Every reason now, not just repeated failures. There are five of them,
          and the two new ones (a stop time that arrived, a lorry that stopped
          moving) are precisely the cases where the officer has no way to guess:
          nothing failed, nothing is broken, the truck simply went quiet. The
          wording comes from PAUSE_COPY so this panel, the card and the fleet
          list cannot tell three different stories.
        */}
        {pausedCopy ? (
          <p
            className={cx(
              "mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
              pausedCopy.tone === "bad"
                ? "border-bad-500/40 bg-bad-500/10 text-bad-500"
                : pausedCopy.tone === "warn"
                  ? "border-warn-500/40 bg-warn-500/10 text-warn-500"
                  : pausedCopy.tone === "brand"
                    ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
                    : "border-line bg-raised text-muted",
            )}
          >
            {pausedCopy.tone === "brand" ? (
              <Timer size={14} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            )}
            <span>
              {pausedCopy.detail}
              {truck.paused_reason === "repeated_failures" && truck.consecutive_errors > 0 ? (
                <> The last {truck.consecutive_errors} checks in a row could not be completed.</>
              ) : null}
              {truck.paused_at ? (
                <span className="mt-1 block opacity-80">
                  Stopped {fmtRelative(truck.paused_at)}.
                </span>
              ) : null}
            </span>
          </p>
        ) : null}

        {/*
          The other half of the same problem: a truck that is still running with
          a stop time coming. Somebody who set "6 hours" three days ago and is
          looking at this page deserves to be told, not surprised.
        */}
        {countdown ? (
          <p className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted">
            <Timer size={14} className="mt-0.5 shrink-0" />
            <span>
              Checking stops by itself <strong className="text-ink">{countdown}</strong>. Leave the
              box below empty to keep it running, or set a new time to push it back.
            </span>
          </p>
        ) : null}

        <ActionForm action={updateTruck} closeOnSuccess={false}>
          <input type="hidden" name="truck_id" value={truck.id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
            <Field label="Label" name="label" hint="Only you see this.">
              <Input
                name="label"
                defaultValue={truck.label ?? ""}
                placeholder="e.g. Supplier vehicle — north route"
              />
            </Field>

            <Checkbox
              name="is_active"
              label="Tracking active"
              hint="Uncheck to pause every alert on this truck. Its history is kept and no credits are spent while it is paused."
              defaultChecked={truck.is_active}
            />
          </div>

          <div className="mt-4 max-w-xs">
            <LabelWithInfo
              label="Stop checking after this many failures"
              htmlFor="max_consecutive_failures"
              info={
                <>
                  A check fails when the portal cannot answer for this number. After five failures
                  in a row we message you; at this number the truck is paused, because a failed
                  check costs a credit like any other and retrying a number the portal will not
                  answer only buys errors. Nothing is deleted.
                  <span className="mt-1.5 block text-faint">
                    Leave it empty to follow the platform default, currently {defaultFailureCutoff}.
                    Setting your own here fixes it for this truck only, and it will not move when
                    the default does.
                  </span>
                </>
              }
            />
            <Input
              id="max_consecutive_failures"
              name="max_consecutive_failures"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              step={1}
              defaultValue={truck.max_consecutive_failures ?? ""}
              placeholder={`Default (${defaultFailureCutoff})`}
              className="mt-1.5"
            />
          </div>

          {/*
            The other two stops, editable in the same place as the first. One
            heading, because all three answer a single question - when should
            this stop by itself - and somebody deciding that wants all three
            answers in front of them rather than across three panels.
          */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <LabelWithInfo
                label="Stop checking automatically after"
                htmlFor="auto_pause_amount"
                info={
                  <>
                    A countdown that starts when you save. Use it when you only need to follow this
                    truck for a while — when the time is up it is paused and you are told, so it
                    stops spending credits whether or not you remembered to come back. Its
                    tracking slot goes back to your plan at the same moment.
                    <span className="mt-1.5 block text-faint">
                      Leave it empty to keep checking until you pause it yourself. Saving with a
                      number in the box restarts the countdown from now.
                    </span>
                  </>
                }
              />
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="auto_pause_amount"
                  name="auto_pause_amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={8760}
                  step={1}
                  placeholder="No limit"
                  className="flex-1"
                />
                <Select name="auto_pause_unit" defaultValue="hours" className="w-24 shrink-0">
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </Select>
              </div>
            </div>

            <div>
              <LabelWithInfo
                label="Pause if it stops moving for"
                htmlFor="inactive_pause_hours"
                info={
                  <>
                    Counted from the last toll crossing that came through. A parked lorry answers
                    every check with the same crossing as yesterday, so this pauses it rather than
                    spending a credit every fifteen minutes to be told nothing new.
                    <span className="mt-1.5 block text-faint">
                      Leave it empty to follow the platform default, currently{" "}
                      {defaultInactiveHours} hours. Set it longer for a truck you expect to be
                      parked.
                    </span>
                  </>
                }
              />
              <Input
                id="inactive_pause_hours"
                name="inactive_pause_hours"
                type="number"
                inputMode="numeric"
                min={1}
                max={8760}
                step={1}
                defaultValue={truck.inactive_pause_hours ?? ""}
                placeholder={`Default (${defaultInactiveHours} hours)`}
                className="mt-1.5"
              />
            </div>
          </div>

          {/*
            The fuller explanation the (i)s elsewhere link to, folded so it is
            one line until somebody wants it. It belongs beside the three boxes
            that cause it rather than on the support site, because this is where
            an officer decides how patient to be with a lorry - and the decision
            is only sensible once you know a check costs a credit.
          */}
          <HelpNote title="What stops this truck by itself" className="mt-4">
            <p>
              A tracked truck is checked every fifteen minutes and each check costs one credit —
              about 96 credits a day for one lorry. Pausing it is the largest thing you can do
              about that, and these stop the checks on their own:
            </p>
            <ul className="mt-2 space-y-1.5">
              {AUTO_PAUSE_RULES.map((rule) => (
                <li key={rule.label}>
                  <span className="font-medium text-ink">{rule.label}.</span> {rule.body}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              {PAUSE_HELP_LINE}{" "}
              <Link
                href="/portal/trucks?filter=watchlist"
                className="font-medium text-brand-500 hover:underline"
              >
                See every paused truck
              </Link>
              .
            </p>
          </HelpNote>

          <FormActions>
            <SubmitButton>Save</SubmitButton>
          </FormActions>
        </ActionForm>

        <div className="mt-5 border-t border-divider pt-4">
          <p className="text-xs leading-relaxed text-muted">
            Removing stops the checks, deletes this truck&apos;s alerts and frees its tracking slot.
            Its {totalCrossings} toll crossing{totalCrossings === 1 ? "" : "s"} on record are kept.
            Pausing does the same to the checks and the credits, and keeps the alerts.
          </p>
          <ActionForm action={removeTruck} closeOnSuccess={false} className="mt-3">
            <input type="hidden" name="truck_id" value={truck.id} />
            <ConfirmSubmitButton
              message={`Remove ${truck.truck_number} from tracking?`}
              size="md"
            >
              <Trash2 size={13} />
              Remove truck
            </ConfirmSubmitButton>
          </ActionForm>
        </div>
      </Panel>

      {/*
        The one screen where a customer decides the product is broken.
        "My truck has not updated" is the commonest complaint there is, and
        this page is where they form that opinion - so the way to report it
        belongs here rather than only behind the account menu. Quiet and grey:
        a page that keeps asking whether anything is wrong reads as software
        that expects to be.
      */}
      <SupportLine
        support={{ email: settings.supportEmail, phone: settings.supportPhone }}
        className="mt-1"
      />
    </div>
  );
}
