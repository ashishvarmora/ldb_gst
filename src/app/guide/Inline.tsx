import Link from "next/link";
import type { ReactNode } from "react";

import { Mono } from "@/components/ui";

/**
 * The whole of the guide's markup language: `[label](/href)` and `` `code` ``.
 *
 * Its own file because both ./Blocks.tsx and ./Figures.tsx render author
 * strings - a figure's caption may carry a link like any paragraph - and
 * Blocks already imports Figures. Putting this in Blocks would make the two
 * import each other, which works in ES modules right up until somebody moves
 * a constant to the top of a file and it does not.
 *
 * Deliberately not markdown. A parser is weight on a public page an officer
 * loads on a 3G connection, and these are the only two forms the manual has
 * ever needed. Everything else is a block in ./Blocks.tsx, where it is styled
 * once.
 */

/*
 * One pass, both forms.
 *
 * The href excludes ")" and whitespace rather than matching everything up to
 * the first ")", so "[see this](/pricing) (it is cheap)" does not swallow the
 * parenthetical. Labels take anything but "]".
 */
const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

const LINK_CLASS =
  "font-medium text-brand-500 underline decoration-brand-500/30 underline-offset-2 transition hover:decoration-brand-500";

/**
 * An author's string, with its links and code rendered and everything else
 * left as plain text.
 *
 * Anything that is not one of the two forms comes through verbatim, so a stray
 * bracket in the content files is a proofreading problem rather than an
 * outage.
 */
export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > at) out.push(text.slice(at, start));

    const [whole, label, href, code] = match;

    if (code !== undefined) {
      out.push(
        <Mono key={key++} className="rounded bg-sunken px-1 py-0.5 text-[12px] text-ink">
          {code}
        </Mono>,
      );
    } else if (href !== undefined && label !== undefined) {
      out.push(<InlineLink key={key++} href={href} label={label} />);
    }

    at = start + whole.length;
  }

  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * Internal links go through next/link so the app is not reloaded from
 * scratch; everything else is a plain anchor, and an external one opens away
 * from the guide rather than replacing the page somebody is halfway through.
 */
function InlineLink({ href, label }: { href: string; label: string }) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={LINK_CLASS}>
        {label}
      </Link>
    );
  }
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className={LINK_CLASS}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      {label}
    </a>
  );
}
