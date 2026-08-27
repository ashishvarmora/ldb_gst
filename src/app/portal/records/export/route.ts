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
 * The officer's own records as a spreadsheet, honouring whatever filters they
 * had applied on screen. Always scoped to their own user id, so editing the
 * query string can never reach another officer's data.
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

  if (params.get("all") !== "1") query = query.eq("is_location_change", true);

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
