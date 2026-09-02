import Link from "next/link";
import { CreditCard, History, Minus, Plus, ReceiptText } from "lucide-react";

import { LinkPending } from "@/components/NavPending";
import type { LedgerQuery } from "@/components/CreditLedger";
import { cx } from "@/components/ui";

/**
 * The two ways into one statement, and the way back out to its neighbours.
 *
 * Credit history and activity are one ledger read from two ends, and this file
 * is what stops them reading as two reports that happen to share a database.
 * Both pieces are plain links on the server, so a side is bookmarkable, the
 * back button steps through it, and neither page needs a byte of client state
 * to remember which half somebody was looking at.
 */

export type LedgerSide = "added" | "used";

/**
 * Which half is open.
 *
 * Added is the default because it is the half that exists nowhere else: the
 * spending is analysed truck by truck and charge by charge on the activity
 * page, but a top-up, a coupon and an administrator's correction are only ever
 * shown here. Somebody who arrives asking "did my payment land" is the reader
 * this page was added for.
 */
export function parseSide(raw: string | undefined): LedgerSide {
  return raw === "used" ? "used" : "added";
}

const SIDES = [
  {
    key: "added",
    label: "Credits added",
    icon: Plus,
    /* Grants have no truck and are individually meaningful, so the added side
       is the raw ledger. Nothing about a purchase is clearer for being folded
       into a day with a coupon. */
    hint: "Bought, given and free",
  },
  {
    key: "used",
    label: "Credits used",
    icon: Minus,
    hint: "What each day cost",
  },
] as const satisfies readonly { key: LedgerSide; label: string; icon: typeof Plus; hint: string }[];

/**
 * A segmented control, not tabs along a rule.
 *
 * Two options and no third ever coming, so the pair can take the full width and
 * give each half a 185px target on a 390px phone - where the account page's
 * five-tab strip has to scroll sideways. Each half also prints what is BEHIND
 * it, so the half nobody is looking at is still worth a tap; the shape of the
 * rows is the panel's own job, one line further down, and saying it in both
 * places put the same six words twice within 100px of each other.
 *
 * THE WINDOW SURVIVES THE SWITCH and the reason filter does not. A date range
 * means the same thing on both sides and is usually the reason somebody is
 * here at all - "show me August" outlives a change of half. A reason does not:
 * the spending reasons and the granting ones are disjoint sets, so carrying
 * "manual search" across would land the reader on an empty ledger under a
 * filter they did not set. The ledger already refuses that combination when it
 * arrives in a URL; this refuses to build the URL.
 *
 * The truck and the page number go for the same reason - a grant has no truck,
 * and page four of one list is not page four of the other.
 */
export function SideTabs({
  current,
  query,
}: {
  current: LedgerSide;
  query: Pick<LedgerQuery, "from" | "to" | "sort">;
}) {
  return (
    <nav
      aria-label="Credit history"
      className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-raised p-1"
    >
      {SIDES.map(({ key, label, icon: Icon, hint }) => {
        const active = key === current;

        const params = new URLSearchParams();
        // Added is the default, so it is the side with no parameter - which
        // keeps the commonest URL the shortest and makes /portal/credits itself
        // a link somebody can type.
        if (key === "used") params.set("side", "used");
        for (const [name, value] of [
          ["from", query.from],
          ["to", query.to],
          ["sort", query.sort],
        ] as const) {
          if (value) params.set(name, value);
        }
        const qs = params.toString();

        return (
          <Link
            key={key}
            href={qs ? `/portal/credits?${qs}` : "/portal/credits"}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-11 flex-col items-center justify-center rounded-lg px-2 py-1 text-center transition",
              active
                ? "bg-panel [box-shadow:var(--shadow-pop)]"
                : "text-muted hover:bg-panel/60 hover:text-ink",
            )}
          >
            <span
              className={cx(
                "flex items-center gap-1.5 text-xs font-semibold",
                active ? "text-brand-500" : "",
              )}
            >
              <LinkPending size={13}>
                <Icon size={13} className="shrink-0" />
              </LinkPending>
              {label}
            </span>
            {/* The shape of the rows behind the tab, so the difference between
                the two halves is visible before either is opened. */}
            <span className="mt-0.5 text-[10px] leading-tight text-faint">{hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The three pages that answer one question between them, each naming the other
 * two.
 *
 * The owner's rule is that nothing is mirrored, which means every one of these
 * pages is missing two thirds of what a reader might have come for: the
 * statement has no per-truck breakdown, the activity page has no grants, and
 * neither has a rupee on it. A reader who cannot see the other two from where
 * they are standing does not conclude the data is elsewhere - they conclude it
 * is gone. So the split costs one row of links on each page, which is cheaper
 * than the duplication it replaces.
 *
 * Labels match what the sidebar calls each page, so following a link and then
 * looking for it in the navigation finds the same word twice.
 */
/** The three money-history pages, each named by the question it answers. */
export type LedgerSibling = "credits" | "activity" | "payments";

const SIBLINGS = [
  {
    key: "credits",
    href: "/portal/credits",
    label: "Credit history",
    hint: "every credit in",
    icon: ReceiptText,
  },
  {
    key: "activity",
    href: "/portal/activity",
    label: "Activity",
    hint: "every charge",
    icon: History,
  },
  {
    key: "payments",
    href: "/portal/payments",
    label: "Payments",
    hint: "money paid",
    icon: CreditCard,
  },
] as const;

export function LedgerLinks({ current }: { current: LedgerSibling }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SIBLINGS.filter((item) => item.key !== current).map(
        ({ href, label, hint, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-xs text-muted transition hover:border-brand-500/50 hover:text-ink"
          >
            <LinkPending size={13}>
              <Icon size={13} className="shrink-0 text-faint" />
            </LinkPending>
            <span className="font-medium">{label}</span>
            {/* Off on a phone, where two pills with their glosses would wrap to
                two lines above the fold. The label alone is enough to follow;
                the gloss is what makes it worth following on a desktop, where
                the row has the width to spare. */}
            <span className="hidden text-faint sm:inline">· {hint}</span>
          </Link>
        ),
      )}
    </div>
  );
}
