import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { Tbody, TableWrap, Thead, Tr, buttonClass, cx } from "@/components/ui";

import { Figure } from "./Figures";
import { Inline } from "./Inline";
import { faqId, headingId } from "./lib";
import type { GuideBlock } from "./content/types";

export { Inline };

/**
 * The renderer. Every article on the site is this switch and nothing else.
 *
 * A Server Component, and it stays one: an officer on a 3G connection should
 * get the whole manual as HTML with no JavaScript to download first. The two
 * things that would normally force a client bundle - the accordions and the
 * contents list - are native <details> and plain anchors, so there is nothing
 * to hydrate on an article page at all.
 *
 * NO MARKDOWN. Two inline forms, listed in ./content/types.ts, and headings,
 * steps, bullets, notes, tables, figures and calls to action as blocks. That
 * is not minimalism for its own sake: a block is styled once here, so a table
 * on the credits article cannot be a different table from the one on the plans
 * article, and no author can accidentally ship a wall of prose by writing four
 * paragraphs in one string.
 */

/* -------------------------------------------------------------------------- */
/* blocks                                                                      */
/* -------------------------------------------------------------------------- */

const NOTE_TONES = {
  info: {
    box: "border-brand-500/30 bg-brand-500/8",
    title: "text-brand-500",
  },
  warn: {
    box: "border-warn-500/40 bg-warn-500/10",
    title: "text-warn-500",
  },
  good: {
    box: "border-good-500/40 bg-good-500/10",
    title: "text-good-500",
  },
} as const;

export function Blocks({ blocks }: { blocks: GuideBlock[] }) {
  /* Counted here rather than by index in the array, so the anchors match
     headingsOf() in ./lib.ts - the contents list is built from that, and an
     off-by-one between the two is a contents list that scrolls nowhere. */
  let headingSeen = 0;

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "h": {
            const id = headingId(block.text, headingSeen);
            headingSeen += 1;
            return (
              <h2
                key={index}
                id={id}
                className="scroll-mt-20 pt-3 text-base font-semibold text-strong sm:text-lg"
              >
                {block.text}
              </h2>
            );
          }

          case "p":
            return (
              <p key={index} className="text-sm leading-relaxed text-muted">
                <Inline text={block.text} />
              </p>
            );

          case "steps":
            return (
              <ol key={index} className="space-y-2.5">
                {block.items.map((item, n) => (
                  <li key={n} className="flex gap-3">
                    <span className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/12 text-[11px] font-semibold text-brand-500">
                      {n + 1}
                    </span>
                    <span className="min-w-0 text-sm leading-relaxed text-muted">
                      <Inline text={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );

          case "bullets":
            return (
              <ul key={index} className="ml-4 list-disc space-y-1.5 marker:text-faint">
                {block.items.map((item, n) => (
                  <li key={n} className="pl-1 text-sm leading-relaxed text-muted">
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );

          case "note": {
            const tone = NOTE_TONES[block.tone];
            return (
              <div
                key={index}
                className={cx("rounded-xl border px-4 py-3.5 text-sm leading-relaxed", tone.box)}
              >
                {block.title ? (
                  <p className={cx("mb-1 font-semibold", tone.title)}>{block.title}</p>
                ) : null}
                <p className="text-ink">
                  <Inline text={block.text} />
                </p>
              </div>
            );
          }

          case "figure":
            return <Figure key={index} name={block.name} caption={block.caption} />;

          case "table":
            return (
              /* Its own scroller. A five-column table at 390px is wider than
                 the phone, and the one thing that must never happen is the
                 PAGE scrolling sideways - the reader loses the left edge of
                 every paragraph to find the last column of one table. */
              <div key={index} className="panel overflow-hidden">
                <TableWrap>
                  <Thead>
                    {block.head.map((cell, n) => (
                      <th key={n} className="th whitespace-nowrap">
                        {cell}
                      </th>
                    ))}
                  </Thead>
                  <Tbody>
                    {block.rows.map((row, n) => (
                      <Tr key={n}>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className={cx(
                              "td align-top",
                              c === 0 && "font-medium whitespace-nowrap text-strong",
                            )}
                          >
                            <Inline text={cell} />
                          </td>
                        ))}
                      </Tr>
                    ))}
                  </Tbody>
                </TableWrap>
              </div>
            );

          case "cta":
            return (
              <div key={index} className="rounded-xl border border-line bg-raised/50 px-4 py-3.5">
                {block.hint ? (
                  <p className="mb-2.5 text-sm leading-relaxed text-muted">
                    <Inline text={block.hint} />
                  </p>
                ) : null}
                {block.href.startsWith("/") ? (
                  <Link href={block.href} className={buttonClass("primary", "md")}>
                    {block.label}
                  </Link>
                ) : (
                  <a
                    href={block.href}
                    className={buttonClass("primary", "md")}
                    {...(block.href.startsWith("http")
                      ? { target: "_blank", rel: "noreferrer noopener" }
                      : {})}
                  >
                    {block.label}
                  </a>
                )}
              </div>
            );
        }
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* questions                                                                   */
/* -------------------------------------------------------------------------- */

export type FaqItem = {
  q: string;
  a: string;
  /** Set when the question came from an article, so it can be credited. */
  from?: { title: string; href: string };
};

/**
 * A list of questions as native <details>, shared by all three pages that
 * show them.
 *
 * Native rather than React state, and that is the whole point: it costs no
 * JavaScript, the browser's own find-in-page can open a shut one, and it works
 * on a phone that has rendered the HTML but not yet hydrated anything. Twelve
 * questions is twelve taps of nothing to download.
 *
 * Each one carries an id worked out from the question, so "most asked" on the
 * hub and a search result can link straight to it. A fragment scrolls the
 * accordion into view but does not open it - no browser will open a closed
 * <details> for an anchor, and faking it needs the client JavaScript this is
 * here to avoid. Landing on your own question with one tap left is an
 * acceptable price; landing three screens above it is not.
 */
export function Faqs({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <details
          key={item.q}
          id={faqId(item.q)}
          className="panel group scroll-mt-20 overflow-hidden"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 transition hover:bg-raised/70 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 text-sm leading-snug font-medium text-ink">
              {item.q}
            </span>
            <ChevronDown
              size={16}
              aria-hidden
              className="shrink-0 text-faint transition group-open:rotate-180"
            />
          </summary>
          <div className="border-t border-divider px-3.5 py-3">
            <p className="text-sm leading-relaxed text-muted">
              <Inline text={item.a} />
            </p>
            {item.from ? (
              <p className="mt-2 text-xs">
                <Link
                  href={item.from.href}
                  className="font-medium text-brand-500 hover:underline"
                >
                  More in “{item.from.title}”
                </Link>
              </p>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* breadcrumb                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Guide / Subject / (this page).
 *
 * Every page below the hub wears one, because the thing a reader most often
 * wants after an answer is the shelf it came off - and on a phone the browser's
 * back button is the only other way there, which is no use to somebody who
 * arrived from a link support sent them.
 */
export function Crumbs({ trail }: { trail: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-faint">
        {trail.map((crumb, index) => (
          <li key={crumb.label} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden>/</span> : null}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="inline-flex min-h-10 items-center rounded transition hover:text-brand-500"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="inline-flex min-h-10 items-center text-muted">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
