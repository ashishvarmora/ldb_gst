import type { ReactNode } from "react";

import { cx } from "@/components/ui";

/** Label + control + hint. Works in Server Components; no client JS needed. */
export function Field({
  label,
  name,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  name?: string;
  hint?: ReactNode;
  /**
   * Marks the label, nothing more - the input keeps its own `required`, which
   * is what the browser and the Server Action actually enforce. This is only
   * so a reader can see which boxes they cannot skip before they try to submit.
   */
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={name}>
        {label}
        {required ? (
          <span className="ml-0.5 text-bad-500" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {/* break-words, because a hint is not always prose: the delete-account
          form passes the account's own email as the hint to type back, and an
          address is one unbreakable token that would otherwise run past the
          edge of a max-w-md dialog on a phone. */}
      {hint ? <p className="field-hint break-words">{hint}</p> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} id={rest.id ?? rest.name} className={cx("field", className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      id={rest.id ?? rest.name}
      className={cx("field min-h-20 resize-y", className)}
    />
  );
}

export function Select({
  children,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} id={rest.id ?? rest.name} className={cx("field appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

/**
 * Checkbox with the label to the right. Hidden companion input makes an
 * unchecked box post "false" instead of nothing, so a Server Action can tell
 * "off" apart from "field absent".
 */
export function Checkbox({
  name,
  label,
  hint,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5 transition",
        disabled ? "cursor-not-allowed opacity-50" : "hover:border-line-strong",
      )}
    >
      <input type="hidden" name={name} value="false" />
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5 size-4 shrink-0 accent-[color:var(--color-brand-500)]"
      />
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Three-state control for override forms: inherit / on / off. */
export function TriState({
  name,
  label,
  hint,
  value,
  inheritedLabel,
}: {
  name: string;
  label: string;
  hint?: string;
  value: boolean | null;
  inheritedLabel: string;
}) {
  const current = value === null ? "inherit" : value ? "true" : "false";
  return (
    <div className="rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5">
      {/*
       * Wraps, and the select goes full width once it has. These sit inside a
       * max-w-md dialog, which leaves about 290px of content on a 360px phone:
       * a sentence-length label beside a fixed 160px control squeezed the
       * label to two or three words a line and left the control too narrow to
       * read its own options in.
       */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <span className="min-w-0 text-sm text-ink">{label}</span>
        {/* min-h-9: py-1 with text-xs is a 26px control, and this is the only
            thing on the row anyone taps. */}
        <Select
          name={name}
          defaultValue={current}
          className="min-h-9 w-full py-1 text-xs sm:w-40"
        >
          <option value="inherit">Inherit ({inheritedLabel})</option>
          <option value="true">Force on</option>
          <option value="false">Force off</option>
        </Select>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function FormGrid({
  children,
  cols = 2,
  className,
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3;
  className?: string;
}) {
  const grid = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[cols];
  return <div className={cx("grid grid-cols-1 gap-4", grid, className)}>{children}</div>;
}

export function FormActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-divider pt-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
