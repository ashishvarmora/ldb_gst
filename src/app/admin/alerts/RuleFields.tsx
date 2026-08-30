"use client";

import { useState } from "react";

import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/form";
import { ALERT_KIND_HINT, ALERT_KIND_LABEL, needsPlaza } from "@/lib/alerts";
import { MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, intervalLabel } from "@/lib/intervals";
import type { AlertRuleKind, AlertRuleTemplate } from "@/lib/types";

/**
 * Every field of a rule, shared by the create and edit forms so the two cannot
 * drift apart.
 *
 * The kind dropdown is generated from ALERT_KIND_LABEL rather than written out
 * here: a fourth kind is one entry in src/lib/alerts.ts and it appears in this
 * form, its hint and the server-side validator at once.
 */
export function RuleFields({ rule }: { rule?: AlertRuleTemplate }) {
  const kinds = Object.keys(ALERT_KIND_LABEL) as AlertRuleKind[];
  const [kind, setKind] = useState<AlertRuleKind>(rule?.kind ?? kinds[0]);
  // Held as text so clearing the box does not snap the value to zero mid-edit.
  const [min, setMin] = useState(String(rule?.min_interval_minutes ?? 15));
  const [preset, setPreset] = useState(String(rule?.default_interval_minutes ?? 60));

  const minNumber = Number(min);
  const presetNumber = Number(preset);
  const tooFast =
    Number.isFinite(minNumber) && Number.isFinite(presetNumber) && presetNumber < minNumber;

  return (
    <div className="space-y-5">
      <FormGrid cols={2}>
        <Field
          label="Rule name"
          name="name"
          hint="What the officer sees in their list. Keep it plain."
        >
          <Input name="name" required defaultValue={rule?.name} placeholder="Location changed" />
        </Field>

        <Field
          label="Watches for"
          name="kind"
          hint={ALERT_KIND_HINT[kind]}
        >
          <Select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AlertRuleKind)}
          >
            {kinds.map((value) => (
              <option key={value} value={value}>
                {ALERT_KIND_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>

      <Field
        label="Description"
        name="description"
        hint="Shown under the rule name when an officer picks it. Say what will land on their phone."
      >
        <Textarea
          name="description"
          rows={2}
          defaultValue={rule?.description ?? ""}
          placeholder="Messages you only when the toll plaza differs from the one last reported."
        />
      </Field>

      {needsPlaza(kind) ? (
        <p className="rounded-lg border border-brand-500/35 bg-brand-500/8 px-3 py-2 text-xs leading-relaxed text-muted">
          The officer names the toll plaza when they attach this rule to a truck, so one rule covers
          every plaza on the network.
        </p>
      ) : null}

      <div>
        <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
          How often it may run
        </p>
        <FormGrid cols={2}>
          <Field
            label="Fastest repeat (minutes)"
            name="min_interval_minutes"
            hint={`The floor for this rule. An officer may pick this or anything slower. Currently ${intervalLabel(minNumber)}.`}
          >
            <Input
              name="min_interval_minutes"
              type="number"
              required
              min={MIN_INTERVAL_MINUTES}
              max={MAX_INTERVAL_MINUTES}
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </Field>

          <Field
            label="Suggested interval (minutes)"
            name="default_interval_minutes"
            hint={`Pre-filled when an officer adds this rule. Currently ${intervalLabel(presetNumber)}.`}
          >
            <Input
              name="default_interval_minutes"
              type="number"
              required
              min={MIN_INTERVAL_MINUTES}
              max={MAX_INTERVAL_MINUTES}
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            />
          </Field>
        </FormGrid>

        {tooFast ? (
          <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-500">
            The suggested interval is faster than the floor, so every officer adding this rule would
            be refused. Raise it to {minNumber} minutes or more.
          </p>
        ) : (
          <p className="mt-3 text-xs text-faint">
            Every check costs the officer credits, so a fast floor is an expensive rule.
          </p>
        )}
      </div>

      <FormGrid cols={2}>
        <Field
          label="Sort order"
          name="sort_order"
          hint="Lower numbers come first in the officer's list."
        >
          <Input
            name="sort_order"
            type="number"
            min={0}
            step="10"
            defaultValue={rule?.sort_order ?? 100}
          />
        </Field>

        <Checkbox
          name="is_active"
          label="Offer this rule to officers"
          hint="Off keeps existing alerts running but hides the rule from the picker."
          defaultChecked={rule?.is_active ?? true}
        />
      </FormGrid>
    </div>
  );
}
