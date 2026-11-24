import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * What search engines may crawl. The public site, yes; the signed-in app, the
 * admin console, the API and the one-off auth screens, no - they either
 * redirect to sign-in or hold nothing worth indexing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/portal",
        "/admin",
        "/api",
        "/auth",
        "/reset-password",
        "/forgot-password",
        "/no-access",
        "/offline",
        "/d/",
      ],
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
    host: env.siteUrl,
  };
}
