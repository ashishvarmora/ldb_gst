import type { MetadataRoute } from "next";

import { ARTICLES, CATEGORIES, articleHref } from "@/app/guide/lib";
import { env } from "@/lib/env";

/**
 * Every public page a search engine should know about: the marketing pages,
 * the guide's shelves and every article. Built from the guide's own index, so
 * a new article appears here without anyone remembering to add it.
 */
export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "monthly",
  ) => ({ url: `${env.siteUrl}${path}`, lastModified: now, changeFrequency, priority });

  return [
    page("/", 1, "weekly"),
    page("/pricing", 0.9, "weekly"),
    page("/signup", 0.8),
    page("/guide", 0.8, "weekly"),
    page("/guide/faq", 0.7),
    ...CATEGORIES.map((category) => page(`/guide/${category.id}`, 0.6)),
    ...ARTICLES.map((article) => page(articleHref(article), 0.5)),
    page("/about", 0.5),
    page("/data-sources", 0.4),
    page("/support", 0.4),
    page("/contact", 0.4),
    page("/privacy", 0.2, "yearly"),
    page("/terms", 0.2, "yearly"),
  ];
}
