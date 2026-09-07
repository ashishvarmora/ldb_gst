"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Send } from "lucide-react";

import { addTruck } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Select } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import { AlertChooser } from "@/components/TruckAlertForm";
import type { AlertRuleTemplate } from "@/lib/types";

/**
 * Adding a truck and choosing its first alert, in one step.
 *
 * Adding used to stop at the number, and a truck with no alert is never
 * checked - so the most common first experience of the platform was silence.
 * The alert is not an extra here: it is the reason the truck is on the list.
 *
 * The order is the order the questions actually arrive in. The number is the
 * only thing that must be typed, so it is first and alone. The remark is
 * optional and sits under it rather than beside it - a two-column row on a
 * phone makes both boxes too narrow to read a registration number in. Then
 * what to be told, then where it will reach you, then how long to keep going.
 *
 * NOT ONE PARAGRAPH OF PROSE ON THE FIRST SCREEN. Every field used to carry a
 * hint under it and the alert fields were followed by a panel restating them,
 * which made a five-question form 927px tall on a 390px phone - it scrolled
 * before the submit button was reachable. Everything explanatory is behind the
 * (i) beside its own label or behind "More settings"; the only prose that
 * survives on the face of the form is the warning below, which is not an
 * explanation but a consequence.
 */
export function AddTruckForm({
  templates,
  defaultFailureCutoff,
  defaultInactiveHours,
  telegram,
}: {
  templates: AlertRuleTemplate[];
  /** The admin's number, used for any truck the officer leaves blank. */
  defaultFailureCutoff: number;
  /** The admin's "stopped moving for this long" fallback, in hours. */
  defaultInactiveHours: number;
  /**
   * Whether an alert from this truck would actually be delivered anywhere.
   * Worked out by the page, because the answer is a row in telegram_configs
   * and this is a Client Component. See DeliveryRow for what each value means.
   */
  telegram: TelegramReadiness;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <ActionForm action={addTruck} closeOnSuccess={false}>
      <div className="space-y-4">
        <div>
          <LabelWithInfo
            label="Truck number"
            htmlFor="truck_number"
            required
            info={
              <>
                The registration number as the toll network has it. Spaces, dashes and lower case
                are ignored, so GJ 02-at 8546 and GJ02AT8546 are the same lorry to us.
              </>
            }
          />
          <Input
            id="truck_number"
            name="truck_number"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="GJ02AT8546"
            className="mt-1.5 font-mono text-base tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
          />
        </div>

        {/* No (i) and no hint. "Whatever helps you recognise it later" is the
            whole of what a remark is, and the word plus the placeholder say it
            without a row of their own. */}
        <Field label="Remark (optional)" name="label">
          <Input name="label" placeholder="Supplier vehicle" />
        </Field>

        {/*
          Where the alert goes, inside the alert's own section and under no
          rule of its own. It is not a fifth question - it is the rest of the
          answer to the two above it, and a horizontal rule between them read
          as a new topic while costing sixteen pixels on the screen this change
          exists to shorten.
        */}
        <div className="border-t border-divider pt-4">
          <AlertChooser templates={templates} />
          {templates.length > 0 ? <DeliveryRow state={telegram} /> : null}
        </div>

        {/*
          On the first screen rather than behind "More settings", because it is
          the answer to the mistake this product actually causes: somebody puts
          a lorry on automatic checking to follow it for an afternoon, does not
          come back, and pays for a check every hour for a fortnight. Asking the
          question while they are still thinking about the journey costs one
          box; asking it later costs them credits.

          Blank is a real answer and the default one - plenty of trucks are
          meant to be watched indefinitely.
        */}
        <div className="border-t border-divider pt-4">
          <LabelWithInfo
            label="Stop checking after"
            htmlFor="auto_pause_amount"
            info={
              <>
                Set this if you only need to follow this truck for a while. When the time is up it
                is paused and you are told, so it stops spending credits at the moment you said it
                should — even if you have long since forgotten about it. Nothing is deleted, every
                crossing it recorded stays, and its tracking slot goes back to your plan.
                <span className="mt-1.5 block text-faint">
                  Leave it empty to keep checking until you pause it yourself.
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
              placeholder="Keep going"
              className="flex-1"
            />
            <Select name="auto_pause_unit" defaultValue="hours" className="w-28 shrink-0">
              <option value="hours">hours</option>
              <option value="days">days</option>
            </Select>
          </div>
        </div>

        {/*
          One toggle, not a second form. What is behind it is a safety valve
          most people never touch, and putting it on the first screen would
          make adding a truck look like configuring one.

          Two fields and nothing else now. It used to open on a folded note
          titled "How automatic pausing protects your credits" - four lines of
          arithmetic and two links, standing between the toggle and the boxes it
          was meant to introduce. The same account of the auto-pause rules is on
          the trucks list itself, behind the (i) beside "auto-pause", which is
          the screen where an officer wonders why a lorry went quiet; a person
          opening More settings has already decided to change a number.
        */}
        <div className="border-t border-divider pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-xs font-medium text-muted transition hover:text-ink"
          >
            {showAdvanced ? "Hide" : "More settings"}
          </button>

          {showAdvanced ? (
            <div className="mt-2 space-y-4">
              <div>
                <LabelWithInfo
                  label="Stop checking after this many failures"
                  htmlFor="max_consecutive_failures"
                  info={
                    <>
                      A check fails when the portal cannot answer for this number - usually a typo,
                      or a lorry it has stopped reporting. After five failures in a row we message
                      you. At this many the truck is paused, because a failed check still costs a
                      credit and retrying a number the portal will not answer just buys errors.
                      Nothing is deleted and its recorded crossings stay.
                      <span className="mt-1.5 block text-faint">
                        Leave it empty to use the platform default, currently{" "}
                        {defaultFailureCutoff} failed checks. Change it here only for a truck you
                        want more or less patience with.
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
                  placeholder={`Default (${defaultFailureCutoff})`}
                  className="mt-1.5"
                />
              </div>

              {/*
                The third stop, and the one nobody thinks to ask for. A lorry
                parked in a yard answers every check with the same crossing it
                answered with yesterday, so the checks cost credits and tell
                nobody anything. This is a per-truck number for the same reason
                the failure budget is: only the officer knows whether this
                particular vehicle is expected to sit still for a week.
              */}
              <div>
                <LabelWithInfo
                  label="Pause if it stops moving for"
                  htmlFor="inactive_pause_hours"
                  info={
                    <>
                      Counted from the last toll crossing that came through. If the lorry is parked
                      and no new crossing arrives for this long, checking is paused and you are
                      told — so a vehicle standing in a yard stops quietly spending a credit every
                      fifteen minutes to be given yesterday&rsquo;s answer.
                      <span className="mt-1.5 block text-faint">
                        Leave it empty to use the platform default, currently{" "}
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
                  placeholder={`Default (${defaultInactiveHours} hours)`}
                  className="mt-1.5"
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <FormActions>
        <SubmitButton pendingLabel="Adding...">
          {templates.length > 0 ? "Add truck and start watching" : "Add truck"}
        </SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

/**
 * Can an alert from this account actually be sent?
 *
 * Three states rather than a boolean, because there are two different ways for
 * the answer to be no and telling somebody to go and save a chat id they saved
 * months ago would send them looking for a problem that is not there.
 *
 * Derived exactly as dispatchAlerts() in src/lib/tracking.ts derives it -
 * `is_enabled && chat_id` - so this row cannot promise a delivery the worker
 * will not attempt, or warn about one it would.
 */
export type TelegramReadiness = "ready" | "no-chat-id" | "switched-off";

/**
 * The channels, and the trap.
 *
 * The trap is real and it is silent: with no chat id saved, an alert is still
 * evaluated, still costs its credit and still lands in alert_logs - so it
 * appears in the bell inside the app - but dispatchAlerts() records
 * `delivered: false` against it and no message is ever sent. Nothing on any
 * screen told somebody that before the alert they had just set up failed to
 * arrive.
 *
 * So the channel line is always on - it is the answer to "where does this
 * reach me", and it is where WhatsApp gets its "soon" - and the warning
 * appears only when the account is actually in the broken state. A permanent
 * "make sure Telegram is set up" note would be one more paragraph on a form
 * whose whole problem was paragraphs, and it would be false for every account
 * that has already connected.
 */
function DeliveryRow({ state }: { state: TelegramReadiness }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Send size={13} aria-hidden className="shrink-0 text-brand-500" />
        <span className="min-w-0">
          Sent to you on <span className="font-medium text-ink">Telegram</span>
          <span className="text-faint"> · WhatsApp coming soon</span>
        </span>
      </p>

      {/* Two sentences, not three. Every extra clause here is another line on a
          phone, and the consequence is already whole: it is recorded, and it is
          not sent. */}
      {state === "ready" ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-500">
          <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            {state === "no-chat-id"
              ? "No chat id saved, so alerts show in the app but are never sent."
              : "Telegram is switched off, so alerts show in the app but are never sent."}{" "}
            <Link href="/portal/settings#alerts" className="font-medium underline">
              {state === "no-chat-id" ? "Add your chat id" : "Turn it back on"}
            </Link>
          </span>
        </p>
      )}
    </div>
  );
}
