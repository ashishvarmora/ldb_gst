import type { Metadata, Viewport } from "next";
import { DM_Mono, Instrument_Sans, Plus_Jakarta_Sans } from "next/font/google";

import { ServiceWorkerRegistrar } from "@/components/Pwa";
import { publicSettings } from "@/components/SiteFooter";
import { VersionWatcher } from "@/components/VersionWatcher";
import { BUILD_ID } from "@/lib/build-id";
import { env } from "@/lib/env";
import "./globals.css";
import "./home-design.css";
import "./portal-home.css";
import "./mobile-app.css";
import "./app-refinements.css";
import "./auth-public.css";
import "./screens-polish.css";

/*
 * The customer app's three faces: Plus Jakarta Sans
 * for headings, Instrument Sans for everything read, DM Mono for registration
 * numbers, times and references. Self-hosted by next/font at build time, so
 * the app never waits on Google at runtime; `swap` shows the system face until
 * each arrives. globals.css reads the variables and falls back to the system
 * stack if one is missing.
 */
const displayFace = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display-face",
  display: "swap",
});
const bodyFace = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-face",
  display: "swap",
});
const monoFace = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-face",
  display: "swap",
});

/** What the product is, in one line, wherever a link to it is unfurled. */
const DESCRIPTION =
  "Look up a lorry by its registration number, see the toll plazas it has passed, and get a Telegram message when it moves.";

/** The brand is admin-configurable, so the document title has to be read, not written. */
export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    // Without a base, a shared link resolves its preview against the page it
    // was shared from rather than against us.
    metadataBase: new URL(env.siteUrl),
    title: brandName,
    description: DESCRIPTION,
    applicationName: brandName,
    openGraph: {
      title: brandName,
      description: DESCRIPTION,
      siteName: brandName,
      type: "website",
    },
    icons: {
      icon: [
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: "/apple-icon.png",
    },
    /*
     * iOS ignores the manifest entirely, so the installed name, the status bar
     * and full-screen mode have to be asked for again here. Without this an
     * added-to-home-screen copy opens in a Safari tab with the address bar.
     */
    appleWebApp: {
      capable: true,
      title: shortAppName(brandName),
      statusBarStyle: "default",
    },
  };
}

/** iOS shows very little of this under the icon, so a long brand gets its first word. */
function shortAppName(brandName: string): string {
  if (brandName.length <= 12) return brandName;
  return (brandName.split(/\s+/)[0] ?? brandName).slice(0, 12);
}

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
  /*
   * The tab bar and the account sheet both pad themselves with
   * env(safe-area-inset-bottom). That function returns 0 on iOS unless the
   * viewport is told to cover the whole screen, so without this line the
   * home-indicator gap those two carefully leave is not actually left.
   *
   * maximumScale is deliberately not set: pinch-zoom is how somebody reads a
   * registration number they cannot quite make out.
   */
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * suppressHydrationWarning because the script below adds a class to this
     * element before React hydrates it, on purpose.
     */
    <html
      lang="en"
      suppressHydrationWarning
      className={`${displayFace.variable} ${bodyFace.variable} ${monoFace.variable}`}
    >
      <head>
        {/*
         * Marks the Android app (RahdariApp/ in its user agent - see
         * src/lib/native-app.ts) before the first paint, so app-only styles in
         * globals.css apply from the first frame instead of flashing the
         * website's footer and then hiding it. Inline and tiny for that reason.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              /*
               * Also: when Android keeps the status and button bars out of the
               * WebView itself, the page is shorter than the screen by their
               * height - and padding for them again would leave a gap above
               * the top bar and lift the tab bar. .system-insets zeroes the
               * page's own padding in that case only (screens-polish.css).
               * Measured at first paint and on load, never while a keyboard
               * could be open.
               */
              "try{var d=document.documentElement;if(navigator.userAgent.indexOf('RahdariApp/')>-1){d.classList.add('native-app');var f=function(){var g=screen.height-window.innerHeight;if(window.innerHeight>0)d.classList.toggle('system-insets',g>16)};f();addEventListener('load',f,{once:true})}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegistrar />
        {/*
         * Mounted at the root, so it covers the signed-out pages too. A
         * customer sitting on /pricing across a deploy has the same stale
         * chunks as one inside the portal, and the checkout they open from
         * there is the most expensive thing in the app to have fail.
         *
         * BUILD_ID is read here, on the server, which makes the prop the
         * build that rendered THIS document - the thing that actually has to
         * be compared against what is live. Baking it into the client bundle
         * through an env var would say the same thing far less directly.
         */}
        <VersionWatcher current={BUILD_ID} />
      </body>
    </html>
  );
}
