import Link from "next/link";
import type { ReactNode } from "react";

import { InfoTip } from "@/components/InfoTip";
import { cx } from "@/components/ui";

/**
 * Shared server pieces of the three account history pages (Payments, Credits,
 * Activity), styled in screens-polish.css under "Account history pages".
 * Same shapes as My trucks / Notifications: a one-line summary, a segmented
 * filter, compact rows with status at a glance.
 */

/** A segmented control made of links, so the choice lives in the URL. */
export function Segmented({
  label,
  items,
  current,
}: {
  label: string;
  items: { key: string; label: string; href: string; count?: number | null; tone?: "bad" | "warn" }[];
  current: string;
}) {
  return (
    <nav className="hist-seg" aria-label={label} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={false}
          aria-current={item.key === current ? "page" : undefined}
          className={cx(item.key === current && "is-active")}
        >
          <span className="hist-seg-label">{item.label}</span>
          {item.count ? (
            <span className={cx("hist-seg-count", item.tone && `is-${item.tone}`)}>{item.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The one-line summary under a page title: figures separated by dots, the
 * period after them in a muted piece of its own, the explanation behind an (i).
 *
 * The dot belongs to the piece BEFORE it (trailing) and no piece wraps inside
 * itself, so a line can never START with a separator - on a phone "· All
 * time" used to begin the second line. The period has no dot at all; pass
 * null when it is the page's all-time default.
 */
export function SummaryLine({
  parts,
  period,
  info,
  infoLabel,
}: {
  parts: ReactNode[];
  period?: ReactNode;
  info?: ReactNode;
  infoLabel?: string;
}) {
  const shown = parts.filter(Boolean);
  const line = (
    <p className="hist-summary-line">
      {shown.map((part, index) => (
        <span key={index} className="hist-summary-part">
          {part}
          {index < shown.length - 1 ? (
            <span aria-hidden className="hist-dot">
              ·
            </span>
          ) : null}
        </span>
      ))}
      {period ? <span className="hist-summary-range">{period}</span> : null}
    </p>
  );
  if (!info) return <div className="hist-summary">{line}</div>;
  return (
    <InfoTip label={infoLabel ?? "these figures"} info={info} className="hist-summary" rowClassName="hist-summary-row">
      {line}
    </InfoTip>
  );
}

/**
 * Previous / Next for a list INSIDE an open row (Activity's groups). Unlike
 * the page Pager it keeps the scroll position, so the open row stays put.
 */
export function MiniPager({
  page,
  total,
  pageSize,
  noun,
  href,
}: {
  page: number;
  total: number;
  pageSize: number;
  noun: string;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const step = (to: number, label: string, enabled: boolean) =>
    enabled ? (
      <Link href={href(to)} scroll={false} className="hist-minipager-step">
        {label}
      </Link>
    ) : (
      <span aria-disabled className="hist-minipager-step is-off">
        {label}
      </span>
    );
  return (
    <nav className="hist-minipager" aria-label={`More ${noun}`}>
      {step(page - 1, "Previous", page > 1)}
      <span className="hist-minipager-count">
        {first.toLocaleString("en-IN")}–{last.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} {noun}
      </span>
      {step(page + 1, "Next", page < pages)}
    </nav>
  );
}

/** Small "N unit" figure with the unit after the number. */
export function Figure({ value, unit, tone }: { value: string; unit?: string; tone?: "bad" | "warn" | "good" | "brand" }) {
  return (
    <>
      <strong className={cx("hist-figure", tone && `is-${tone}`)}>{value}</strong>
      {unit ? ` ${unit}` : null}
    </>
  );
}

/** "1 check" / "3 checks". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-IN")} ${count === 1 ? one : many}`;
}
