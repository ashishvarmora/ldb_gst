import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleHelp, LifeBuoy, Mail, ReceiptIndianRupee } from "lucide-react";

import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";
import { cx } from "@/components/ui";

import { GuideSearch } from "./Search";
import {
  ARTICLES,
  CATEGORIES,
  SEARCH_INDEX,
  articleCount,
  articleHref,
  faqCount,
  mostAsked,
  startHere,
} from "./lib";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Help centre — ${brandName}`,
    description:
      "The user manual and FAQs: how to start from nothing, add a lorry, get alerts on your phone, what each check costs, and how to fix it when something looks wrong.",
  };
}

/**
 * The help centre's front door.
 *
 * WHAT THIS REPLACED, because the shape of this page is a direct answer to it.
 * The guide was one route: fifteen numbered sections, 1,117 lines, 13,344
 * pixels tall on a 390px phone, navigable only by anchor links. An officer
 * arrives with one question - "why is my phone silent", "why did this pause
 * itself", "why won't it let me top up" - and a wall thirty-four screens deep
 * is the same as no answer. Nothing was wrong with the writing. The structure
 * was the bug.
 *
 * So it is now shelved like a shop: a search box, one numbered path for
 * somebody starting from zero, nine subjects, and the handful of questions
 * support is actually asked. Every one of those is a page of its own, which
 * means a reader can be sent a link to the exact answer rather than to the
 * manual, and the browser's back button works the way they expect.
 *
 * NO SECTION HERE MAY BE TALLER THAN A PHONE SCREEN. That is the rule the page
 * is held to and the reason the category cards carry a blurb of one clamped
 * line rather than a paragraph, and the reason "most asked" is six rows and
 * not sixteen. The whole hub is meant to be scrollable in four flicks.
 *
 * IT IS PUBLIC, like /pricing and /data-sources, and for the same reasons.
 * Somebody deciding whether to pay has to be able to find out what they would
 * be paying for; and an officer whose plan has lapsed or who cannot sign in is
 * exactly the reader who needs the page about fixing it and cannot reach the
 * portal to find it.
 */
export default async function GuideHubPage() {
  const [{ brandName }, action] = await Promise.all([publicSettings(), publicHeaderAction()]);

  const start = startHere(5);
  const asked = mostAsked(6);
  const questions = faqCount();

  /* The search results say which shelf a hit lives on, and the client
     component must not import CATEGORIES to find out - that would drag every
     lucide icon into the browser bundle for four words of label. */
  const labels = Object.fromEntries(CATEGORIES.map((category) => [category.id, category.title]));

  return (
    <PublicShell action={action} mainClassName="flex-1 px-4 py-6 sm:py-9">
      <div className="mx-auto w-full max-w-4xl space-y-6 sm:space-y-9">
        {/* ---------------------------------------------------------------- */}
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-strong sm:text-3xl">
            Help centre
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            The whole of {brandName}, in short pages. {ARTICLES.length}{" "}
            {ARTICLES.length === 1 ? "guide" : "guides"} and {questions}{" "}
            {questions === 1 ? "answer" : "answers"} — search, or pick a subject below.
          </p>
          <div className="mt-4">
            <GuideSearch index={SEARCH_INDEX} labels={labels} />
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        {/*
          The answer to "how do I run this from zero", and the reason it is
          second on the page rather than buried: most people arriving here have
          never used the product, and the order of these five is the order that
          stops them losing money. Derived from the getting-started shelf, so
          it cannot name an article that has been renamed or not written.
        */}
        {start.length > 0 ? (
          <Section
            title="New here? Start in this order"
            /* Deliberately says nothing about which step is the important one.
               The list is derived from the getting-started shelf, so "the
               fourth is the one people skip" - true of the page this replaced -
               would point at whatever article happens to be fourth after the
               next edit. */
            hint={`${start.length} short pages, in the order that stops you losing money.`}
          >
            <ol className="space-y-1.5">
              {start.map((article, index) => (
                <li key={article.slug}>
                  <Link
                    href={articleHref(article)}
                    className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2 transition hover:border-brand-500/50 hover:bg-sunken"
                  >
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/12 text-[11px] font-semibold text-brand-500">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {article.title}
                    </span>
                    <span className="shrink-0 text-[11px] whitespace-nowrap text-faint">
                      {article.minutes} min
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        <Section title="Browse by subject" hint="Nine shelves. Everything is on one of them.">
          {/* Two columns at 390px and three from sm. Cards rather than a list
              because the icon and the count are what make a shelf worth
              opening, and a nine-row list of bare titles is a wall. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
            {CATEGORIES.map(({ id, title, blurb, icon: Icon }) => {
              const count = articleCount(id);
              return (
                <Link
                  key={id}
                  href={`/guide/${id}`}
                  className="flex min-h-20 flex-col gap-1 rounded-xl border border-line bg-panel p-3 transition hover:border-brand-500/50 hover:bg-sunken"
                >
                  {/* Icon beside the title, not above it. Stacked, the nine
                      cards came to 787px on a 390px phone - four screens of
                      shelf labels before "most asked". This is the same card
                      about 30px shorter, five rows over. */}
                  <span className="flex items-center gap-2">
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/12 text-brand-500">
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 text-sm leading-snug font-semibold text-ink">
                      {title}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted">{blurb}</span>
                  <span className="mt-auto text-[10px] tracking-wider text-faint uppercase">
                    {count} {count === 1 ? "guide" : "guides"}
                  </span>
                </Link>
              );
            })}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        {asked.length > 0 ? (
          <Section title="Most asked" hint="The questions support answers over and over.">
            <ul className="divide-y divide-divider overflow-hidden rounded-xl border border-line bg-panel">
              {asked.map((item) => (
                <li key={item.href + item.title}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center gap-3 px-3.5 py-2 transition hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug font-medium text-ink">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-faint">{item.note}</span>
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Where to go when the manual is not the answer. Four destinations,
            because a reader who has scrolled this far and not found it needs a
            person, not another article. */}
        <Section title="Still stuck?">
          <div className="grid grid-cols-2 gap-2">
            <Way href="/guide/faq" icon={<CircleHelp size={15} />} title="All questions">
              {questions} in one page
            </Way>
            <Way href="/support" icon={<LifeBuoy size={15} />} title="Help and support">
              Common fixes
            </Way>
            <Way href="/contact" icon={<Mail size={15} />} title="Contact us">
              Write or call
            </Way>
            <Way href="/pricing" icon={<ReceiptIndianRupee size={15} />} title="Plans and pricing">
              What it costs
            </Way>
          </div>
        </Section>
      </div>
    </PublicShell>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                      */
/* -------------------------------------------------------------------------- */

/** One band of the hub. Heading, one optional line, content. Nothing else. */
function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="text-base font-semibold text-strong">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p> : null}
      <div className={cx(hint ? "mt-2.5" : "mt-2")}>{children}</div>
    </section>
  );
}

/** One way out of the help centre. */
function Way({
  href,
  icon,
  title,
  children,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2 transition hover:border-brand-500/50 hover:bg-sunken"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/12 text-brand-500">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        <span className="block truncate text-[11px] text-faint">{children}</span>
      </span>
    </Link>
  );
}
