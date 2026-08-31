import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistrar } from "@/components/Pwa";
import { publicSettings } from "@/components/SiteFooter";
import { env } from "@/lib/env";
import "./globals.css";

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
  themeColor: "#f4f6fa",
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
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
