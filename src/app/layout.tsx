import type { Metadata, Viewport } from "next";

import { publicSettings } from "@/components/SiteFooter";
import "./globals.css";

/** The brand is admin-configurable, so the document title has to be read, not written. */
export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: brandName,
    description: "Track a truck by its registration number and get told on Telegram when it moves.",
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
