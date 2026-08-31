"use client";

import { useState } from "react";
import { AlertTriangle, Infinity as Forever, Lock, ShieldCheck } from "lucide-react";

import {
  KEEP_DAYS_ERROR,
  KEEP_FOREVER,
  keepDaysInput,
  parseKeepDays,
  protectedConsequence,
} from "./keep-days";
import { ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { Badge, Mono } from "@/components/ui";
import type { RetentionRule } from "@/lib/types";

/**
 * One rule's fields, and the submit button that goes with them.
 *
 * The button lives in here rather than in the page - which is where the rest of
 * the console keeps it - because which button is right depends on what has just
 * been typed. A protected table whose window is still "forever" saves with an
 * ordinary button; the moment a number is typed into that box the save becomes
 * a destructive one and has to be confirmed, and only the client knows that
 * before the form is posted.
 *
 * Only the window is held in state. The two checkboxes stay uncontrolled so the
 * shared Checkbox is used as it is, and the warnings below describe what the
 * rule does now rather than what an unsaved tick would do.
 */
export function RetentionRuleFields({
  rule,
  size,
}: {
  rule: RetentionRule;
  size: { rows: number; pretty: string } | null;
}) {
  const [keep, setKeep] = useState(keepDaysInput(rule.keep_days));

  const parsed = parseKeepDays(keep);
  const finite = parsed.ok && parsed.days !== KEEP_FOREVER;
  const days = parsed.ok ? parsed.days : rule.keep_days;

  // Saved state, not typed state: this is what the export job will do tonight.
  const deletesWithNoCopy = rule.is_enabled && rule.keep_days !== KEEP_FOREVER && !rule.backup_before_delete;
  const needsConfirm = rule.is_protected && finite;

  return (
    <>
      <input type="hidden" name="entity" value={rule.entity} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {rule.is_protected ? (
              <Lock size={14} className="shrink-0 text-warn-500" />
            ) : null}
            <h3 className="text-sm font-semibold text-strong">{rule.label}</h3>
            <Mono className="text-[11px] text-faint">{rule.entity}</Mono>
            {rule.is_protected ? <Badge tone="warn">Money record</Badge> : null}
            {rule.keep_days === KEEP_FOREVER ? (
              <Badge tone="good">
                <Forever size={11} />
                Kept for ever
              </Badge>
            ) : (
              <Badge tone={rule.is_enabled ? "brand" : "neutral"}>{rule.keep_days} days</Badge>
            )}
            {rule.is_enabled ? null : <Badge>Switched off</Badge>}
            {deletesWithNoCopy ? <Badge tone="bad">Deleted with no copy</Badge> : null}
          </div>
          {rule.description ? (
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
              {rule.description}
            </p>
          ) : null}
        </div>

        <dl className="shrink-0 text-right">
          <dt className="text-[11px] tracking-wide text-muted uppercase">On disk now</dt>
          <dd className="text-sm tabular-nums text-ink">{size ? size.pretty : "unknown"}</dd>
          <dd className="text-[11px] tabular-nums text-faint">
            {size ? `≈ ${size.rows.toLocaleString("en-IN")} rows` : "no size reported"}
          </dd>
        </dl>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="Keep for"
          name={`keep_days_${rule.entity}`}
          hint={
            parsed.ok
              ? finite
                ? `Anything older than ${days} days goes.`
                : "Nothing in this table is ever deleted."
              : KEEP_DAYS_ERROR
          }
        >
          <Input
            id={`keep_days_${rule.entity}`}
            name="keep_days"
            value={keep}
            onChange={(e) => setKeep(e.target.value)}
            autoComplete="off"
            aria-invalid={parsed.ok ? undefined : true}
            placeholder="30 or forever"
          />
          <button
            type="button"
            onClick={() => setKeep("forever")}
            className="mt-1.5 text-[11px] font-medium text-brand-500 transition hover:text-brand-600"
          >
            Keep everything for ever
          </button>
        </Field>

        <Checkbox
          name="backup_before_delete"
          label="Copy to a sheet first"
          hint="Off deletes the rows with no copy anywhere."
          defaultChecked={rule.backup_before_delete}
        />

        <Checkbox
          name="is_enabled"
          label="Apply this rule"
          hint="Off keeps every row whatever the window says."
          defaultChecked={rule.is_enabled}
        />
      </div>

      {needsConfirm ? (
        <div className="mt-4 rounded-lg border border-bad-500/50 bg-bad-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-bad-500">
            <AlertTriangle size={15} className="shrink-0" />
            A {days}-day window on {rule.label} destroys a record, not a log
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{protectedConsequence(rule)}</p>
          <div className="mt-3">
            <Checkbox
              name="confirm_trim"
              label={`Yes — delete ${rule.label.toLowerCase()} older than ${days} days`}
              hint="Nothing is saved without this tick. Put “forever” back in the box above to leave the record whole."
            />
          </div>
        </div>
      ) : rule.is_protected ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <Lock size={14} className="mt-0.5 shrink-0 text-good-500" />
          <span>
            Money records default to forever, and this one is. Nothing in it is ever deleted, which
            is what keeps every balance, receipt and coupon claim explainable.
          </span>
        </p>
      ) : null}

      {deletesWithNoCopy ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-bad-500/50 bg-bad-500/10 px-3 py-2.5 text-xs leading-relaxed text-bad-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Rows older than {rule.keep_days} days are deleted with no copy anywhere — not in a
            sheet, not in the database. There is nothing to restore from afterwards.
          </span>
        </p>
      ) : rule.is_enabled && rule.keep_days !== KEEP_FOREVER ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-500" />
          <span>
            Copied to a sheet first. If the copy fails, nothing at all is deleted — a broken sheet
            can never quietly turn into a deletion.
          </span>
        </p>
      ) : null}

      <FormActions>
        {needsConfirm ? (
          <ConfirmSubmitButton
            size="md"
            message={`${rule.label} older than ${days} days will be deleted. ${protectedConsequence(
              rule,
            )}\n\nSave this window?`}
          >
            Save and start deleting
          </ConfirmSubmitButton>
        ) : (
          <SubmitButton variant="secondary">Save rule</SubmitButton>
        )}
      </FormActions>
    </>
  );
}
