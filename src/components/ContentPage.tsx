import type { ReactNode } from "react";

import { cx } from "@/components/ui";

/**
 * The frame the written pages share - about, contact, support, and the three
 * legal ones.
 *
 * They exist because a visitor deciding whether to trust this with vehicle
 * movement data should be able to read who runs it, where the data comes from
 * and what happens to theirs, without signing in. So every one of these is a
 * public route: no session, no plan, no purchase. Signed-in readers reach the
 * same URLs and see the same words.
 *
 * One frame rather than six, because six hand-set headings drift - and on legal
 * pages a heading that is 15px here and 17px there reads as carelessness about
 * the thing the page is promising to be careful about.
 */
export function ContentPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro?: ReactNode;
  /** Shown on the legal pages, where "when did this last change" is the point. */
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="content-page mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8 sm:mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-strong sm:text-3xl">{title}</h1>
        {intro ? (
          <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">{intro}</p>
        ) : null}
        {updated ? (
          <p className="mt-4 text-xs text-faint">
            Last updated {updated}. We will say on this line whenever it changes.
          </p>
        ) : null}
      </header>

      <div className="space-y-8 sm:space-y-10">{children}</div>
    </div>
  );
}

/**
 * One numbered part of a written page.
 *
 * `id` is on every section so any clause can be linked to directly - which is
 * what somebody asking a question about a specific term actually needs, rather
 * than "see the terms page".
 */
export function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx("scroll-mt-20", className)}>
      <h2 className="text-base font-semibold text-strong sm:text-lg">
        <a href={`#${id}`} className="transition hover:text-brand-500">
          {title}
        </a>
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** A plain bulleted list in the body voice. */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="ml-4 list-disc space-y-2 marker:text-faint">
      {items.map((item, index) => (
        <li key={index} className="pl-1">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * The box that says "this matters more than the paragraph around it".
 *
 * Used sparingly and always for a limit rather than a promise: what the data
 * cannot be relied on for, what a reader must not do with it.
 */
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3.5 text-sm leading-relaxed",
        tone === "warn"
          ? "border-warn-500/40 bg-warn-500/10 text-warn-500"
          : "border-brand-500/30 bg-brand-500/8 text-ink",
      )}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}
