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
  updateTruckAlert,
} from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { InfoTip, LabelWithInfo } from "@/components/InfoTip";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { LatestPosition, RouteHistory } from "@/components/Timeline";
import { TruckAlertForm, type TakenAlert } from "@/components/TruckAlertForm";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE, lastCheckedLabel } from "@/components/TruckCard";
import { Badge, EmptyState, LinkCard, Panel, cx } from "@/components/ui";
import { alertIdentity, alertSentence } from "@/lib/alerts";
import { intervalLabel, splitInterval } from "@/lib/intervals";
import { CREDIT_ACTIONS, TOPUP_HREF, costOf, formatCredits, loadRate } from "@/lib/credits";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { PAUSE_HELP_LINE, autoPauseCountdown, pauseCopyFor, pauseWhy } from "@/lib/pause";
import { getSessionUser } from "@/lib/auth";
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
    /* search_logs is deliberately NOT read here. The check list moved to the
       activity page - see the LinkCard below - and this query was still being
       run and thrown away on every view of the page. */
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
  const ruleList = (rules ?? []) as TruckAlertWithTemplate[];
  const templateList = (templates ?? []) as AlertRuleTemplate[];

  const enabledRules = ruleList.filter((rule) => rule.is_enabled);

  /*
   * What this truck is already watched for, so the add form offers each kind
   * at most once and says where to change the one that exists - see
   * offeredTemplates() in TruckAlertForm. The identity is computed from the
   * joined template's kind, which the trigger in migration 0048 keeps equal to
   * the mirror the unique index is built on.
   */
  const taken: TakenAlert[] = ruleList.map((rule) => ({
    identity: alertIdentity(rule.template.kind, rule.plaza),
    name: rule.template.name,
    plaza: rule.plaza,
    intervalMinutes: rule.interval_minutes,
    isEnabled: rule.is_enabled,
    href: `#alert-${rule.id}`,
  }));
  const manualCost = costOf(manualRate);
  const status = truck.is_active ? truck.status : "unknown";
  const totalCrossings = eventCount ?? eventList.length;

  /*
   * Was this truck stopped by one of the three limits that are edited on this
   * page? If so the fold holding them opens on arrival, so the "Change when it
   * stops by itself" link on the pause (i) above lands on the field rather than
   * on a closed summary the reader then has to find.
   *
   * The other reasons are deliberately not here: an empty balance, a lapsed
   * plan and a suspension all stopped every truck on the account at once and
   * none of them has a setting on this lorry to change.
   */
  const stopsPaused =
    truck.paused_reason === "repeated_failures" ||
    truck.paused_reason === "schedule" ||
    truck.paused_reason === "inactive";

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

          {/* The label belongs with the number, not in front of the timestamp.
              It is the officer's own name for this lorry - identity, like the
              registration - and prefixed onto the line below it pushed the
              exact last-checked time onto a second line at 390px. This is also
              where the fleet card puts it, so the two now agree. */}
          {truck.label ? (
            <span className="min-w-0 truncate text-xs text-muted">{truck.label}</span>
          ) : null}
        </div>
        {/*
          THE EXACT TIME OF THE LAST CHECK, NOT "9m ago".

          The owner's instruction for this page. A relative time is fine on the
          fleet list, where twenty cards are being scanned for the one that has
          gone quiet - but this page is opened to answer "when exactly was this
          lorry last looked at", and "9m ago" is an answer somebody then has to
          do arithmetic on, against a clock they cannot see. So the timestamp
          leads, in IST, and the relative form stays behind it in brackets
          because "two days ago" is the half that lands at a glance.

          lastCheckedLabel is still the fallback and only the fallback: it is
          the one place that knows the difference between a truck that has never
          been checked, one with no alert on it at all, and one whose alerts are
          all switched off - three sentences that are not a timestamp. Note it
          returns the PAUSE line in preference to anything else, so a paused
          truck used to show no last-checked time here at all; the pause is
          already a badge and an (i) two lines above this, and the time it was
          last looked at is a fact the officer asked to be able to read.
        */}
        <p className="mt-1 text-xs text-muted">
          {truck.last_polled_at ? (
            <>
              Last checked{" "}
              <span className="font-medium tabular-nums text-ink">
                {fmtDateTime(truck.last_polled_at)}
              </span>{" "}
              <span className="text-faint">({fmtRelative(truck.last_polled_at)})</span>
            </>
          ) : (
            lastCheckedLabel(truck, ruleList)
          )}
        </p>

        {/*
          Only when there is a position to show.
          With nothing on record this drew a bordered "LAST SEEN AT" box whose
          entire content was a sentence saying there was nothing on record -
          the largest thing on the first screen, on the one truck that has
          least to say. The absence belongs to the Route section immediately
          below, whose closed line already reads "No toll crossings on record",
          and to the last-checked line above, which says whether anything has
          looked yet.
        */}
        {eventList[0] ? (
          <div className="mt-3">
            <LatestPosition event={eventList[0]} />
          </div>
        ) : null}

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

        {/* One line, and only the fact. "Checking carries on" was a
            reassurance, and it wrapped this to two lines on a phone to deliver
            news the reader had not asked for - the status badge above already
            says whether the truck is running. What to do about repeated
            failures is behind the failure-budget (i) in Settings. */}
        {truck.consecutive_errors > 0 ? (
          <p className="mt-3 rounded-lg border border-bad-500/35 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
            The last {truck.consecutive_errors} check
            {truck.consecutive_errors === 1 ? "" : "s"} did not go through.
          </p>
        ) : null}
      </Panel>

      {/* --------------------------- alerts, always open ------------------- */}
      {added ? (
        <p className="flex items-start gap-2 rounded-xl border border-good-500/40 bg-good-500/10 px-3 py-2.5 text-sm text-good-500">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          {/* "Here is what will reach you about it" was a caption for the panel
              directly underneath, which is titled "Alerts on this truck". The
              other half survives because it is not a restatement - it is the
              one case where the truck is on the list and nothing will happen. */}
          <span>
            {truck.truck_number} is on your list.
            {enabledRules.length > 0 ? "" : " Nothing is watching it yet — add an alert below."}
          </span>
        </p>
      ) : null}

      {/* No description. "Checked only when one of these is due, and every
          automatic check costs one credit" is an explanation of the panel's own
          title, and the credit arithmetic it carried is behind the (i) beside
          the interval field in the form below - where somebody is choosing a
          beat and the number can change their answer. */}
      <Panel title="Alerts on this truck">
        {ruleList.length === 0 ? (
          /* One sentence. The second one said the same thing twice - "it will
             not be checked" and "nothing will reach you" are one fact, and the
             fold below is already titled "Add the first alert" and open. */
          <p className="flex items-start gap-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-500">
            <BellOff size={14} className="mt-0.5 shrink-0" />
            <span>No alert yet, so {truck.truck_number} is never checked.</span>
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
              /* id, because a truck may now carry only one alert of each kind
                 and the add form sends anybody reaching for a second copy to
                 the row that already exists. */
              <li key={rule.id} id={`alert-${rule.id}`} className="px-3 py-2.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap sm:items-center">
                  {/*
                    The full sentence - "we look every 15 minutes and message
                    you only when..." - is three lines on a phone, and three of
                    those stacked buried the controls. It moves behind the fold,
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

                      Named for what it now does. Since one truck may hold only
                      one alert of each kind, changing the beat is the answer to
                      "I wanted 30 minutes as well as 15" - and the alternative
                      was deleting the alert and adding it back, which throws
                      away last_event_at and makes the replacement re-announce a
                      crossing the officer was told about weeks ago.
                    */}
                    <details className="group/why mt-1">
                      <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-brand-500">
                        <Timer size={11} className="shrink-0" />
                        Change how often
                        <ChevronDown
                          size={11}
                          className="shrink-0 transition group-open/why:rotate-180"
                        />
                      </summary>
                      {/* The sentence stays, as the one line above the box that
                          says what is being changed. */}
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {alertSentence(rule.template.kind, rule.interval_minutes, rule.plaza)}
                      </p>
                      <ActionForm action={updateTruckAlert} closeOnSuccess={false}>
                        <input type="hidden" name="alert_id" value={rule.id} />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            name="interval_value"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            required
                            aria-label={`How often ${rule.template.name} checks`}
                            defaultValue={splitInterval(rule.interval_minutes).value}
                            className="w-20"
                          />
                          <Select
                            name="interval_unit"
                            aria-label="Minutes or hours"
                            defaultValue={splitInterval(rule.interval_minutes).unit}
                            /* w-28, not w-24: at 24 the native select clipped
                               "minutes" to "minute", which reads as a typo. */
                            className="w-28"
                          >
                            <option value="minutes">minutes</option>
                            <option value="hours">hours</option>
                          </Select>
                          <SubmitButton variant="secondary" size="sm">
                            Save
                          </SubmitButton>
                        </div>
                      </ActionForm>
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

        {/* No hint. "Pick what you want to hear about, then how often we
            check" described the two fields inside the fold, which the fold
            already shows the moment it is opened. */}
        <div className="mt-4">
          <Disclosure
            title={ruleList.length === 0 ? "Add the first alert" : "Add another alert"}
            defaultOpen={ruleList.length === 0}
            badge={<BellPlus size={13} className="text-brand-500" />}
          >
            <TruckAlertForm truckId={truck.id} templates={templateList} taken={taken} />
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
        /* The exact time here too, for the same reason as the last-checked
           line above: the rows inside are timestamped, so a relative hint on
           the closed section disagreed with the first row the moment it
           opened. */
        hint={
          alertList.length === 0
            ? "Nothing raised yet"
            : `Last one ${fmtDateTime(alertList[0].created_at)}`
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
      {/* One line, title only. "With what each one cost." was a subtitle
          under a title that had room for the same three words, and it cost a
          second line on every view of this page. "on this truck" went with it:
          the card is on the truck's own page. */}
      <LinkCard
        href={`/portal/activity?truck=${encodeURIComponent(truck.truck_number)}&by=none`}
        icon={<History size={16} />}
        title="Every check, and its cost"
      />

      {/* Not folded away like the sections above it. There are only two fields
          and a remove button, and hiding them behind a dropdown made people
          hunt for the pause switch. */}
      {/* id, because the pause (i) at the top of the page and the auto-pause
          help on My trucks both need to land on these fields rather than on
          the page - the route and the alert history sit between them. */}
      {/* No description. It listed the panel's own contents - label, pause,
          limits, remove - all four of which are visible the moment the panel
          is on screen, and it cost two lines on a phone doing it. */}
      <Panel id="tracking" title="Settings">
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
            {/* The failure count is gone from here: it is a red strip at the
                top of this same page, and saying it twice on one screen made
                the paragraph a line longer for no new fact. The stop time is
                the exact one now, on the same line rather than under it - the
                officer wants to know when this lorry stopped, not roughly how
                long ago in a unit that changes every hour. */}
            <span>
              {pausedCopy.detail}
              {truck.paused_at ? (
                <> Stopped <span className="tabular-nums">{fmtDateTime(truck.paused_at)}</span>.</>
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
            {/* One line. What to do about it is the (i) on the box itself. */}
            <span>
              Checking stops by itself <strong className="text-ink">{countdown}</strong>.
            </span>
          </p>
        ) : null}

        <ActionForm action={updateTruck} closeOnSuccess={false}>
          <input type="hidden" name="truck_id" value={truck.id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
            {/* No hint. "Only you see this" is true of every field on the
                page, and the placeholder already shows what a label is for.
                Matches the add form, where the same hint went. */}
            <Field label="Label" name="label">
              <Input
                name="label"
                defaultValue={truck.label ?? ""}
                placeholder="e.g. Supplier vehicle — north route"
              />
            </Field>

            {/* No hint either. Three lines explaining a checkbox that duplicates
                the Pause button at the top of the page, whose own confirmation
                already says "it spends no credits until you take it live
                again". The box stays - updateTruck reads is_active from this
                form, so removing it would pause the truck on any save. */}
            <Checkbox name="is_active" label="Tracking active" defaultChecked={truck.is_active} />
          </div>

          {/*
            THE THREE STOP LIMITS, FOLDED.

            Three labels, three (i)s and four inputs, all of them set once when
            a truck is added and then never touched again - and on a phone they
            were about 200px of the page, standing between the two fields that
            are actually edited (the label and the switch) and the Save button.
            The owner's instruction for this screen was to use a dropdown to
            make it clean, and this is the block that answer was written for.

            A native <details> rather than Disclosure, matching "Change how
            often" on the alert rows above: a bordered card inside this panel
            would give a folded-away setting the same weight as the panel it is
            folded inside. Form controls in a closed <details> are still in the
            document and still submit - only a disabled control is left out -
            so a save with this shut writes exactly what a save with it open
            would, which is what makes folding it safe at all.

            Open when the platform stopped this truck for one of these three
            reasons, so the "Change when it stops by itself" link on the pause
            (i) at the top of the page still lands on a field rather than on a
            closed summary.
          */}
          <details
            open={stopsPaused}
            className="group/stops mt-4 rounded-lg border border-line bg-raised/40"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium text-muted transition hover:text-ink [&::-webkit-details-marker]:hidden">
              <Timer size={13} className="shrink-0" />
              When this stops by itself
              <ChevronDown
                size={13}
                aria-hidden
                className="ml-auto shrink-0 transition group-open/stops:rotate-180"
              />
            </summary>

            <div className="border-t border-divider px-3 py-3.5">
              <div className="max-w-xs">
                <LabelWithInfo
                  label="Stop checking after this many failures"
                  htmlFor="max_consecutive_failures"
                  info={
                    <>
                      A check fails when the portal cannot answer for this number. After five
                      failures in a row we message you; at this number the truck is paused, because
                      a failed check costs a credit like any other and retrying a number the portal
                      will not answer only buys errors. Nothing is deleted.
                      <span className="mt-1.5 block text-faint">
                        Leave it empty to follow the platform default, currently{" "}
                        {defaultFailureCutoff}. Setting your own here fixes it for this truck only,
                        and it will not move when the default does.
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

              {/* The other two stops, beside the first, because all three answer
                  one question - when should this stop by itself. */}
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <LabelWithInfo
                    label="Stop checking automatically after"
                    htmlFor="auto_pause_amount"
                    info={
                      <>
                        A countdown that starts when you save. Use it when you only need to follow
                        this truck for a while — when the time is up it is paused and you are told,
                        so it stops spending credits whether or not you remembered to come back. Its
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
                        Counted from the last toll crossing that came through. A parked lorry
                        answers every check with the same crossing as yesterday, so this pauses it
                        rather than spending a credit every fifteen minutes to be told nothing new.
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
                THE AUTO-PAUSE ESSAY IS GONE, not moved.

                It restated the three (i)s it sat under - every one of the five
                AUTO_PAUSE_RULES that applies to a single truck is the label of
                a field in this very fold, and its own (i) explains it where the
                decision is made. What was left was the arithmetic ("about 96
                credits a day") and a link to the paused list, neither of which
                belongs on the page for one truck: My trucks carries both, and
                that is where somebody comparing lorries already is.
              */}
            </div>
          </details>

          <FormActions>
            <SubmitButton>Save</SubmitButton>
          </FormActions>
        </ActionForm>

        <div className="mt-5 border-t border-divider pt-4">
          {/*
            The paragraph above this button has gone into the button's own
            confirmation. It was three lines of small print explaining a
            destructive action, sitting permanently on a page that is opened to
            find out where a lorry is - and it was read, if at all, before the
            reader had decided to remove anything. In the confirm dialog it is
            read at the one moment it can change the answer.
          */}
          <ActionForm action={removeTruck} closeOnSuccess={false}>
            <input type="hidden" name="truck_id" value={truck.id} />
            <ConfirmSubmitButton
              message={`Remove ${truck.truck_number} from tracking? Its alerts go and its slot is freed. The ${totalCrossings} toll crossing${totalCrossings === 1 ? "" : "s"} on record are kept.`}
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
