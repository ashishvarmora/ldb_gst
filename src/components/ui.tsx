import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("panel overflow-hidden", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-700/70 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-ink-400">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx(bodyClassName ?? "p-5")}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {description ? <p className="max-w-md text-sm text-ink-400">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                      */
/* -------------------------------------------------------------------------- */

const BADGE_TONES = {
  neutral: "border-ink-600 bg-ink-800 text-ink-300",
  brand: "border-brand-500/40 bg-brand-500/12 text-brand-400",
  good: "border-good-500/40 bg-good-500/12 text-good-500",
  warn: "border-warn-500/40 bg-warn-500/12 text-warn-500",
  bad: "border-bad-500/40 bg-bad-500/12 text-bad-500",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: BadgeTone }) {
  const colour = {
    neutral: "bg-ink-400",
    brand: "bg-brand-400",
    good: "bg-good-500",
    warn: "bg-warn-500",
    bad: "bg-bad-500",
  }[tone];
  return <span className={cx("inline-block size-1.5 rounded-full", colour)} />;
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

const BUTTON_VARIANTS = {
  primary:
    "bg-brand-500 text-white hover:bg-brand-400 focus-visible:ring-brand-500/40 border-transparent",
  secondary:
    "bg-ink-800 text-ink-100 hover:bg-ink-700 focus-visible:ring-ink-500/40 border-ink-700",
  ghost: "bg-transparent text-ink-300 hover:bg-ink-800 hover:text-ink-100 border-transparent",
  danger: "bg-bad-500/15 text-bad-500 hover:bg-bad-500/25 border-bad-500/40",
} as const;

const BUTTON_SIZES = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5",
  md: "px-3.5 py-2 text-sm gap-2",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: keyof typeof BUTTON_SIZES = "md",
  className?: string,
): string {
  return cx(
    "inline-flex items-center justify-center rounded-lg border font-medium transition",
    "focus-visible:ring-2 focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full border-collapse">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-ink-700/70 bg-ink-850/60">
      <tr>{children}</tr>
    </thead>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-ink-800">{children}</tbody>;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx("transition hover:bg-ink-850/50", className)}>{children}</tr>;
}

/* -------------------------------------------------------------------------- */
/* Stat cards                                                                  */
/* -------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
}) {
  const accent = {
    neutral: "text-ink-200",
    brand: "text-brand-400",
    good: "text-good-500",
    warn: "text-warn-500",
    bad: "text-bad-500",
  }[tone];

  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{label}</p>
        {icon ? <span className="text-ink-500">{icon}</span> : null}
      </div>
      <p className={cx("mt-2 text-2xl font-semibold tabular-nums", accent)}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-ink-400">{sub}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quota bar                                                                   */
/* -------------------------------------------------------------------------- */

export function QuotaBar({
  used,
  limit,
  label,
}: {
  used: number;
  limit: number;
  label?: string;
}) {
  const unlimited = limit === -1;
  const ratio = unlimited ? 0 : limit <= 0 ? (used > 0 ? 1 : 0) : Math.min(used / limit, 1);
  const tone = unlimited ? "good" : ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "brand";
  const barColour = { brand: "bg-brand-500", good: "bg-good-500", warn: "bg-warn-500", bad: "bg-bad-500" }[
    tone as "brand" | "good" | "warn" | "bad"
  ];

  return (
    <div className="min-w-28">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        {label ? <span className="text-ink-400">{label}</span> : null}
        <span className="font-medium tabular-nums text-ink-200">
          {used.toLocaleString("en-IN")}
          <span className="text-ink-500"> / {unlimited ? "∞" : limit.toLocaleString("en-IN")}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className={cx("h-full rounded-full transition-all", barColour)}
          style={{ width: unlimited ? "100%" : `${Math.max(ratio * 100, used > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function Avatar({ text, size = "md" }: { text: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/12 font-semibold text-brand-400",
        size === "sm" ? "size-7 text-[11px]" : "size-9 text-xs",
      )}
    >
      {text}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[13px] tracking-tight", className)}>{children}</span>;
}

export function DescRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-800 py-2 last:border-0">
      <dt className="shrink-0 text-xs tracking-wide text-ink-400 uppercase">{label}</dt>
      <dd className="text-right text-sm text-ink-100">{children}</dd>
    </div>
  );
}
