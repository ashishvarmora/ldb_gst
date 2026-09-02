import Link from "next/link";
import { Filter, RotateCcw } from "lucide-react";

import { Select } from "@/components/form";
import { FilterSubmitButton, LinkPending } from "@/components/NavPending";
import { cx } from "@/components/ui";
import { dimsSentence } from "@/components/report";
import {
  CREDIT_SOURCES,
  PIVOT_DIMENSIONS,
  type Facet,
  type Facets,
  type LedgerKind,
  type PivotDimension,
} from "@/lib/analytics";
import { CREDIT_REASON_LABEL } from "@/lib/credits";
import { fmtNumber } from "@/lib/format";

/**
 * The two controls that turn a table into a report: what to group by, and what
 * to leave out.
 *
 * They are not in PivotTable because the table renders whatever it is handed
 * and does not care how the reader got there, and they are not in any one
 * screen's folder because Finance, Users and Usage all ask these same two
 * questions of the same ledger. One copy means one vocabulary:
 * `?dims=account,source` reads identically wherever it appears, and a link from
 * one screen into another lands on the slicing it named.
 *
 * Every screen offers a different subset - Usage has no business asking where a
 * credit came from, because that is a question about money and not about work
 * done - so both controls take an `offer` list rather than hard-coding what
 * exists. Restricting the options is not the same as having different controls.
 *
 * All of it is Server Components: links and a plain GET form. Grouping and
 * filtering ARE the state of the report, so they live in the URL, and putting
 * them there costs nothing beyond an anchor tag and a submit button.
 */

/* -------------------------------------------------------------------------- */
/* Group by                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One toggle per dimension, and the resulting grouping written out underneath.
 *
 * The sentence matters as much as the toggles. "Customer, then Source" says
 * what each row of the table below is a total OF, which is the one thing a
 * grouped table cannot say for itself - a figure of 500 means something quite
 * different per customer than it does per customer per day, and a reader who
 * has to infer which is looking at a report they cannot trust.
 */
export function GroupByBar({
  dims,
  hrefFor,
  offer = PIVOT_DIMENSIONS.map((d) => d.key),
}: {
  dims: PivotDimension[];
  /** Where a given grouping lives. The caller owns the rest of the query string. */
  hrefFor: (next: PivotDimension[]) => string;
  /** Which dimensions this screen may slice by. Defaults to all of them. */
  offer?: PivotDimension[];
}) {
  const shown = PIVOT_DIMENSIONS.filter((dimension) => offer.includes(dimension.key));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
          Group by
        </span>

        {shown.map((dimension) => {
          const on = dims.includes(dimension.key);
          return (
            <Link
              key={dimension.key}
              href={hrefFor(
                on ? dims.filter((d) => d !== dimension.key) : [...dims, dimension.key],
              )}
              title={dimension.hint}
              aria-pressed={on}
              className={cx(
                "relative inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium whitespace-nowrap transition",
                on
                  ? "border-brand-500 bg-brand-500/10 text-brand-500"
                  : "border-line text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <LinkPending size={13} />
              {dimension.label}
              {/*
               * The position in the grouping, not merely that it is on.
               * Customer-then-truck and truck-then-customer are two different
               * reports, and with the chips all looking alike the only place
               * that order was visible was the column order further down the
               * page - which is too late to notice you asked the other question.
               */}
              {on && dims.length > 1 ? (
                <span className="tabular-nums opacity-70">{dims.indexOf(dimension.key) + 1}</span>
              ) : null}
            </Link>
          );
        })}

        {dims.length > 0 ? (
          <Link
            href={hrefFor([])}
            className="relative inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted transition hover:text-ink"
          >
            <LinkPending size={13}>
              <RotateCcw size={13} />
            </LinkPending>
            Clear
          </Link>
        ) : null}
      </div>

      <p className="text-xs text-faint">
        One row per <span className="text-muted">{dimsSentence(dims).toLowerCase()}</span>. Every
        figure is grouped in the database, so the totals line agrees with the rows above it
        whichever way this is sliced.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Narrowing it                                                                */
/* -------------------------------------------------------------------------- */

/** Which half of the ledger, in the words the screens use for it. */
const KINDS: { key: LedgerKind; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "grant", label: "Credits added" },
  { key: "spend", label: "Credits spent" },
];

/** The facet groups a screen can offer. */
export type FacetName = "account" | "truck" | "reason" | "source";

/**
 * How a credit source reads.
 *
 * CREDIT_SOURCES covers the four ways credits arrive; 'spend' is the fifth
 * value credit_source() can return and is deliberately not in that list,
 * because a spend is not a source of anything. The filter still has to be able
 * to name it, so it is named here rather than by widening a list whose whole
 * purpose is "where credits came from".
 */
function sourceLabel(key: string): string {
  if (key === "spend") return "Spent";
  return CREDIT_SOURCES.find((source) => source.key === key)?.label ?? key;
}

/**
 * One facet, as a fold whose closed state says what it is currently doing.
 *
 * Closed by default and summarised, for the reason the ledger's own filter
 * pills were built: four rows of chips all showing every option all of the time
 * is what made the old controls read as noise, because a reader had to scan
 * twelve chips to learn that nothing was filtered. The summary shows the
 * ANSWER - "Customer · any", "Truck · 3 chosen" - and the options only exist
 * while somebody is choosing.
 *
 * A <details> rather than a popover: it needs no JavaScript, it is a native
 * disclosure on a phone, and it cannot be clipped by the Panel's own
 * overflow-hidden the way an absolutely positioned menu would be.
 *
 * Checkboxes rather than a <select multiple>. A native multi-select needs
 * ctrl-click to add a second value, which is undiscoverable and impossible on
 * a touchscreen - and the owner asked for exactly this: every option selectable
 * and de-selectable, with blank meaning no filter. An unticked group submits
 * nothing at all, which is what makes blank the natural state rather than a
 * value somebody has to choose.
 */
function FacetFold({
  name,
  label,
  anyLabel,
  options,
  selected,
  labelOf,
}: {
  /** The query parameter. Repeated once per ticked box, which parseList handles. */
  name: string;
  label: string;
  /** How "nothing ticked" reads in the summary. */
  anyLabel: string;
  options: { value: string; label: string; entries: number }[];
  selected: string[];
  labelOf?: (value: string) => string;
}) {
  if (options.length === 0) return null;

  const count = options.filter((option) => selected.includes(option.value)).length;

  return (
    <details className="group/fold min-w-0">
      <summary
        className={cx(
          "inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border px-3 text-xs font-medium whitespace-nowrap transition",
          count > 0
            ? "border-brand-500 bg-brand-500/10 text-brand-500"
            : "border-line text-muted hover:bg-sunken hover:text-ink",
        )}
      >
        <span className="text-faint group-open/fold:text-current">{label}</span>
        <span className="max-w-32 truncate">
          {count === 0
            ? anyLabel
            : count === 1
              ? (labelOf?.(selected.find((v) => options.some((o) => o.value === v)) ?? "") ??
                `${count} chosen`)
              : `${fmtNumber(count)} chosen`}
        </span>
      </summary>

      {/*
       * Capped height with its own scroller: the truck facet can hold two
       * hundred registration numbers, and a fold that pushes the Apply button
       * three screens down is a filter nobody manages to submit.
       */}
      <div className="mt-1.5 max-h-56 w-full overflow-y-auto overscroll-contain rounded-lg border border-line bg-raised p-2">
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <label key={option.value} className="cursor-pointer">
              <input
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
                className="peer sr-only"
              />
              {/*
               * The count beside each option says how much of the ledger the
               * choice would keep, so a busy account is distinguishable from a
               * quiet one before narrowing to it. Without it a dropdown of
               * twenty-five plate numbers is twenty-five equally blind guesses.
               */}
              <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-xs whitespace-nowrap text-muted transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 peer-checked:border-brand-500 peer-checked:bg-brand-500/12 peer-checked:text-brand-500 hover:border-line-strong hover:text-ink">
                {option.label}
                <span className="tabular-nums text-faint">{fmtNumber(option.entries)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

/** A facet list, in the shape FacetFold wants. */
function facetOptions(rows: Facet[], labelOf?: (value: string) => string) {
  return rows.map((row) => ({
    value: row.label,
    label: labelOf ? labelOf(row.label) : row.label,
    entries: Number(row.entries) || 0,
  }));
}

export function FacetFilters({
  action,
  carried,
  facets,
  kind,
  accounts = [],
  trucks = [],
  reasons = [],
  sources = [],
  clearHref,
  offer = ["account", "truck", "reason", "source"],
  showKind = true,
}: {
  /** The form's target path, e.g. "/admin/finance". */
  action: string;
  /**
   * Everything that must survive the filter: the range, the grouping, the sort,
   * the section. Never the page number - narrowing changes which rows exist, so
   * page four of the old result set is not a page of the new one.
   */
  carried: Record<string, string | undefined>;
  facets: Facets;
  kind: LedgerKind;
  /** The chosen values, already read out of the URL with parseList. */
  accounts?: string[];
  trucks?: string[];
  reasons?: string[];
  sources?: string[];
  /** Where "Clear filters" goes - the same report with nothing narrowed. */
  clearHref: string;
  /** Which facet groups this screen offers. Defaults to all four. */
  offer?: FacetName[];
  /** Off for a screen that is only ever looking at one half of the ledger. */
  showKind?: boolean;
}) {
  const narrowed =
    accounts.length + trucks.length + reasons.length + sources.length > 0 || kind !== "all";

  return (
    <form method="get" action={action} className="flex flex-wrap items-start gap-1.5">
      {/* Undefined is dropped, an empty string is carried: `dims=` is how a
          reader asks for no grouping at all, and losing it here would put the
          screen's default grouping back the moment a filter was applied. */}
      {Object.entries(carried).map(([key, value]) =>
        value === undefined ? null : (
          <input key={key} type="hidden" name={key} value={value} />
        ),
      )}

      {/*
       * The kind stays a single-choice select rather than joining the folds
       * below. It is not a filter on a column - it is which half of the ledger
       * is being looked at, and the three halves are mutually exclusive by
       * arithmetic: a row's delta is either negative or positive.
       */}
      {showKind ? (
        <Select name="kind" defaultValue={kind} className="h-9 py-0 text-xs">
          {KINDS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : null}

      {/*
       * A facet with nothing in it is not rendered at all. A grant has no truck
       * against it, so with "Credits added" chosen the truck facet comes back
       * empty - and an empty control beside a full one reads as data missing
       * rather than as a question that does not apply to what is on screen.
       */}
      {offer.includes("account") ? (
        <FacetFold
          name="account"
          label="Customer"
          anyLabel="any"
          selected={accounts}
          options={facets.accounts.map((row) => ({
            value: row.id,
            label: row.label,
            entries: Number(row.entries) || 0,
          }))}
          labelOf={(id) => facets.accounts.find((row) => row.id === id)?.label ?? "1 chosen"}
        />
      ) : null}

      {offer.includes("truck") ? (
        <FacetFold
          name="truck"
          label="Truck"
          anyLabel="any"
          selected={trucks}
          options={facetOptions(facets.trucks)}
          labelOf={(value) => value}
        />
      ) : null}

      {offer.includes("reason") ? (
        <FacetFold
          name="reason"
          label="Action"
          anyLabel="any"
          selected={reasons}
          options={facetOptions(facets.reasons, (value) => CREDIT_REASON_LABEL[value] ?? value)}
          labelOf={(value) => CREDIT_REASON_LABEL[value] ?? value}
        />
      ) : null}

      {/* One source is not a choice: with a single value in the window, ticking
          it narrows to everything and reads as a control that does nothing. */}
      {offer.includes("source") && facets.sources.length > 1 ? (
        <FacetFold
          name="source"
          label="Source"
          anyLabel="any"
          selected={sources}
          options={facetOptions(facets.sources, sourceLabel)}
          labelOf={sourceLabel}
        />
      ) : null}

      <FilterSubmitButton icon={<Filter size={13} />}>Apply</FilterSubmitButton>

      {narrowed ? (
        <Link
          href={clearHref}
          className="relative inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted transition hover:text-ink"
        >
          <LinkPending size={13}>
            <RotateCcw size={13} />
          </LinkPending>
          Clear filters
        </Link>
      ) : null}
    </form>
  );
}
