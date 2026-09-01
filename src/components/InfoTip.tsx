"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Info, X } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * A field label with an (i) beside it that opens the explanation underneath.
 *
 * The forms here had grown a paragraph under every input - what an alert does,
 * what an example message looks like, what happens if the interval is too
 * fast. All of it worth knowing once and none of it worth re-reading on every
 * visit, and on a phone it turned a four-field form into a page of prose.
 *
 * Opens INLINE, directly under the field, rather than as a floating popover.
 * A popover has to be positioned, flipped when it would leave the screen, and
 * dismissed on scroll; on a narrow screen it ends up covering the very input it
 * describes. Pushing the field down is unglamorous and always readable.
 *
 * Deliberately not <details>, unlike HelpNote: the trigger is a small icon
 * beside a <label>, and a <summary> cannot sit inside a label's row without
 * taking the whole row's click - which would mean tapping the field name
 * opened the help instead of focusing the input.
 */
export function LabelWithInfo({
  label,
  htmlFor,
  info,
  required,
  className,
}: {
  label: string;
  /** Points the label at its input, so tapping the words still focuses it. */
  htmlFor?: string;
  info: ReactNode;
  required?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <label className="field-label mb-0" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-bad-500">*</span> : null}
        </label>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? `Hide help for ${label}` : `What is ${label}?`}
          className={cx(
            "-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full transition",
            open ? "bg-brand-500/12 text-brand-500" : "text-faint hover:bg-sunken hover:text-ink",
          )}
        >
          {open ? <X size={13} /> : <Info size={14} />}
        </button>
      </div>

      {open ? (
        <p
          id={panelId}
          className="mt-1.5 rounded-lg border border-line bg-raised/70 px-3 py-2.5 text-xs leading-relaxed text-muted"
        >
          {info}
        </p>
      ) : null}
    </div>
  );
}
