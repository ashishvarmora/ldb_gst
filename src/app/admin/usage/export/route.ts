import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row per officer for the current month, credits and all. This is the sheet
 * you would use to work out what to collect from each office.
 */
export async function GET() {
  const session = await getSessionUser();
  if (!session || session.profile.role !== "super_admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("officer_overview")
    .select("*")
    .eq("role", "officer")
    .order("full_name");

  if (error) return new NextResponse(error.message, { status: 500 });

  const header = [
    "Officer",
    "Email",
    "Phone",
    "Designation",
    "Office",
    "District",
    "State",
    "Status",
    "Plan",
    "Plan live",
    "Monthly charge",
    "Plan expires",
    "Credits included with plan",
    "Credits left",
    "Credits purchased",
    "Credits spent today",
    "Credits spent this month",
    "Tracked trucks",
    "Truck limit",
    "Manual searches this month",
    "Automatic checks this month",
    "Telegram linked",
  ];

  const lines = [header.join(",")];

  for (const row of (data ?? []) as OfficerOverview[]) {
    lines.push(
      [
        row.full_name,
        row.email,
        row.phone,
        row.designation,
        row.office,
        row.district,
        row.state,
        row.status,
        row.plan_name ?? "none",
        row.plan_active ? "yes" : "no",
        row.price_per_month ?? 0,
        row.plan_expires_on ?? "",
        row.included_credits ?? 0,
        row.credits ?? 0,
        row.credits_purchased ?? 0,
        row.credits_spent_today ?? 0,
        row.credits_spent_month ?? 0,
        row.active_trucks,
        row.truck_limit === -1 ? "unlimited" : row.truck_limit,
        row.manual_searches_month,
        row.tracking_queries_month,
        row.telegram_connected ? "yes" : "no",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const month = istToday().slice(0, 7);

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gst-truck-usage-${month}.csv"`,
    },
  });
}
