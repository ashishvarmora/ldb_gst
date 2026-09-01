import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

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
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6 sm:gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-strong sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  id,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  /** Anchor, for a link that has to land on this panel rather than the page. */
  id?: string;
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={cx("panel overflow-hidden", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx(bodyClassName ?? "p-4 sm:p-5")}>{children}</div>
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
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                      */
/* -------------------------------------------------------------------------- */

const BADGE_TONES = {
  neutral: "border-line-strong bg-sunken text-muted",
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
    neutral: "bg-faint",
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
    "bg-brand-500 text-on-brand hover:bg-brand-600 focus-visible:ring-brand-500/40 border-transparent",
  secondary:
    "bg-panel text-ink hover:bg-sunken focus-visible:ring-brand-500/30 border-line",
  ghost: "bg-transparent text-muted hover:bg-sunken hover:text-ink border-transparent",
  danger: "bg-bad-500/10 text-bad-500 hover:bg-bad-500/18 border-bad-500/35",
} as const;

/* Comfortable tap targets: 36px at sm, 40px at md, both above the 32px floor
   that makes a control fiddly on a phone. */
const BUTTON_SIZES = {
  sm: "min-h-9 px-3 py-1.5 text-xs gap-1.5",
  md: "min-h-10 px-4 py-2 text-sm gap-2",
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
    <thead className="border-b border-line/70 bg-raised/60">
      <tr>{children}</tr>
    </thead>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-divider">{children}</tbody>;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx("transition hover:bg-raised/50", className)}>{children}</tr>;
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
    neutral: "text-ink",
    brand: "text-brand-400",
    good: "text-good-500",
    warn: "text-warn-500",
    bad: "text-bad-500",
  }[tone];

  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</p>
        {icon ? <span className="text-faint">{icon}</span> : null}
      </div>
      <p className={cx("mt-2 text-2xl font-semibold tabular-nums", accent)}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
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
        {label ? <span className="text-muted">{label}</span> : null}
        <span className="font-medium tabular-nums text-ink">
          {used.toLocaleString("en-IN")}
          <span className="text-faint"> / {unlimited ? "∞" : limit.toLocaleString("en-IN")}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
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

/**
 * The small "View all" link in a panel header. As plain text it renders about
 * 16px tall, which is far too small to hit on a phone; the padding brings it to
 * a real tap target without making it look like a button.
 */
export function PanelAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-mr-2 inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-brand-500 transition hover:bg-brand-500/8 hover:text-brand-600"
    >
      {children}
    </Link>
  );
}

/**
 * A tappable card that sends the reader somewhere else.
 *
 * The workhorse of the consolidation: wherever a screen used to embed a second
 * copy of a list it does not own, it now names that list, says what is in it,
 * and links to the one place it lives. A count on the card is what makes the
 * link worth following - "Alerts sent · 1,204, 3 undelivered" answers the
 * glance, and the list answers the follow-up.
 */
export function LinkCard({
  href,
  icon,
  title,
  description,
  value,
  tone = "neutral",
}: {
  href: string;
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** The figure worth seeing without following the link. */
  value?: ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <Link
      href={href}
      className={cx(
        "flex items-center gap-3 rounded-xl border px-4 py-3.5 transition",
        tone === "warn"
          ? "border-warn-500/40 bg-warn-500/8 hover:border-warn-500/70"
          : "border-line bg-panel hover:border-brand-500/50 hover:bg-sunken",
      )}
    >
      {icon ? (
        <span
          className={cx(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border",
            tone === "warn"
              ? "border-warn-500/30 bg-warn-500/12 text-warn-500"
              : "border-brand-500/30 bg-brand-500/12 text-brand-500",
          )}
        >
          {icon}
        </span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>
        ) : null}
      </span>

      {value !== undefined ? (
        <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-strong">
          {value}
        </span>
      ) : null}

      <ChevronRight size={16} className="shrink-0 text-faint" />
    </Link>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[13px] tracking-tight", className)}>{children}</span>;
}

export function DescRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-divider py-2 last:border-0">
      <dt className="shrink-0 text-xs tracking-wide text-muted uppercase">{label}</dt>
      <dd className="text-right text-sm text-ink">{children}</dd>
    </div>
  );
}
