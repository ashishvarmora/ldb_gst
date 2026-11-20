/**
 * Whether a same-site href answers with a FILE rather than a page.
 *
 * WHY THIS MATTERS (20 Nov 2026, "loading gets stuck"). Two things go wrong
 * when such a URL is treated as a page:
 *
 *   1. As a next/link, the router fetches it expecting a React payload, gets a
 *      CSV back, and falls back to a hard navigation (location.assign). The
 *      browser downloads the file and the document never unloads - but Next
 *      suspends its router "until the page unloads" (app-router.js, the
 *      mpaNavigation branch), so the tapped link keeps spinning and later taps
 *      can hang until a full reload. A next/link also PREFETCHES its href, so
 *      merely viewing /portal/payments ran the whole CSV export in the
 *      background (seen in the logs: GET /portal/payments/export ~1 s after
 *      every GET /portal/payments).
 *   2. NavProgress lights its top bar on the click and waits for the URL to
 *      change - which a download never does - so the bar ran for its full
 *      20-second cap.
 *
 * Route handlers in this app that hand out files: every `/export` route, the
 * `/api/*` exports, and `/download/*` (the APK). Plain file extensions are
 * included for anything linked straight out of /public.
 */
export function isFileDownloadHref(href: string): boolean {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/")) return false;
  return (
    /\/export\/?$/.test(path) ||
    path.startsWith("/api/") ||
    path.startsWith("/download/") ||
    /\.(csv|apk|pdf|zip|xlsx?)$/i.test(path)
  );
}
