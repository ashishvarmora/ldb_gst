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
 * explanation behind an (i).
 */
export function SummaryLine({
  parts,
  info,
  infoLabel,
}: {
  parts: ReactNode[];
  info?: ReactNode;
  infoLabel?: string;
}) {
  const line = (
    <p className="hist-summary-line">
      {parts.filter(Boolean).map((part, index) => (
        <span key={index}>{part}</span>
      ))}
    </p>
  );
  if (!info) return <div className="hist-summary">{line}</div>;
  return (
    <InfoTip label={infoLabel ?? "these figures"} info={info} className="hist-summary" rowClassName="hist-summary-row">
      {line}
    </InfoTip>
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
