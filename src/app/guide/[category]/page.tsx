import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";
import { EmptyState } from "@/components/ui";

import { Crumbs, Faqs } from "../Blocks";
import {
  CATEGORIES,
  articleHref,
  articlesIn,
  categoryById,
  faqsIn,
  isCategoryId,
} from "../lib";
import type { GuideCategoryId } from "../content/types";

/**
 * One shelf of the help centre.
 *
 * Rows rather than cards, and short ones: this page exists to be scanned, and
 * the decision it supports is only "which of these is my question". Title,
 * one clamped line of summary, a read time. Everything else is on the article.
 *
 * The shelf's own questions go underneath as accordions, because a good half
 * of what an officer arrives with is answerable in a sentence and does not
 * deserve a page. Native <details>, so this route ships no JavaScript at all.
 */

/**
 * The nine, prerendered.
 *
 * /guide/faq is a real file next to this one, so Next serves that route rather
 * than matching it here - and "faq" is not one of the nine, so a hand-typed
 * /guide/faq could never have reached this page anyway.
 */
export function generateStaticParams() {
  return CATEGORIES.map((category) => ({ category: category.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category: id } = await params;
  const { brandName } = await publicSettings();
  const category = isCategoryId(id) ? categoryById(id) : undefined;

  if (!category) return { title: `Help centre — ${brandName}` };

  return {
    title: `${category.title} — help centre — ${brandName}`,
    description: category.blurb,
  };
}

export default async function GuideCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: id } = await params;
  if (!isCategoryId(id)) notFound();

  const category = categoryById(id as GuideCategoryId);
  if (!category) notFound();

  const action = await publicHeaderAction();
  const articles = articlesIn(category.id);
  const faqs = faqsIn(category.id);
  const Icon = category.icon;

  return (
    <PublicShell action={action} mainClassName="flex-1 px-4 py-6 sm:py-9">
      <div className="mx-auto w-full max-w-3xl">
        <Crumbs trail={[{ href: "/guide", label: "Guide" }, { label: category.title }]} />

        <header className="mb-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-500">
              <Icon size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-strong sm:text-2xl">
                {category.title}
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-muted">{category.blurb}</p>
            </div>
          </div>
        </header>

        {/* ------------------------------------------------------------------ */}
        {articles.length === 0 ? (
          <div className="panel">
            <EmptyState
              title="Nothing on this shelf yet"
              description="This part of the manual is still being written. The questions below may already cover it."
            />
          </div>
        ) : (
          <section>
            <h2 className="text-xs font-semibold text-faint">
              {articles.length} {articles.length === 1 ? "guide" : "guides"}
            </h2>
            <ul className="mt-2 divide-y divide-divider overflow-hidden rounded-xl border border-line bg-panel">
              {articles.map((article) => (
                <li key={article.slug}>
                  <Link
                    href={articleHref(article)}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 transition hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug font-medium text-ink">
                        {article.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">
                        {article.summary}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-faint">
                        {article.minutes} min read
                      </span>
                    </span>
                    <ArrowRight size={15} className="shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ------------------------------------------------------------------ */}
        {faqs.length > 0 ? (
          <section className="mt-7">
            <h2 className="text-base font-semibold text-strong">Quick answers</h2>
            <p className="mt-0.5 text-xs text-muted">
              Tap a question. {faqs.length} on this subject.
            </p>
            <div className="mt-2.5">
              <Faqs items={faqs.map((faq) => ({ q: faq.q, a: faq.a }))} />
            </div>
          </section>
        ) : null}

        {/* ------------------------------------------------------------------ */}
        <nav className="mt-8 border-t border-line/70 pt-5">
          <p className="text-xs font-semibold text-faint">
            Other subjects
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {CATEGORIES.filter((other) => other.id !== category.id).map((other) => (
              <li key={other.id}>
                <Link
                  href={`/guide/${other.id}`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line bg-panel px-3 text-xs font-medium text-muted transition hover:border-brand-500/50 hover:text-brand-500"
                >
                  {other.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </PublicShell>
  );
}
