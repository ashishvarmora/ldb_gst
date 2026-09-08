import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Clock, List } from "lucide-react";

import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

import { Blocks, Crumbs, Faqs } from "../../Blocks";
import {
  ARTICLES,
  articleBySlug,
  articleHref,
  categoryById,
  headingsOf,
  neighbours,
  relatedTo,
} from "../../lib";

/**
 * One article.
 *
 * THE SHAPE IS THE POINT. What this replaced was a single 13,000-pixel page,
 * and the failure was never the prose - it was that an officer could not find
 * the paragraph they needed or tell how much was left. So an article is short,
 * it says its read time before the reader commits, it carries its own contents
 * list once it is long enough to need one, and it ends by naming the two or
 * three pages somebody who read this one usually wants next.
 *
 * NO JAVASCRIPT. The contents list is anchors, the accordions are <details>.
 * A reader on a slow connection gets a complete, working page from the first
 * byte of HTML.
 *
 * THE CONTENTS LIST APPEARS TWICE, DIFFERENTLY. On a laptop it is a sticky
 * column beside the text, which is free - there is empty margin there anyway.
 * On a phone there is no margin, so it collapses to one shut line at the top
 * and only when the article has three or more headings: a contents list of two
 * items on a phone is a screen of furniture that answers nothing.
 */
export function generateStaticParams() {
  return ARTICLES.map((article) => ({ category: article.category, slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { brandName } = await publicSettings();
  const article = articleBySlug(slug);

  if (!article) return { title: `Help centre — ${brandName}` };

  return {
    title: `${article.title} — ${brandName}`,
    description: article.summary,
  };
}

export default async function GuideArticlePage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category: categoryId, slug } = await params;

  const article = articleBySlug(slug);
  /* The category in the URL has to be the article's own. Otherwise every
     article would be reachable at nine addresses, the breadcrumb would lie on
     eight of them, and search engines would index the lot as duplicates. */
  if (!article || article.category !== categoryId) notFound();

  const category = categoryById(article.category);
  if (!category) notFound();

  const action = await publicHeaderAction();

  const headings = headingsOf(article.blocks);
  const related = relatedTo(article.slug, 3);
  const { prev, next } = neighbours(article.slug);

  return (
    <PublicShell action={action} mainClassName="flex-1 px-4 py-6 sm:py-9">
      <div className="mx-auto w-full max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start lg:gap-10">
        {/* ---------------------------------------------------------------- */}
        <article className="min-w-0 lg:max-w-2xl">
          <Crumbs
            trail={[
              { href: "/guide", label: "Guide" },
              { href: `/guide/${category.id}`, label: category.title },
              { label: article.title },
            ]}
          />

          <header className="mb-5">
            <h1 className="text-xl font-semibold tracking-tight text-strong sm:text-2xl">
              {article.title}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{article.summary}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-faint">
              <Clock size={13} aria-hidden className="shrink-0" />
              {article.minutes} min read
            </p>
          </header>

          {/* On this page — phones only, and only when it earns its line. */}
          {headings.length >= 3 ? (
            <details className="panel group mb-5 overflow-hidden lg:hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
                <List size={15} aria-hidden className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">On this page</span>
                <span className="shrink-0 text-xs text-faint">{headings.length}</span>
                <ChevronDown
                  size={16}
                  aria-hidden
                  className="shrink-0 text-faint transition group-open:rotate-180"
                />
              </summary>
              <ol className="border-t border-divider px-3.5 py-2">
                {headings.map((heading, index) => (
                  <li key={heading.id}>
                    <a
                      href={`#${heading.id}`}
                      className="flex min-h-10 items-center gap-2 text-sm text-muted transition hover:text-brand-500"
                    >
                      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-faint">
                        {index + 1}
                      </span>
                      <span className="min-w-0">{heading.text}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          <Blocks blocks={article.blocks} />

          {/* ---------------------------------------------------------------- */}
          {article.faqs && article.faqs.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-base font-semibold text-strong">Questions about this</h2>
              <div className="mt-2.5">
                <Faqs items={article.faqs} />
              </div>
            </section>
          ) : null}

          {/* ---------------------------------------------------------------- */}
          {related.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-base font-semibold text-strong">
                Related in {category.title.toLowerCase()}
              </h2>
              <ul className="mt-2.5 divide-y divide-divider overflow-hidden rounded-xl border border-line bg-panel">
                {related.map((sibling) => (
                  <li key={sibling.slug}>
                    <Link
                      href={articleHref(sibling)}
                      className="flex min-h-12 items-center gap-3 px-3.5 py-2.5 transition hover:bg-sunken"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug font-medium text-ink">
                          {sibling.title}
                        </span>
                        <span className="text-[11px] text-faint">{sibling.minutes} min read</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ---------------------------------------------------------------- */}
          {/* Where the shelf goes next, so an article can be read as a course
              rather than as a lucky search result. */}
          {prev || next ? (
            <nav className="mt-8 grid gap-2 border-t border-line/70 pt-5 sm:grid-cols-2">
              {prev ? (
                <Link
                  href={articleHref(prev)}
                  className="flex min-h-14 items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2.5 transition hover:border-brand-500/50 hover:bg-sunken"
                >
                  <ArrowLeft size={15} className="shrink-0 text-faint" />
                  <span className="min-w-0">
                    <span className="block text-[11px] tracking-wider text-faint uppercase">
                      Previous
                    </span>
                    <span className="block text-sm leading-snug font-medium text-ink">
                      {prev.title}
                    </span>
                  </span>
                </Link>
              ) : (
                <span aria-hidden className="hidden sm:block" />
              )}

              {next ? (
                <Link
                  href={articleHref(next)}
                  className="flex min-h-14 items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-right transition hover:border-brand-500/50 hover:bg-sunken sm:justify-end"
                >
                  <span className="min-w-0 flex-1 sm:flex-none">
                    <span className="block text-[11px] tracking-wider text-faint uppercase">
                      Next
                    </span>
                    <span className="block text-sm leading-snug font-medium text-ink">
                      {next.title}
                    </span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-faint" />
                </Link>
              ) : null}
            </nav>
          ) : null}

          <p className="mt-7 text-xs text-muted">
            Still stuck?{" "}
            <Link href="/support" className="font-medium text-brand-500 hover:underline">
              Help and support
            </Link>{" "}
            ·{" "}
            <Link href="/guide/faq" className="font-medium text-brand-500 hover:underline">
              All questions
            </Link>
          </p>
        </article>

        {/* ---------------------------------------------------------------- */}
        {/* The laptop contents list. hidden below lg, so it costs a phone
            nothing at all - not even the markup. */}
        {headings.length > 1 ? (
          <aside className="hidden lg:block">
            <div className="sticky top-8">
              <p className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                On this page
              </p>
              <nav className="mt-2 border-l border-divider">
                <ol>
                  {headings.map((heading) => (
                    <li key={heading.id}>
                      <a
                        href={`#${heading.id}`}
                        className="-ml-px flex min-h-9 items-center border-l-2 border-transparent pl-3 text-xs leading-snug text-muted transition hover:border-brand-500 hover:text-brand-500"
                      >
                        {heading.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
              <p className="mt-4 border-t border-divider pt-3 text-[11px] leading-relaxed text-faint">
                <Link href={`/guide/${category.id}`} className="hover:text-brand-500">
                  ← All of {category.title.toLowerCase()}
                </Link>
              </p>
            </div>
          </aside>
        ) : null}
      </div>
    </PublicShell>
  );
}
