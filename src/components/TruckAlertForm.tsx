"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MapPin, Plus, Search } from "lucide-react";

import { addTruckAlert, findPlazas } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FormActions, Input, Select } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import { cx } from "@/components/ui";
import {
  ALERT_KIND_EXAMPLE,
  ALERT_KIND_HINT,
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

/**
 * The rule to land on before anybody chooses.
 *
 * It used to be templates[0], which is whatever the admin's sort_order puts
 * first - today "Location update", the one that messages on every single check
 * whether the lorry has moved or not. That is the most expensive answer and
 * almost never the one wanted: the question people arrive with is "tell me when
 * it moves", and leaving the default alone is how somebody ends up paying for a
 * message every hour saying the truck is still where it was.
 *
 * Matched on kind rather than on name, because the name is a row an admin can
 * rename without a deploy. Falls back to the first rule so a catalogue without
 * this kind still works.
 */
function preferredTemplate(templates: AlertRuleTemplate[]): AlertRuleTemplate | undefined {
  return templates.find((template) => template.kind === "location_change") ?? templates[0];
}

export function AlertChooser({
  templates,
  className,
}: {
  templates: AlertRuleTemplate[];
  className?: string;
}) {
  const first = preferredTemplate(templates);
  const [templateId, setTemplateId] = useState(first?.id ?? "");
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
    <div className={cx("space-y-4", className)}>
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
        {/* The description used to be printed under the select as well as
            inside this (i) - the same sentence twice, one of them permanent.
            The (i) keeps it, and adds the sample message, which is the thing
            that actually tells two similarly named rules apart. */}
        <LabelWithInfo
          label="What alert you want"
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
      </div>

      <div>
        {/* describeCadence() lives in here now rather than as a line under the
            field. It is the one genuinely live number on this form - change the
            interval and the checks-a-day changes with it - but it was a
            permanent third row on a form the owner asked to shorten, and it
            only means anything next to the credit arithmetic that was already
            behind this (i). Reading it needs one tap; the cost is stated in the
            same breath rather than two rows apart. */}
        <LabelWithInfo
          label="Every how many minutes auto checks"
          htmlFor="interval_value"
          required
          info={
            <>
              <strong className="font-medium text-ink">
                {minutes === null ? "Enter a whole number." : describeCadence(effective)}
              </strong>{" "}
              How soon you hear about a crossing, and what this truck costs. Every automatic check
              spends one credit, so a fifteen-minute beat is about 96 credits a day and an hourly
              one is 24 - and a slower beat still records every crossing the toll network reports,
              just later. This rule may run every {intervalLabel(floor)} at the fastest.
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
        {/* Stays. Not a hint - it only appears when the number typed cannot be
            honoured, and it says what will happen instead. */}
        {tooFast ? (
          <p className="mt-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-500">
            This alert may run every {intervalLabel(floor)} at the fastest, so it will check every{" "}
            {intervalLabel(floor)}.
          </p>
        ) : null}
      </div>

      {wantsPlaza ? <PlazaPicker value={plaza} onChange={setPlaza} /> : null}

      {/*
        The blue "we look every X and message you when..." panel is gone.
        It restated the two fields immediately above it - the rule name and the
        interval - in a sentence built from those very values, so it could never
        say anything the reader had not just typed. On a phone it was the single
        biggest block on the form and it pushed the submit button off the screen.
        alertSentence() is untouched and still used on the truck's own page,
        behind "What this does" on each saved alert - where the reader did not
        type the numbers a moment ago and a sentence is genuinely the shortest
        way to say what the rule now amounts to.
      */}
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
    <div>
      {/* Behind the (i) with every other explanation on this form. The list
          below the box already demonstrates what it is; the only part worth
          words is that a plaza missing from it is still usable.

          "Which toll plaza?" lost its question mark. InfoButton builds its
          accessible name as `What is ${label}?`, so a label that is already a
          question came out as "What is Which toll plaza??" to a screen reader.
          A noun phrase also matches the other labels on this form, which are
          statements now rather than questions. */}
      <LabelWithInfo
        label="Toll plaza to watch"
        htmlFor="plaza"
        required
        info={
          <>
            The list is the toll plazas this platform has recorded so far. Not there? Type the name
            and we will watch for it.
          </>
        }
      />
      <div className="relative mt-1.5">
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
    </div>
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
