"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MapPin, Plus, Search } from "lucide-react";

import { addTruckAlert, findPlazas } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Select } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import { cx } from "@/components/ui";
import {
  ALERT_KIND_EXAMPLE,
  ALERT_KIND_HINT,
  alertSentence,
  needsPlaza,
  normaliseLocation,
} from "@/lib/alerts";
import {
  MAX_INTERVAL_MINUTES,
  describeCadence,
  intervalLabel,
  splitInterval,
  toMinutes,
  type IntervalUnit,
} from "@/lib/intervals";
import type { AlertRuleTemplate, PlazaMatch } from "@/lib/types";

/**
 * Choosing an alert.
 *
 * Client-side because the whole point is that the form answers questions
 * before they are asked: the rule changes what is on screen, the interval
 * changes the sentence under it, and the plaza box searches as you type. It is
 * the same control whether the truck is being added or already exists, so the
 * two paths cannot drift into explaining the same thing differently.
 */

const HOURS_MAX = Math.floor(MAX_INTERVAL_MINUTES / 60);

export function AlertChooser({
  templates,
  className,
}: {
  templates: AlertRuleTemplate[];
  className?: string;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const first = templates[0];
  const [interval, setInterval] = useState<{ value: string; unit: IntervalUnit }>(() => {
    const split = splitInterval(first?.default_interval_minutes ?? 60);
    return { value: String(split.value), unit: split.unit };
  });
  const [plaza, setPlaza] = useState("");

  const chosen = templates.find((template) => template.id === templateId) ?? null;

  if (!chosen) {
    return (
      <p className="rounded-lg border border-line bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted">
        Alert types are not available yet, so nothing can watch this truck. Please try
        again shortly, or contact support if it stays this way.
      </p>
    );
  }

  const typed = Number(interval.value);
  const minutes = Number.isInteger(typed) ? toMinutes(typed, interval.unit) : null;
  const floor = chosen.min_interval_minutes;
  const tooFast = minutes !== null && minutes < floor;
  const effective = minutes === null ? floor : Math.max(minutes, floor);
  const wantsPlaza = needsPlaza(chosen.kind);

  /* Switching rules loads that rule's own suggested interval - leaving the
     previous rule's number behind is how people ended up on a beat they never
     chose. */
  function pickTemplate(template: AlertRuleTemplate) {
    setTemplateId(template.id);
    const split = splitInterval(template.default_interval_minutes);
    setInterval({ value: String(split.value), unit: split.unit });
  }

  return (
    <div className={cx("space-y-5", className)}>
      {/*
        A dropdown, not a stack of radio cards.
        Every rule used to be drawn as a full card carrying its name, its
        description and an example message. With three rules that was most of a
        phone screen before the first question was answered, and the admin can
        add rules from the console - at ten it would be unusable. A <select> is
        the one control that costs the same whether there are three or thirty,
        and it is the native picker on a phone, so it opens as a proper wheel.
        The detail did not disappear; it moved behind the (i).
      */}
      <div>
        <LabelWithInfo
          label="What should we tell you?"
          htmlFor="template_id"
          required
          info={
            <>
              <strong className="font-medium text-ink">{chosen.name}.</strong>{" "}
              {chosen.description ?? ALERT_KIND_HINT[chosen.kind]}
              <span className="mt-1.5 block text-faint">
                You would get: &ldquo;{ALERT_KIND_EXAMPLE[chosen.kind]}&rdquo;
              </span>
            </>
          }
        />
        <Select
          id="template_id"
          name="template_id"
          required
          value={templateId}
          onChange={(event) => {
            const next = templates.find((t) => t.id === event.target.value);
            if (next) pickTemplate(next);
          }}
          className="mt-1.5"
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
        {/* One line, always on: enough to know the right rule is picked
            without opening anything. */}
        <p className="field-hint">{chosen.description ?? ALERT_KIND_HINT[chosen.kind]}</p>
      </div>

      <div>
        <LabelWithInfo
          label="How often should we check?"
          htmlFor="interval_value"
          required
          info={
            <>
              How soon you hear about a crossing. Automatic checks are included in your plan and
              cost nothing, so a faster beat is free - pick what is useful rather than what is
              cheap. A slower one still records every crossing the toll network reports. This rule
              may run every {intervalLabel(floor)} at the fastest.
            </>
          }
        />
        <div className="mt-1.5 flex gap-2">
          <Input
            id="interval_value"
            name="interval_value"
            type="number"
            inputMode="numeric"
            min={1}
            max={interval.unit === "hours" ? HOURS_MAX : MAX_INTERVAL_MINUTES}
            step={1}
            required
            value={interval.value}
            onChange={(event) => setInterval({ ...interval, value: event.target.value })}
            className="flex-1"
          />
          <Select
            name="interval_unit"
            aria-label="Minutes or hours"
            value={interval.unit}
            onChange={(event) =>
              setInterval({ ...interval, unit: event.target.value as IntervalUnit })
            }
            className="w-28 shrink-0"
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </Select>
        </div>
        <p className="field-hint">
          {minutes === null
            ? "Enter a whole number of minutes or hours."
            : describeCadence(effective)}
        </p>
        {tooFast ? (
          <p className="mt-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-500">
            This alert may run every {intervalLabel(floor)} at the fastest, so it will check every{" "}
            {intervalLabel(floor)}.
          </p>
        ) : null}
      </div>

      {wantsPlaza ? <PlazaPicker value={plaza} onChange={setPlaza} /> : null}

      <p className="flex items-start gap-2 rounded-lg border border-brand-500/30 bg-brand-500/8 px-3 py-2.5 text-xs leading-relaxed text-ink">
        <Check size={14} className="mt-0.5 shrink-0 text-brand-500" />
        <span>{alertSentence(chosen.kind, effective, wantsPlaza ? plaza : null)}</span>
      </p>
    </div>
  );
}

/**
 * The toll plaza box.
 *
 * A dropdown of recorded plazas used to be the only way in, which made every
 * plaza the platform had not seen yet unwatchable. The typed text is the
 * answer here and the suggestions only fill it in, so a plaza missing from the
 * list is still perfectly usable - and the matching at alert time ignores case
 * and spacing, so only the spelling has to be right.
 */
function PlazaPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [matches, setMatches] = useState<PlazaMatch[]>([]);
  const [busy, setBusy] = useState(false);
  // Answers can come back out of order; only the newest query may paint.
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    setBusy(true);
    const timer = setTimeout(() => {
      findPlazas(value)
        .then((rows) => {
          if (latest.current === id) setMatches(rows);
        })
        .catch(() => {
          if (latest.current === id) setMatches([]);
        })
        .finally(() => {
          if (latest.current === id) setBusy(false);
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [value]);

  const normalised = normaliseLocation(value);
  const known = matches.some((match) => normaliseLocation(match.name) === normalised);
  // Only once the search has settled: saying "we have not recorded that" after
  // every keystroke of a name that is in the list is just noise.
  const isNew = normalised !== null && !known && !busy;

  return (
    <Field
      label="Which toll plaza?"
      name="plaza"
      hint="The list is the toll plazas this platform has recorded so far. Not there? Type the name and we will watch for it."
    >
      <div className="relative">
        <Search
          size={15}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
        />
        <Input
          name="plaza"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Start typing: nadiad"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pl-9"
        />
        {busy ? (
          <Loader2
            size={15}
            aria-hidden
            className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-faint"
          />
        ) : null}
      </div>

      {matches.length > 0 ? (
        <>
          <p className="mt-2 mb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
            {value.trim() === "" ? "Most recorded plazas" : "Closest matches"}
          </p>
          <ul className="divide-y divide-divider overflow-hidden rounded-lg border border-line">
            {matches.map((match) => {
              const picked = normaliseLocation(match.name) === normalised;
              return (
                <li key={match.name}>
                  <button
                    type="button"
                    onClick={() => onChange(match.name)}
                    className={cx(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-left transition",
                      picked ? "bg-brand-500/8" : "hover:bg-raised",
                    )}
                  >
                    <MapPin size={13} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{match.name}</span>
                    {/* Two plazas with near-identical names are common; how
                        often each has been recorded is what tells them apart. */}
                    <span className="shrink-0 text-[11px] whitespace-nowrap text-faint">
                      seen {match.seen_count.toLocaleString("en-IN")} time
                      {match.seen_count === 1 ? "" : "s"}
                    </span>
                    {picked ? <Check size={13} className="shrink-0 text-brand-500" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {isNew ? (
        <p className="mt-2 rounded-lg border border-line bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
          We have not recorded a plaza named exactly &ldquo;{value.trim()}&rdquo; yet. That is
          fine — we will watch for it. The spelling has to match what the toll record says;
          capitals and extra spaces do not matter.
        </p>
      ) : null}
    </Field>
  );
}

/** Adds one more alert to a truck that already exists. */
export function TruckAlertForm({
  truckId,
  templates,
}: {
  truckId: string;
  templates: AlertRuleTemplate[];
}) {
  return (
    <ActionForm action={addTruckAlert} closeOnSuccess={false}>
      <input type="hidden" name="truck_id" value={truckId} />
      <AlertChooser templates={templates} />

      {templates.length > 0 ? (
        <FormActions>
          <SubmitButton pendingLabel="Adding...">
            <Plus size={14} />
            Add alert
          </SubmitButton>
        </FormActions>
      ) : null}
    </ActionForm>
  );
}
