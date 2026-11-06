import { NextResponse, type NextRequest } from "next/server";

import { publicSettings } from "@/components/SiteFooter";

/**
 * The one address every "Download for Android" button points at.
 *
 * It redirects to whichever APK the admin has published - uploaded in Admin →
 * Settings → Mobile app, or pasted there as a link - and to the copy bundled
 * with the site (public/rahdari.apk) until one has been. So shipping a new APK
 * never means editing the website: the button stays the same and this decides
 * where it lands, read fresh on every click.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { androidApkUrl } = await publicSettings();
  const target = androidApkUrl || "/rahdari.apk";

  const response = NextResponse.redirect(new URL(target, request.nextUrl.origin), 302);
  // Never cached: the point is that a new upload takes effect on the next tap.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
