import type { Metadata, Viewport } from "next";

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
    openGraph: {
      title: brandName,
      description: DESCRIPTION,
      siteName: brandName,
      type: "website",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#f4f6fa",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
