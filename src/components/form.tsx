import type { ReactNode } from "react";

import { cx } from "@/components/ui";

/** Label + control + hint. Works in Server Components; no client JS needed. */
export function Field({
  label,
  name,
  hint,
  children,
  className,
}: {
  label: string;
  name?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={name}>
        {label}
      </label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
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
        "flex cursor-pointer items-start gap-3 rounded-lg border border-ink-700/70 bg-ink-900/50 px-3 py-2.5 transition",
        disabled ? "cursor-not-allowed opacity-50" : "hover:border-ink-600",
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
        <span className="block text-sm text-ink-100">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-400">{hint}</span> : null}
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
    <div className="rounded-lg border border-ink-700/70 bg-ink-900/50 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-100">{label}</span>
        <Select name={name} defaultValue={current} className="w-40 py-1 text-xs">
          <option value="inherit">Inherit ({inheritedLabel})</option>
          <option value="true">Force on</option>
          <option value="false">Force off</option>
        </Select>
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
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
        "mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-ink-800 pt-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
