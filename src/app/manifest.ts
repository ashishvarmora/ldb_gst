import type { MetadataRoute } from "next";

import { publicSettings } from "@/components/SiteFooter";

/**
 * What an installed copy of this app is called and how it opens.
 *
 * Async because the brand is admin-configurable: the name on the home screen
 * has to be the name the owner set, not one hard-coded here. publicSettings()
 * is cache()-wrapped and falls back to a default, so this costs one read and
 * cannot fail the manifest.
 *
 * start_url is /portal rather than /: an installed icon is opened by somebody
 * who already has an account, and the portal redirects to sign-in on its own if
 * the session has lapsed. Landing them on the marketing page instead would make
 * the icon feel like a bookmark.
 */
/*
 * Without this the manifest is prerendered once and the brand name baked into
 * it outlives any change the owner makes in the console - an installed icon
 * would keep the old name until the next deploy. Re-read hourly instead, which
 * a file fetched at install time can well afford.
 */
export const revalidate = 3600;

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { brandName } = await publicSettings();

  // Launchers truncate at roughly 12 characters, so a long brand gets its first
  // word rather than an ellipsis somebody has to guess at.
  const shortName =
    brandName.length <= 12 ? brandName : (brandName.split(/\s+/)[0] ?? brandName).slice(0, 12);

  return {
    id: "/portal",
    name: brandName,
    short_name: shortName,
    description:
      "Look up a lorry by its registration number, see the toll plazas it has passed, and get a message when it moves.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    // If a browser will not honour standalone, minimal-ui still drops the
    // address bar's clutter before falling all the way back to a tab.
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    lang: "en-IN",
    dir: "ltr",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/brand/icon-192-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops to its own shape; these keep the ground full-bleed and
      // the truck inside the safe zone so nothing important is cut off.
      { src: "/brand/icon-maskable-192-v2.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/icon-maskable-512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    /*
     * Long-press the icon and these are the three jobs. They track the bottom
     * bar for the same reason it holds them: each is daily work, and anything
     * account-shaped is one tap further in.
     *
     * Records used to be the third of four here and went with the page. Worth
     * knowing that an installed copy keeps whatever shortcuts it was installed
     * with until the launcher re-reads this file, so /portal/records had to
     * stop being a 404 rather than merely stop being listed - see the redirect
     * in next.config.ts.
     */
    shortcuts: [
      { name: "Search a truck", short_name: "Search", url: "/portal/search" },
      { name: "My trucks", short_name: "Trucks", url: "/portal/trucks" },
      { name: "Plan and credits", short_name: "Plan", url: "/portal/plan" },
    ],
  };
}
