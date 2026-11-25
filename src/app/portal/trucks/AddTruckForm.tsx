"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Send } from "lucide-react";

import { addTruck } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FormActions, Input } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import {
  AlertChooser,
  AutoPauseField,
  FailureLimitField,
  SUGGESTED_FAILURE_LIMIT,
} from "@/components/TruckAlertForm";
import { Mono } from "@/components/ui";
import type { AlertRuleTemplate } from "@/lib/types";

/**
 * Adding a truck and choosing its first alert, in one step - the ONE form for
 * it, used by My trucks and by the search result's "Track automatically"
 * sheet (which used to add a truck with no alert and tell you to go back and
 * pick one: the exact two-step gap this form was built to close).
 *
 * FIELD DECISIONS (24 Nov 2026 pass - the full table is in the hand-off):
 *
 *   on the face, in the order the questions arrive
 *     Truck number         required, no default (or fixed, from a search)
 *     What alert           required, lands on "Only when it moves"
 *     Check every          required, EMPTY (owner) + one-tap picks
 *       or Halt hours x2   required, EMPTY (owner) + one-tap picks
 *     Toll plaza           required for the plaza alert only
 *     Sent on Telegram     a status line, and a warning only when broken
 *
 *   under "More settings", with its current values on the collapsed line
 *     Remark               optional
 *     Stop checking after  optional, empty = no end time
 *     Failed checks        required, prefilled 10 (visible, editable)
 *
 * Nothing on the face needs reading before the first tap: every explanation
 * is behind the (i) beside its own label.
 */
export function AddTruckForm({
  templates,
  telegram,
  truckNumber,
}: {
  templates: AlertRuleTemplate[];
  /**
   * Whether an alert from this truck would actually be delivered anywhere.
   * Worked out by the page, because the answer is a row in telegram_configs
   * and this is a Client Component. See DeliveryRow for what each value means.
   */
  telegram: TelegramReadiness;
  /** From a search result: the number is already known and not editable. */
  truckNumber?: string;
}) {
  return (
    <ActionForm action={addTruck} closeOnSuccess={false}>
      <div className="add-truck-form">
        {truckNumber ? (
          <p className="add-truck-fixed">
            <span className="text-muted">Truck</span>
            <Mono className="font-semibold tracking-wide text-strong">{truckNumber}</Mono>
            <input type="hidden" name="truck_number" value={truckNumber} />
          </p>
        ) : (
          <div>
            <LabelWithInfo
              label="Truck number"
              htmlFor="truck_number"
              required
              info={
                <>
                  The registration number as it appears on the truck. Spaces, dashes and capital
                  letters do not matter.
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
              enterKeyHint="next"
              placeholder="GJ02AT8546"
              className="mt-1.5 font-mono text-base placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
            />
          </div>
        )}

        <div className="add-truck-alert">
          <AlertChooser templates={templates} />
          {templates.length > 0 ? <DeliveryRow state={telegram} /> : null}
        </div>

        <MoreSettings />
      </div>

      <FormActions>
        <SubmitButton pendingLabel="Adding…" className="add-truck-submit">
          {templates.length > 0 ? "Add truck and start watching" : "Add truck"}
        </SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

/**
 * The three settings a first-time user should not have to think about, folded
 * - but never hidden: the collapsed line reads back what will be saved
 * ("No end time · pauses after 10 failed checks"), so the prefilled failure
 * limit is on screen without opening anything.
 *
 * The failure limit is required, so the fold opens itself if the browser finds
 * that box invalid on submit (an invalid control inside a closed <details>
 * cannot be focused, and Chrome would otherwise refuse the submit silently).
 */
function MoreSettings() {
  const ref = useRef<HTMLDetailsElement>(null);
  const [failures, setFailures] = useState(String(SUGGESTED_FAILURE_LIMIT));
  const [end, setEnd] = useState<{ amount: string; unit: string }>({ amount: "", unit: "hours" });
  const [remark, setRemark] = useState("");

  const endNumber = Number(end.amount);
  const endText =
    end.amount.trim() !== "" && endNumber > 0
      ? `stops after ${endNumber} ${end.unit === "days" ? (endNumber === 1 ? "day" : "days") : endNumber === 1 ? "hour" : "hours"}`
      : "no end time";
  const failNumber = Number(failures);
  const failText =
    failures.trim() !== "" && Number.isInteger(failNumber) && failNumber >= 1
      ? `pauses after ${failNumber} failed check${failNumber === 1 ? "" : "s"}`
      : "failed-check limit needed";

  return (
    <details
      ref={ref}
      className="add-truck-more"
      onInvalidCapture={() => {
        if (ref.current) ref.current.open = true;
      }}
    >
      <summary className="add-truck-more-toggle">
        <span className="min-w-0">
          <span className="add-truck-more-title">More settings</span>
          <span className="add-truck-more-values">
            {remark.trim() ? `“${remark.trim()}” · ` : ""}
            {endText} · {failText}
          </span>
        </span>
        <ChevronDown size={16} aria-hidden className="add-truck-more-chevron" />
      </summary>

      <div className="add-truck-more-body">
        <div>
          <label className="field-label" htmlFor="add-truck-label">
            Remark <span className="font-normal text-faint">(optional)</span>
          </label>
          <Input
            id="add-truck-label"
            name="label"
            placeholder="e.g. Supplier vehicle"
            value={remark}
            maxLength={80}
            onChange={(event) => setRemark(event.target.value)}
          />
        </div>
        <AutoPauseField onValue={setEnd} />
        <FailureLimitField onValue={setFailures} />
      </div>
    </details>
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
 * `delivered: false` against it and no message is ever sent. So the channel
 * line is always on, and the warning appears only when the account is
 * actually in the broken state.
 */
function DeliveryRow({ state }: { state: TelegramReadiness }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Send size={13} aria-hidden className="shrink-0 text-brand-500" />
        <span className="min-w-0">
          Sent to you in the app and on <span className="font-medium text-ink">Telegram</span>
        </span>
      </p>

      {state === "ready" ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-500">
          <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            {state === "no-chat-id"
              ? "No Telegram chat ID is saved, so alerts appear in the app only."
              : "Telegram is turned off, so alerts appear in the app only."}{" "}
            <Link href="/portal/notifications" className="font-medium underline">
              {state === "no-chat-id" ? "Add your chat ID" : "Turn it back on"}
            </Link>
          </span>
        </p>
      )}
    </div>
  );
}
