import type { NextConfig } from "next";

/**
 * Razorpay's checkout, as this app actually loads it.
 *
 * BuyCredits.tsx appends a <script> for checkout.razorpay.com on the first
 * click, and that script then opens the payment window as an iframe pointing at
 * api.razorpay.com, pulls its own images and fonts, and reports back to
 * lumberjack.razorpay.com. Every one of those has to be named or the payment
 * window opens blank, so they are listed once here and reused across the
 * directives below rather than repeated inline.
 */
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com";
const RAZORPAY_FRAME = ["https://api.razorpay.com", "https://checkout.razorpay.com"];
const RAZORPAY_CONNECT = [
  "https://api.razorpay.com",
  "https://checkout.razorpay.com",
  "https://lumberjack.razorpay.com",
  "https://lumberjack-cx.razorpay.com",
];
const RAZORPAY_IMG = ["https://cdn.razorpay.com", "https://checkout.razorpay.com"];

/**
 * The browser talks to Supabase directly for the things that cannot happen on
 * the server: the recovery-link exchange on /reset-password, signing out, and
 * the session refresh. Read from the environment because it differs between the
 * preview and production projects, and a hard-coded host would silently break
 * one of them.
 */
const SUPABASE_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const { origin, host } = new URL(raw);
    // The realtime channel is a WebSocket on the same host, which connect-src
    // treats as a separate scheme.
    return [origin, `wss://${host}`];
  } catch {
    return [];
  }
})();

const join = (...parts: (string | string[])[]) => parts.flat().join(" ");

/**
 * The policy we would like to enforce.
 *
 * SHIPPED REPORT-ONLY, ON PURPOSE. The blocker is script-src. Next's App Router
 * streams the page as a series of inline <script> tags - the __next_f payload -
 * and there is no way to allow those without either 'unsafe-inline', which
 * gives up most of what a CSP is for, or a per-request nonce, which has to be
 * generated in middleware and threaded into every one of those tags. Turning
 * this on with a guessed script-src does not fail loudly: it fails as a blank
 * page or a payment window that will not open, for a customer, in production.
 *
 * So it reports and does not block. Point report-uri at a collector (or read
 * the violations in the browser console on a staging deploy), exercise a real
 * checkout end to end, and promote it to the enforcing header below once the
 * report is quiet. Everything that CAN be enforced safely already is - see
 * ENFORCED_CSP.
 */
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  join("script-src 'self' 'unsafe-inline'", RAZORPAY_SCRIPT),
  // Tailwind v4 emits a stylesheet, but Razorpay's checkout injects its own
  // styles into our document, so 'unsafe-inline' here is not optional.
  "style-src 'self' 'unsafe-inline'",
  join("img-src 'self' data: blob:", RAZORPAY_IMG),
  "font-src 'self' data:",
  join("connect-src 'self'", SUPABASE_ORIGIN, RAZORPAY_CONNECT),
  join("frame-src", RAZORPAY_FRAME),
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Deliberately NOT repeated here. A browser ignores
  // upgrade-insecure-requests in a report-only policy and says so in the
  // console on every page load - which is a real error message, appearing on
  // every screen, about a directive that is already being enforced by the
  // policy below. Somebody would eventually spend an afternoon on it.
].join("; ");

/**
 * The half that is safe to enforce today.
 *
 * None of these directives touch how a script is loaded, so none of them can
 * blank the page the way a wrong script-src would. What they do buy is real:
 * frame-ancestors stops the app being framed for clickjacking, base-uri stops
 * an injected <base> redirecting every relative URL on the page, form-action
 * stops a form being posted to somebody else's server, and object-src closes
 * the plugin surface outright.
 */
const ENFORCED_CSP = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  devIndicators: false,
  /*
   * WHERE THIS PROJECT ACTUALLY STARTS.
   *
   * There is a stray package-lock.json in the user's home directory, and Next
   * infers the workspace root from the outermost lockfile it can find - so
   * every dev and build run warned that it had picked the home directory as
   * the root. That is not cosmetic: the root is what output file tracing is
   * computed against, which decides which files are bundled into each
   * serverless function on Vercel. Getting it wrong risks a function that
   * either drags in the whole home directory or misses a file it needed.
   *
   * Pinned here rather than by deleting somebody's file: another project may
   * depend on that lockfile, and a config line cannot break anything outside
   * this repository.
   */
  outputFileTracingRoot: import.meta.dirname,

  /*
   * STOPS A DEPLOY BREAKING THE PAGES THAT ARE ALREADY OPEN.
   *
   * A browser holding a document from the previous build keeps asking for that
   * build's content-hashed chunks. Those are not in the new deployment, so
   * they 404 - and what the customer sees is a button that does nothing, with
   * no clue that a refresh is the cure.
   *
   * Stamping the deployment id into the build makes every asset request say
   * which build it came from, which is what lets Vercel's Skew Protection
   * answer it from THAT deployment instead of the current one. The old page
   * then keeps working until it is reloaded, rather than breaking the moment
   * the deploy lands.
   *
   * This line alone does nothing: Skew Protection is a project setting
   * (Vercel → Settings → Advanced), and it is the toggle that does the
   * routing. Without it this is harmless, and VersionWatcher still gets
   * everyone onto the new build - it just does so after a fault rather than
   * before one.
   *
   * Undefined off Vercel, which is the documented way to leave it unset.
   */
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,

  experimental: {
    // Server Actions receive plan/limit payloads; keep the default 1MB cap.
    serverActions: { bodySizeLimit: "1mb" },

    /*
     * A TAB YOU JUST LEFT OPENS INSTANTLY WHEN YOU GO BACK TO IT.
     *
     * Next 15 keeps nothing for a dynamic page (every portal page is one): Home
     * -> Trucks -> Home rendered Home on the server a second time, skeleton and
     * all, for an answer seconds old. In the Android app, where the tab bar is
     * how people move, that read as the app being slow rather than the network.
     *
     * 30 seconds of reuse in this browser tab only. It cannot show a stale
     * screen after the customer changed something: every portal action calls
     * revalidatePath, which empties this cache, and pull-to-refresh calls
     * router.refresh(), which bypasses it. What it can show is someone else's
     * change - a payment the webhook settled, a reply from the desk - up to 30
     * seconds late, on a screen the customer was looking at a moment ago.
     */
    staleTimes: { dynamic: 30 },
  },

  /**
   * /portal/records is gone, so it must not be a 404.
   *
   * It was a bottom-bar tab, a sidebar row and a PWA shortcut for months, which
   * means it is in browser history, in bookmarks, and - the case a deploy
   * cannot fix - baked into every installed home-screen icon until that
   * launcher re-reads the manifest. Landing those on "page not found" reads as
   * the app being broken rather than as a screen having been withdrawn.
   *
   * EXACT PATH ONLY, deliberately: /portal/records/export is still a live CSV
   * route and a `:path*` source would swallow it, since redirects are matched
   * before the filesystem.
   *
   * Temporary rather than permanent. A 308 is cached by the browser more or
   * less for ever, and this is a product decision the owner could reverse; a
   * 307 costs one hop and can be taken back.
   */
  async redirects() {
    return [{ source: "/portal/records", destination: "/portal/trucks", permanent: false }];
  },

  /**
   * Applied to every route, including the API handlers and the CSV downloads.
   * Vercel sets a few of these on its own domains; a custom domain gets
   * nothing it is not asked for, which is why they are all stated here rather
   * than assumed.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          /*
           * Two years, subdomains included, and preload-eligible. Browsers
           * ignore this header over plain HTTP, so it is harmless on localhost
           * and does nothing until the site is served over TLS.
           *
           * includeSubDomains is the part to think about before deploying: it
           * commits every subdomain of the apex to HTTPS for two years, which
           * matters if one of them is an internal tool still on HTTP.
           */
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          /*
           * The CSV export sets its own Content-Type. Without this a browser is
           * free to sniff a downloaded file, and a note somebody typed into the
           * ledger that happens to look like HTML gets rendered as HTML from
           * our own origin.
           */
          { key: "X-Content-Type-Options", value: "nosniff" },
          /*
           * A truck registration number in the path is somebody's operational
           * data, and a full URL in the Referer header hands it to every
           * external site a link leads to. Same-origin navigations keep the
           * whole path, cross-origin ones get the bare origin.
           */
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // frame-ancestors above is the modern spelling; this is the one older
          // browsers understand, and they disagree about nothing here.
          { key: "X-Frame-Options", value: "DENY" },
          /*
           * Nothing in this app asks for a camera, a microphone or a location -
           * the locations it shows come from the toll network, not the device.
           * Denying them outright means an injected script cannot ask either.
           *
           * payment is the exception: Razorpay's checkout uses the Payment
           * Request API where the browser supports it, so its own frame keeps
           * the permission and nobody else gets it.
           */
          {
            key: "Permissions-Policy",
            value: [
              "accelerometer=()",
              "camera=()",
              "geolocation=()",
              "gyroscope=()",
              "magnetometer=()",
              "microphone=()",
              "usb=()",
              `payment=(self "${RAZORPAY_FRAME[0]}" "${RAZORPAY_FRAME[1]}")`,
            ].join(", "),
          },
          { key: "Content-Security-Policy", value: ENFORCED_CSP },
          { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
          // Cross-origin isolation for the document itself. COEP is deliberately
          // absent: it would break the Razorpay iframe, which sets no CORP
          // header of its own.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
      {
        /*
         * Nothing under /api is a page, and none of it should ever be cached by
         * a CDN or a browser - a cached credit export is one officer's ledger
         * handed to whoever asks next.
         */
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        /*
         * The Android app (src/components/AppDownload.tsx). Without the right
         * type Android's browser saves it as a .bin or refuses to open it, and
         * without a short cache a new build sits behind the old one for a day.
         */
        source: "/rahdari.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="Rahdari.apk"' },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
