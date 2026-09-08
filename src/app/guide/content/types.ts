export type GuideCategoryId =
  | "start" | "trucks" | "alerts" | "credits"
  | "plans" | "payments" | "rewards" | "account" | "trouble";

export type FigureName =
  | "portal-home" | "add-truck" | "truck-row" | "truck-detail"
  | "alert-rules" | "credit-ledger" | "plan-cards" | "checkout"
  | "telegram-setup" | "referral-share" | "payment-history" | "pause-badges";

export type GuideBlock =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "note"; tone: "info" | "warn" | "good"; title?: string; text: string }
  | { kind: "figure"; name: FigureName; caption: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "cta"; href: string; label: string; hint?: string };

export type GuideArticle = {
  slug: string;
  title: string;
  summary: string;
  category: GuideCategoryId;
  minutes: number;
  keywords: string[];
  blocks: GuideBlock[];
  faqs?: { q: string; a: string }[];
};

/**
 * A standalone question, for ./faqs.ts.
 *
 * Part of the agreed contract and load-bearing in three places: faqs.ts
 * imports it, ../lib.ts groups on `category`, and /guide/faq renders it. It
 * was dropped from this file once during the rewrite and took the build with
 * it, so it is worth saying plainly - do not remove it.
 */
export type GuideFaq = {
  q: string;
  a: string;
  category: GuideCategoryId;
  keywords?: string[];
};
