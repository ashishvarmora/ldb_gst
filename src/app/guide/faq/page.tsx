import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

import { Crumbs, Faqs } from "../Blocks";
import { GuideSearch } from "../Search";
import { CATEGORIES, SEARCH_INDEX, faqCount, faqsByCategory } from "../lib";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  const count = faqCount();
  return {
    title: `Frequently asked questions — ${brandName}`,
    description: `${count} straight answers about tracking a lorry, credits, plans, payments and alerts on ${brandName}.`,
  };
}

/**
 * Every question on the platform, on one page.
 *
 * A URL OF ITS OWN, and that is the whole reason it exists as a route rather
 * than a section of the hub: "FAQ" is what people paste into a WhatsApp group,
 * type into a browser bar and expect a support reply to link to. A question
 * folded into a subject page cannot be sent to anybody.
 *
 * Grouped by subject and shut by default. Fifty questions open at once is the
 * wall this rebuild exists to remove; shut, the whole page is a scannable list
 * of the things people actually ask, and the search box at the top skips the
 * scan entirely.
 *
 * It also gathers the questions that hang off individual articles, so a reader
 * who lands here from a shared link does not have to know that half the
 * answers were filed under an article. The ones that were carry a link to it.
 */
export default async function GuideFaqPage() {
  const [{ brandName }, action] = await Promise.all([publicSettings(), publicHeaderAction()]);

  const groups = faqsByCategory();
  const count = faqCount();
  const labels = Object.fromEntries(CATEGORIES.map((category) => [category.id, category.title]));

  return (
    <PublicShell action={action} mainClassName="flex-1 px-4 py-6 sm:py-9">
      <div className="mx-auto w-full max-w-3xl">
        <Crumbs trail={[{ href: "/guide", label: "Guide" }, { label: "All questions" }]} />

        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-strong sm:text-2xl">
            Frequently asked questions
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {count} straight answers about {brandName}. Tap one to open it, or search.
          </p>
          <div className="mt-4">
            <GuideSearch
              index={SEARCH_INDEX}
              labels={labels}
              placeholder="Search all questions — try “refund” or “paused”"
            />
          </div>

          {/*
            Jump to a subject, and it is not decoration: 130 questions shut is
            still about eleven phone screens of summaries. Anchors rather than
            links to the nine category pages, because somebody who came here
            wants ALL the questions - the shelves are one tap away from each
            group heading below.
          */}
          {groups.length > 1 ? (
            <nav aria-label="Jump to a subject" className="mt-3.5">
              <ul className="flex flex-wrap gap-1.5">
                {groups.map(({ category, faqs }) => (
                  <li key={category.id}>
                    <a
                      href={`#${category.id}`}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs font-medium text-muted transition hover:border-brand-500/50 hover:text-brand-500"
                    >
                      {category.title}
                      <span className="tabular-nums text-faint">{faqs.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </header>

        {groups.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-4 py-3.5 text-sm text-muted">
            No questions have been published yet.{" "}
            <Link href="/support" className="font-medium text-brand-500 hover:underline">
              Ask us instead
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-7">
            {groups.map(({ category, faqs }) => (
              <section key={category.id} id={category.id} className="scroll-mt-20">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-strong">{category.title}</h2>
                  <Link
                    href={`/guide/${category.id}`}
                    className="-mr-2 inline-flex min-h-10 shrink-0 items-center rounded-lg px-2 text-xs font-medium text-brand-500 transition hover:bg-brand-500/8"
                  >
                    Guides
                  </Link>
                </div>
                <Faqs items={faqs} />
              </section>
            ))}
          </div>
        )}

        <p className="mt-8 border-t border-line/70 pt-5 text-xs text-muted">
          Not here?{" "}
          <Link href="/support" className="font-medium text-brand-500 hover:underline">
            Help and support
          </Link>{" "}
          ·{" "}
          <Link href="/contact" className="font-medium text-brand-500 hover:underline">
            Contact us
          </Link>{" "}
          ·{" "}
          <Link href="/guide" className="font-medium text-brand-500 hover:underline">
            Back to the guide
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
