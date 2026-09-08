import {
  BellRing,
  CircleAlert,
  CreditCard,
  Gift,
  LifeBuoy,
  ReceiptIndianRupee,
  Truck,
  UserCog,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ARTICLES } from "./content/articles";
import { FAQS } from "./content/faqs";
import type { GuideArticle, GuideBlock, GuideCategoryId, GuideFaq } from "./content/types";

/**
 * The index of the help centre: the nine shelves, and the lookups every page
 * of it does.
 *
 * PURE ON PURPOSE. Nothing here touches the database, the session or
 * `next/headers`. It is imported by server pages and its SEARCH_INDEX is
 * handed to a browser component, so the moment this file reaches for the
 * admin client the search box stops building. Live figures - prices, credit
 * rates, the no-movement window - are loaded in ./Figures.tsx, where the
 * thing that needs them lives.
 */

export type GuideCategory = {
  id: GuideCategoryId;
  title: string;
  blurb: string;
  icon: LucideIcon;
};

/**
 * The shelves, in the order an officer meets them.
 *
 * Titled in the words the reader would use, not ours: "Problems and fixes"
 * rather than "Troubleshooting", "Money in and out" rather than "Billing".
 * The order is the journey - sign up, add a lorry, get told, understand the
 * bill - so somebody reading the hub top to bottom is being taught the
 * product in sequence without being told they are.
 */
export const CATEGORIES: GuideCategory[] = [
  {
    id: "start",
    title: "Getting started",
    blurb: "Open an account, take the trial, and watch your first lorry.",
    icon: LifeBuoy,
  },
  {
    id: "trucks",
    title: "Lorries and tracking",
    blurb: "Search a number, add a lorry, and read what the crossings mean.",
    icon: Truck,
  },
  {
    id: "alerts",
    title: "Alerts and Telegram",
    blurb: "Get told on your phone when something happens, and prove it works.",
    icon: BellRing,
  },
  {
    id: "credits",
    title: "Credits and what they cost",
    blurb: "What spends a credit, how fast, and where the money goes.",
    icon: Wallet,
  },
  {
    id: "plans",
    title: "Plans and the free trial",
    blurb: "How many lorries, until when, and what happens when a plan ends.",
    icon: ReceiptIndianRupee,
  },
  {
    id: "payments",
    title: "Payments and invoices",
    blurb: "Paying, topping up, failed payments and getting a receipt.",
    icon: CreditCard,
  },
  {
    id: "rewards",
    title: "Invite and earn",
    blurb: "Share your link, and what you and your friend each receive.",
    icon: Gift,
  },
  {
    id: "account",
    title: "Your account",
    blurb: "Email, password, phone number, groups and signing out.",
    icon: UserCog,
  },
  {
    id: "trouble",
    title: "Problems and fixes",
    blurb: "Nothing found, a silent phone, a lorry that paused itself.",
    icon: CircleAlert,
  },
];

const CATEGORY_BY_ID = new Map<GuideCategoryId, GuideCategory>(
  CATEGORIES.map((category) => [category.id, category]),
);

/** Is this URL segment one of the nine? Guards the category route. */
export function isCategoryId(value: string): value is GuideCategoryId {
  return CATEGORY_BY_ID.has(value as GuideCategoryId);
}

export function categoryById(id: GuideCategoryId): GuideCategory | undefined {
  return CATEGORY_BY_ID.get(id);
}

/**
 * A category's articles, in the order they were written.
 *
 * Authoring order IS reading order - the prev/next links and "start in this
 * order" both lean on it - so nothing is sorted here. An author who wants an
 * article earlier moves it up the array.
 */
export function articlesIn(category: GuideCategoryId): GuideArticle[] {
  return ARTICLES.filter((article) => article.category === category);
}

export function articleBySlug(slug: string): GuideArticle | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

/** The shelf an article sits on, for a breadcrumb that needs its title. */
export function categoryOf(slug: string): GuideCategory | undefined {
  const article = articleBySlug(slug);
  return article ? CATEGORY_BY_ID.get(article.category) : undefined;
}

export function faqsIn(category: GuideCategoryId): GuideFaq[] {
  return FAQS.filter((faq) => faq.category === category);
}

export function articleHref(article: Pick<GuideArticle, "category" | "slug">): string {
  return `/guide/${article.category}/${article.slug}`;
}

/** The article before and after this one on its own shelf, for the page foot. */
export function neighbours(slug: string): {
  prev: GuideArticle | null;
  next: GuideArticle | null;
} {
  const article = articleBySlug(slug);
  if (!article) return { prev: null, next: null };
  const siblings = articlesIn(article.category);
  const at = siblings.findIndex((candidate) => candidate.slug === slug);
  return {
    prev: at > 0 ? siblings[at - 1] : null,
    next: at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null,
  };
}

/** Up to `limit` other articles on the same shelf. */
export function relatedTo(slug: string, limit = 3): GuideArticle[] {
  const article = articleBySlug(slug);
  if (!article) return [];
  return articlesIn(article.category)
    .filter((candidate) => candidate.slug !== slug)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* headings, for the contents lists                                            */
/* -------------------------------------------------------------------------- */

/**
 * An anchor for a heading, worked out from its words.
 *
 * Both the contents list and the heading itself call this, so they cannot
 * drift. A heading that reduces to nothing - punctuation only - falls back to
 * its position, because an empty id is a link to the top of the page.
 */
export function headingId(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `part-${index + 1}`;
}

/** The `h` blocks of an article, in order, with the anchors they will carry. */
export function headingsOf(blocks: GuideBlock[]): { id: string; text: string }[] {
  const headings: { id: string; text: string }[] = [];
  blocks.forEach((block) => {
    if (block.kind !== "h") return;
    headings.push({ id: headingId(block.text, headings.length), text: block.text });
  });
  return headings;
}

/* -------------------------------------------------------------------------- */
/* the paths through the hub                                                   */
/* -------------------------------------------------------------------------- */

/**
 * "New here? Start in this order."
 *
 * Derived rather than listed, so it cannot name an article that has been
 * renamed or not written yet. The getting-started shelf in its own order is
 * the answer to "how do I run this from zero"; five is as many numbered steps
 * as fit on a phone screen without becoming a wall.
 */
export function startHere(limit = 5): GuideArticle[] {
  const start = articlesIn("start").slice(0, limit);
  if (start.length >= limit) return start;
  /* A thin start shelf borrows from the two that always matter next, so the
     path is never one lonely link. */
  const filler = [...articlesIn("trucks"), ...articlesIn("alerts")].filter(
    (article) => !start.includes(article),
  );
  return [...start, ...filler].slice(0, limit);
}

export type MostAsked =
  | { kind: "article"; title: string; href: string; note: string }
  | { kind: "faq"; title: string; href: string; note: string };

/**
 * "Most asked", built from the shelves rather than from a hand-kept list.
 *
 * A hand-kept list of slugs is a broken link waiting for the first rename, and
 * this page has to survive content being rewritten by somebody else. So it
 * takes the first article off each shelf where the expensive misunderstandings
 * live, in the order support actually gets asked, and tops up with standalone
 * FAQs from the same shelves.
 */
const MOST_ASKED_ORDER: GuideCategoryId[] = [
  "credits",
  "alerts",
  "trouble",
  "plans",
  "payments",
  "trucks",
];

export function mostAsked(limit = 6): MostAsked[] {
  const out: MostAsked[] = [];

  for (const id of MOST_ASKED_ORDER) {
    const article = articlesIn(id)[0];
    const category = CATEGORY_BY_ID.get(id);
    if (!article || !category) continue;
    out.push({
      kind: "article",
      title: article.title,
      href: articleHref(article),
      note: category.title,
    });
    if (out.length >= limit) return out;
  }

  for (const id of MOST_ASKED_ORDER) {
    const category = CATEGORY_BY_ID.get(id);
    for (const faq of faqsIn(id)) {
      if (!category) continue;
      out.push({
        kind: "faq",
        title: faq.q,
        href: `/guide/${id}#${faqId(faq.q)}`,
        note: category.title,
      });
      if (out.length >= limit) return out;
    }
  }

  return out;
}

/** An anchor for one question, so "most asked" can land on it. */
export function faqId(question: string): string {
  return `faq-${headingId(question, 0)}`;
}

/* -------------------------------------------------------------------------- */
/* search                                                                      */
/* -------------------------------------------------------------------------- */

export type SearchEntry = {
  kind: "article" | "faq";
  title: string;
  summary: string;
  href: string;
  category: GuideCategoryId;
  keywords: string[];
};

/**
 * Everything findable, flat and serialisable.
 *
 * Flat because it is handed to a browser component and filtered there: an
 * officer typing "telegram" gets an answer with no round trip, which on a slow
 * connection is the difference between a search box and a search box nobody
 * uses. Serialisable because it crosses the server/client boundary - strings
 * and string arrays only, no icons, no functions, no blocks.
 *
 * The blocks are deliberately NOT in here. Indexing the body of every article
 * would multiply the payload by ten for matches an officer cannot see the
 * context of anyway; title, summary and the author's own keywords are what
 * they type.
 */
export const SEARCH_INDEX: SearchEntry[] = [
  ...ARTICLES.map(
    (article): SearchEntry => ({
      kind: "article",
      title: article.title,
      summary: article.summary,
      href: articleHref(article),
      category: article.category,
      keywords: article.keywords,
    }),
  ),
  /* An article's own FAQs are findable too, and they point at the article that
     answers them rather than at the FAQ page - the surrounding article is
     usually the thing the reader actually needed. */
  ...ARTICLES.flatMap((article) =>
    (article.faqs ?? []).map(
      (faq): SearchEntry => ({
        kind: "faq",
        title: faq.q,
        summary: faq.a,
        href: `${articleHref(article)}#${faqId(faq.q)}`,
        category: article.category,
        keywords: article.keywords,
      }),
    ),
  ),
  ...FAQS.map(
    (faq): SearchEntry => ({
      kind: "faq",
      title: faq.q,
      summary: faq.a,
      href: `/guide/${faq.category}#${faqId(faq.q)}`,
      category: faq.category,
      keywords: faq.keywords ?? [],
    }),
  ),
];

/**
 * Every FAQ on the platform, grouped for /guide/faq.
 *
 * Standalone questions and the ones hanging off articles, together: a reader
 * who lands on the FAQ page from a link somebody sent them should not have to
 * know that half the answers were filed under an article. The ones that were
 * carry a link back to it.
 */
export type GroupedFaq = {
  q: string;
  a: string;
  /** Set when this question came from an article, so it can be credited. */
  from?: { title: string; href: string };
};

export function faqsByCategory(): { category: GuideCategory; faqs: GroupedFaq[] }[] {
  return CATEGORIES.map((category) => {
    const own: GroupedFaq[] = faqsIn(category.id).map((faq) => ({ q: faq.q, a: faq.a }));
    const borrowed: GroupedFaq[] = articlesIn(category.id).flatMap((article) =>
      (article.faqs ?? []).map((faq) => ({
        q: faq.q,
        a: faq.a,
        from: { title: article.title, href: articleHref(article) },
      })),
    );
    return { category, faqs: [...own, ...borrowed] };
  }).filter((group) => group.faqs.length > 0);
}

/** How many questions the FAQ page holds, for its own subtitle. */
export function faqCount(): number {
  return faqsByCategory().reduce((total, group) => total + group.faqs.length, 0);
}

/** How many articles a shelf holds, for the count on its card. */
export function articleCount(category: GuideCategoryId): number {
  return articlesIn(category).length;
}

export { ARTICLES, FAQS };
