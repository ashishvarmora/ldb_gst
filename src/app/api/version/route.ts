import { NextResponse } from "next/server";

import { BUILD_ID } from "@/lib/build-id";

/**
 * Which build is live right now. Read by VersionWatcher to notice a deploy.
 *
 * The cheapest endpoint in the app on purpose: it touches no database, reads
 * no cookie and returns about forty bytes, because every open tab and every
 * installed app asks it whenever it comes back to the foreground.
 *
 * force-dynamic and no-store together, and both are load-bearing. A cached
 * answer here is worse than no endpoint at all: it would keep reporting the
 * build it was cached on, so the one request whose entire job is to notice a
 * deploy would be the one request that never does.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { id: BUILD_ID },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        // Vercel's edge cache reads this one; no-store alone is not always
        // enough to keep a GET off it.
        "CDN-Cache-Control": "no-store",
      },
    },
  );
}
