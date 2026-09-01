import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  BellPlus,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
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
import { Disclosure } from "@/components/Disclosure";
import { LabelWithInfo } from "@/components/InfoTip";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { LatestPosition, RouteHistory } from "@/components/Timeline";
import { TruckAlertForm } from "@/components/TruckAlertForm";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE, lastCheckedLabel } from "@/components/TruckCard";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { alertSentence } from "@/lib/alerts";
import { CREDIT_ACTIONS, costOf, formatCredits, loadRate } from "@/lib/credits";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { getSessionUser } from "@/lib/auth";
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
 * How much of the route is loaded onto the page. Beyond this the whole history
 * is still on record and reachable from the Records page - loading a year of
 * crossings into one phone screen helps nobody.
 */
const ROUTE_LIMIT = 400;

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
          {truck.is_active ? null : <Badge>paused</Badge>}
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
            <SubmitButton variant="ghost" size="sm">
              {truck.is_active ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
              {truck.is_active ? "Pause" : "Resume"}
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
        description="This truck is checked only when one of these is due, and each check costs credits."
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
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink">{rule.template.name}</p>
                      {rule.is_enabled ? null : <Badge>off</Badge>}
                      {rule.template.is_active ? null : <Badge tone="warn">withdrawn</Badge>}
                    </div>
                    {/* The rule name alone was read as a category rather than a
                        promise, so each row says what it will do in full. */}
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      {alertSentence(rule.template.kind, rule.interval_minutes, rule.plaza)}
                    </p>
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
        <RouteHistory events={eventList} total={totalCrossings} />
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

      <Disclosure
        title="Checks"
        hint="Checks that found a movement, or failed. Quiet checks are not listed."
        bodyClassName="p-0"
      >
        {checkList.length === 0 ? (
          <EmptyState title="No checks yet" />
        ) : (
          <ul className="divide-y divide-divider">
            {checkList.map((check) => (
              <li key={check.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span className="text-xs text-muted">{fmtDateTime(check.created_at)}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={check.source === "manual" ? "brand" : "neutral"}>
                    {check.source === "manual" ? "by you" : "automatic"}
                  </Badge>
                  {check.ok ? (
                    <span className="text-xs text-muted">
                      {check.new_events > 0 ? `${check.new_events} new` : "no change"}
                    </span>
                  ) : (
                    <span title={friendlyError(check.error)}>
                      <Badge tone="bad">did not go through</Badge>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>

      {/* Not folded away like the sections above it. There are only two fields
          and a remove button, and hiding them behind a dropdown made people
          hunt for the pause switch. */}
      <Panel title="Settings" description="Label, pause, failure limit, and removing this truck.">
        {/* A truck the worker stopped says so here, where the switch to restart
            it is - not only on the card in the list the officer may not revisit. */}
        {!truck.is_active && truck.paused_reason === "repeated_failures" ? (
          <p className="mb-4 flex items-start gap-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-warn-500">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Checking stopped by itself after {truck.consecutive_errors} failed checks in a row.
              That usually means the number does not match any lorry the toll network reports.
              Check the number, then tick <strong>Tracking active</strong> to start again — the
              failure count is cleared when you do.
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
              hint="Uncheck to pause every alert on this truck without losing its history."
              defaultChecked={truck.is_active}
            />
          </div>

          <div className="mt-4 max-w-xs">
            <LabelWithInfo
              label="Stop checking after this many failures"
              htmlFor="max_consecutive_failures"
              info={
                <>
                  A check fails when the toll network cannot answer for this number. After five
                  failures in a row we message you; at this number the truck is paused so it stops
                  spending credits on a question with no answer. Nothing is deleted.
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

          <FormActions>
            <SubmitButton>Save</SubmitButton>
          </FormActions>
        </ActionForm>

        <div className="mt-5 border-t border-divider pt-4">
          <p className="text-xs leading-relaxed text-muted">
            Removing frees a tracking slot and deletes this truck&apos;s alerts. Its{" "}
            {totalCrossings} toll crossing{totalCrossings === 1 ? "" : "s"} on record are kept.
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
    </div>
  );
}
