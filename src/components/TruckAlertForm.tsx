"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, MapPin, Navigation, Plus, Search } from "lucide-react";

import { addTruckAlert, findPlazas, plazasAhead } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FormActions, Input, Select } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import { cx } from "@/components/ui";
import {
  ALERT_KIND_EXAMPLE,
  ALERT_KIND_HINT,
  alertIdentity,
  needsPlaza,
  normaliseLocation,
} from "@/lib/alerts";
import {
  MAX_INTERVAL_MINUTES,
  describeCadence,
  intervalLabel,
  intervalShort,
  splitInterval,
  toMinutes,
  type IntervalUnit,
} from "@/lib/intervals";
import {
  NO_MATCHES,
  PLAZA_INFO_LINES,
  PLAZA_UNLISTED_FIELD,
  aheadEmptyNote,
  aheadLabel,
  didYouMean,
  isKnownPlaza,
  unlistedPlazaConfirm,
  type PlazaLookup,
  type PlazaSuggestion,
  type PlazasAhead,
} from "@/lib/plazas";
import type { AlertRuleTemplate } from "@/lib/types";

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

/**
 * An alert this truck already carries.
 *
 * `identity` is alertIdentity() of the saved row, which is the same expression
 * as the unique index in migration 0048 - so what this form declines to offer
 * is exactly what the database would refuse.
 */
export type TakenAlert = {
  identity: string;
  name: string;
  /** The plaza as it is stored, for the kinds that name one. */
  plaza: string | null;
  intervalMinutes: number;
  isEnabled: boolean;
  /** Where to go to change it instead - the row's own anchor on the truck page. */
  href: string;
};

/**
 * The rules still worth offering for this truck.
 *
 * One alert of each kind, because two of a kind is one question polled on the
 * union of both beats and charged for every check. plaza_crossing is the
 * exception and is always offered: it watches one NAMED plaza, so a second
 * plaza on the same lorry is a second question - the plaza box below does that
 * check itself, against the plaza actually typed.
 *
 * Exported so the submit button and the picker cannot disagree about whether
 * there is anything left to add.
 */
export function offeredTemplates(
  templates: AlertRuleTemplate[],
  taken: TakenAlert[],
): AlertRuleTemplate[] {
  const held = new Set(taken.map((row) => row.identity));
  return templates.filter(
    (template) => needsPlaza(template.kind) || !held.has(alertIdentity(template.kind)),
  );
}

export function AlertChooser({
  templates,
  taken = [],
  truckId,
  className,
}: {
  templates: AlertRuleTemplate[];
  /** What the truck is already watched for. Empty while adding a new truck. */
  taken?: TakenAlert[];
  /**
   * The truck the alert is being added to, when there is one. Absent on the
   * add-truck form, and that absence is the honest reason the plaza box there
   * cannot suggest anything: a truck nobody has checked yet has no crossings,
   * so it has no position and nothing is ahead of it.
   */
  truckId?: string;
  className?: string;
}) {
  const offered = offeredTemplates(templates, taken);
  /* Named rather than silently dropped: a picker that is one item shorter than
     last time reads as a fault. Each line says what is already watching the
     truck and points at the interval on it, which is what somebody reaching
     for a second copy actually wanted to change. */
  const alreadyOn = templates
    .filter((template) => !offered.includes(template))
    .map((template) => taken.find((row) => row.identity === alertIdentity(template.kind)))
    .filter((row): row is TakenAlert => row !== undefined);

  const first = preferredTemplate(offered);
  const [templateId, setTemplateId] = useState(first?.id ?? "");
  const [interval, setInterval] = useState<{ value: string; unit: IntervalUnit }>(() => {
    const split = splitInterval(first?.default_interval_minutes ?? 60);
    return { value: String(split.value), unit: split.unit };
  });
  const [plaza, setPlaza] = useState("");

  const chosen = offered.find((template) => template.id === templateId) ?? null;

  if (!chosen) {
    return (
      <div className="space-y-2">
        <AlreadyOn rows={alreadyOn} />
        <p className="rounded-lg border border-line bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted">
          {alreadyOn.length > 0
            ? "Everything this truck can be watched for is already on it, so there is nothing to add."
            : "Alert types are not available yet, so nothing can watch this truck. Please try again shortly, or contact support if it stays this way."}
        </p>
      </div>
    );
  }

  const typed = Number(interval.value);
  const minutes = Number.isInteger(typed) ? toMinutes(typed, interval.unit) : null;
  const floor = chosen.min_interval_minutes;
  const tooFast = minutes !== null && minutes < floor;
  const effective = minutes === null ? floor : Math.max(minutes, floor);
  const wantsPlaza = needsPlaza(chosen.kind);

  /* The plaza kinds cannot be filtered out of the picker, because a second
     plaza is a second question - so the collision is tested against the plaza
     actually typed, as it is typed. addTruckAlert() refuses the same case, and
     the index refuses it under that. */
  const heldPlaza = wantsPlaza
    ? (taken.find((row) => row.identity === alertIdentity(chosen.kind, plaza)) ?? null)
    : null;

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
      <AlreadyOn rows={alreadyOn} />

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
            const next = offered.find((t) => t.id === event.target.value);
            if (next) pickTemplate(next);
          }}
          className="mt-1.5"
        >
          {offered.map((template) => (
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

      {wantsPlaza ? (
        <div>
          <PlazaPicker value={plaza} onChange={setPlaza} truckId={truckId} />
          {/* State, not explanation: it appears only when the plaza typed is
              one this truck is already watching, and it says where to change
              that one instead. */}
          {heldPlaza ? (
            <p className="mt-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-500">
              {/* Named as it is STORED, not as it was just typed. The match
                  ignores case and spacing, so echoing the box back would read
                  "you already watch nadiad TOLL plaza" - the officer's own
                  typo, quoted at them as though it were our record. */}
              You already watch {heldPlaza.plaza ?? plaza.trim()} on this truck.{" "}
              <a href={heldPlaza.href} className="font-medium underline">
                Change how often
              </a>{" "}
              instead, or name a different plaza.
            </p>
          ) : null}
        </div>
      ) : null}

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
 * Why the picker is shorter than it was.
 *
 * One line per kind the truck already carries, because "the option I used last
 * time has gone" is a bug report waiting to happen. Every line ends somewhere:
 * a live alert offers its interval, a switched-off one offers the switch, and
 * both point at the row on the truck's own page.
 */
function AlreadyOn({ rows }: { rows: TakenAlert[] }) {
  if (rows.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li
          key={row.identity}
          className="flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-xs leading-relaxed text-muted"
        >
          <Check size={13} aria-hidden className="mt-0.5 shrink-0 text-good-500" />
          <span className="min-w-0">
            <span className="font-medium text-ink">{row.name}</span> is already on this truck
            {row.isEnabled ? `, every ${intervalShort(row.intervalMinutes)}` : ", switched off"}.{" "}
            <a href={row.href} className="font-medium text-brand-500 hover:underline">
              {row.isEnabled ? "Change how often" : "Turn it on"}
            </a>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One offered plaza, in either list. The note on the right is the difference. */
function PlazaRow({
  plaza,
  picked,
  onPick,
}: {
  plaza: PlazaSuggestion;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={cx(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition",
          picked ? "bg-brand-500/8" : "hover:bg-raised",
        )}
      >
        <MapPin size={13} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-xs text-ink">{plaza.name}</span>
        <span className="shrink-0 text-[11px] whitespace-nowrap text-faint">
          {plaza.km !== null ? (
            /* How far in front of the lorry. Straight-line - the (i) says so -
               and the number is here rather than in the heading because it is
               what tells two plazas in the same direction apart. */
            `${plaza.km.toLocaleString("en-IN")} km`
          ) : (
            <>
              {/* Two plazas with near-identical names are common - Bhat, Bhatia
                  and Bhatwada are all on this network - and how often each has
                  been recorded is what tells them apart. */}
              seen {plaza.seen_count.toLocaleString("en-IN")} time
              {plaza.seen_count === 1 ? "" : "s"}
            </>
          )}
        </span>
        {picked ? <Check size={13} className="shrink-0 text-brand-500" /> : null}
      </button>
    </li>
  );
}

/**
 * The toll plaza box.
 *
 * THE LIST USED TO BE A POPULARITY RANKING. It was headed MOST RECORDED PLAZAS
 * and it was toll_plazas ordered by seen_count - the plazas the whole platform
 * has crossed most often, which is a fact about the platform and not about the
 * lorry on the screen. The owner's complaint is exactly right: the officer
 * wants the toll AHEAD of the truck, and the plaza at the top of a popularity
 * list is usually one it passed days ago or will never see.
 *
 * So an empty box now answers with this truck's own geometry - see
 * plazasAhead() and migration 0051 - and a typed box answers with fuzzy
 * matching. Neither ever invents anything: when the crossings will not support
 * a claim about what is ahead, the list is empty and says which fact was
 * missing, because a list that looks the same whether or not it means anything
 * is how the old one got away with meaning nothing.
 *
 * The typed text remains the answer and the lists only fill it in, so a plaza
 * this platform has never recorded is still watchable - with a confirmation,
 * because that is also what a misspelling looks like.
 */
function PlazaPicker({
  value,
  onChange,
  truckId,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Absent while a truck is being added: there are no crossings to reason from. */
  truckId?: string;
}) {
  const [lookup, setLookup] = useState<PlazaLookup>(NO_MATCHES);
  const [busy, setBusy] = useState(false);
  /** null until asked, and on the add form it is never asked. */
  const [ahead, setAhead] = useState<PlazasAhead | null>(null);
  /**
   * "Yes, watch the name I typed." Reset on every edit of the box below,
   * because a confirmation of one spelling must not silently authorise the
   * next one.
   */
  const [confirmed, setConfirmed] = useState(false);
  // Answers can come back out of order; only the newest query may paint.
  const latest = useRef(0);

  /* Once, when the picker appears. The truck's position does not change while
     somebody types, so re-asking on every keystroke would be a query per
     letter for an answer that cannot have moved. */
  useEffect(() => {
    if (!truckId) return;
    let live = true;
    plazasAhead(truckId)
      .then((result) => {
        if (live) setAhead(result);
      })
      .catch(() => {
        if (live) setAhead(null);
      });
    return () => {
      live = false;
    };
  }, [truckId]);

  useEffect(() => {
    const id = ++latest.current;
    setConfirmed(false);
    setBusy(true);
    const timer = setTimeout(() => {
      findPlazas(value)
        .then((result) => {
          if (latest.current === id) setLookup(result);
        })
        .catch(() => {
          if (latest.current === id) setLookup(NO_MATCHES);
        })
        .finally(() => {
          if (latest.current === id) setBusy(false);
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [value]);

  const typed = value.trim() !== "";
  const normalised = normaliseLocation(value);
  /* Only once the search has settled. Announcing "we have no such plaza" after
     every keystroke of a name that IS in the catalogue is just noise, and here
     it would be noise attached to a tick box. */
  const settled = !busy && normaliseLocation(lookup.query) === normalised;
  const known = isKnownPlaza(value, lookup);
  const unlisted = typed && settled && !known;
  const closest = unlisted ? didYouMean(lookup) : null;

  /* One list, and which one depends only on whether anything has been typed.
     Neither is a fallback for the other: a typed name is a question about that
     name, and an empty box is a question about the truck. */
  const offered = typed ? lookup.matches : (ahead?.plazas ?? []);
  const heading = typed ? "Closest matches" : ahead ? aheadLabel(ahead) : null;

  return (
    <div>
      {/* Everything this box needs explaining is behind the (i), which is where
          this form put the rest of its prose when it was cut from 927px to
          805px. Two lines, and the first is the one nobody could guess: that
          the list is about THIS lorry and what its limits are.

          "Which toll plaza?" lost its question mark long ago. InfoButton builds
          its accessible name as `What is ${label}?`, so a label that is already
          a question came out as "What is Which toll plaza??" to a screen
          reader. */}
      <LabelWithInfo
        label="Toll plaza to watch"
        htmlFor="plaza"
        required
        info={
          <>
            <p>{PLAZA_INFO_LINES.ahead}</p>
            <p>{PLAZA_INFO_LINES.typing}</p>
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
          /* Not a plaza name any more. It used to read "Start typing: nadiad"
             and there is no Nadiad in this catalogue, so the one worked example
             on the form was a name the box would then refuse. */
          placeholder="Start typing a plaza name"
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

      {offered.length > 0 && heading ? (
        <>
          <p className="mt-2 mb-1 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
            {/* The heading carries the basis of the list, because a list of
                plazas under no explanation is what let the old one pass for
                relevant. The arrow only appears when the rows really are
                directional. */}
            {!typed && ahead?.basis === "ahead" ? (
              <Navigation size={11} aria-hidden className="shrink-0" />
            ) : null}
            {heading}
          </p>
          {/* Height-bounded rather than trusted to be short: six rows is 246px
              on a 390px screen, which is a third of everything this form is
              allowed. */}
          <ul className="max-h-52 divide-y divide-divider overflow-y-auto rounded-lg border border-line">
            {offered.map((plaza) => (
              <PlazaRow
                key={plaza.name}
                plaza={plaza}
                picked={normaliseLocation(plaza.name) === normalised}
                onPick={() => onChange(plaza.name)}
              />
            ))}
          </ul>
        </>
      ) : null}

      {/* State, not explanation: only ever drawn in place of a list, and only
          for a truck whose position was actually asked about. */}
      {!typed && ahead && ahead.plazas.length === 0 ? (
        <p className="mt-2 rounded-lg border border-line bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
          {aheadEmptyNote(ahead)}
        </p>
      ) : null}

      {/*
        The one thing worth blocking a submit for.
        A plaza_crossing alert on a name no toll record produces is silent for
        ever - indistinguishable from "it has not got there yet" - and spends a
        credit on every check while being silent. Not refused outright, because
        a plaza this platform has not seen is far more often new than misspelt:
        80 names here against well over a thousand tolled plazas in the country.
        The tick is `required`, so the browser refuses the submit until it is
        made, and decidePlaza() in the trucks actions refuses the same thing
        server-side for a stale form or a second tab.
      */}
      {unlisted ? (
        <div className="mt-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5">
          <p className="flex gap-1.5 text-xs leading-relaxed text-warn-500">
            <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {closest ? <>Did you mean {closest}? </> : null}
              No plaza we hold is spelt &ldquo;{value.trim()}&rdquo;. An alert fires on the toll
              record&rsquo;s own spelling, so this one would stay silent and still cost a credit a
              check.
            </span>
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-warn-500">
            {/* The hidden companion is what makes an unticked box post "false"
                rather than nothing, so bool() can tell it from an absent
                field - the same trick the shared Checkbox uses. */}
            <input type="hidden" name={PLAZA_UNLISTED_FIELD} value="false" />
            <input
              type="checkbox"
              name={PLAZA_UNLISTED_FIELD}
              value="true"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="size-4 shrink-0 accent-[color:var(--color-warn-500)]"
            />
            {unlistedPlazaConfirm(value)}
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** Adds one more alert to a truck that already exists. */
export function TruckAlertForm({
  truckId,
  templates,
  taken = [],
}: {
  truckId: string;
  templates: AlertRuleTemplate[];
  /** What the truck already carries, so a kind is offered at most once. */
  taken?: TakenAlert[];
}) {
  /* The same filter the picker uses, so the button cannot invite a submission
     of a form that has nothing left to choose from. */
  const offered = offeredTemplates(templates, taken);

  return (
    <ActionForm action={addTruckAlert} closeOnSuccess={false}>
      <input type="hidden" name="truck_id" value={truckId} />
      <AlertChooser templates={templates} taken={taken} truckId={truckId} />

      {offered.length > 0 ? (
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
