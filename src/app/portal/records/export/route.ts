import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { fmtDateTime, istDaysAgo } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckEvent } from "@/lib/types";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The account's own toll crossings as a spreadsheet.
 *
 * THE PAGE ABOVE THIS ROUTE IS GONE and the route is deliberately still here.
 * /portal/records was a whole screen of view switches, filters and pattern
 * charts, and the owner's verdict was that a customer does not need that
 * complexity - so the screen went. Downloading your own crossing history is not
 * complexity, it is the only way the data leaves this app on demand: the Google
 * Sheet backup only writes rows the retention purge is about to delete, and
 * needs the platform's Sheets integration switched on, which it is not.
 * Deleting this with the page would have taken a capability away rather than a
 * screen.
 *
 * Its one remaining link is on /portal/search/[truck], scoped to that truck.
 * The query string still honours truck, direction, plaza and range exactly as
 * the old filter panel set them, so an account-wide download is a URL somebody
 * can still type - and the fleet list is where a button for it would belong if
 * one is ever wanted.
 *
 * Always scoped to the signed-in user id, so editing the query string can never
 * reach another account's data.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || session.profile.status !== "active") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const admin = getSupabaseAdmin();

  let query = admin
    .from("truck_events")
    .select("*")
    .eq("user_id", session.id)
    .order("event_time", { ascending: false, nullsFirst: false })
    .limit(10_000);

  const range = params.get("range") ?? "7";
  if (range !== "all") {
    const days = Number(range);
    if (Number.isFinite(days) && days > 0) {
      query = query.gte("event_time", `${istDaysAgo(days)}T00:00:00+05:30`);
    }
  }

  const truck = params.get("truck");
  const direction = params.get("direction");
  const q = params.get("q");
  if (truck) query = query.eq("truck_number", truck);
  if (direction) query = query.eq("direction", direction);
  if (q) query = query.ilike("loc_name", `%${q}%`);

  const { data, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });

  const header = [
    "Event time (IST)",
    "Truck",
    "Toll plaza",
    "Latitude",
    "Longitude",
    "Direction",
    "Event",
    "Crossing id",
    "Recorded at (IST)",
  ];

  const lines = [header.join(",")];
  for (const row of (data ?? []) as TruckEvent[]) {
    lines.push(
      [
        fmtDateTime(row.event_time),
        row.truck_number,
        row.loc_name ?? "",
        row.lat ?? "",
        row.lng ?? "",
        row.direction ?? "",
        row.event_name ?? "",
        row.seq_no,
        fmtDateTime(row.fetched_at),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="truck-records-${stamp}.csv"`,
    },
  });
}
