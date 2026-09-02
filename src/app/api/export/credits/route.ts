import type { NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The credit ledger, as a file.
 *
 * Takes the same query string the screen uses, so what downloads is exactly
 * what was on screen rather than a second interpretation of the filters. The
 * only extra parameter is `user`, because the screen knows whose ledger it is
 * showing and a URL has to say so.
 *
 * WHOSE LEDGER: an officer may export their own and nobody else's - the id in
 * the URL is checked against the session rather than trusted. A super admin may
 * export any single account, or every account by leaving `user` off. That check
 * is the whole security surface of this route, so it happens before anything is
 * read.
 *
 * Rows, not rollups. A spreadsheet is where somebody does their own grouping,
 * and handing over pre-summed figures would throw away the detail that makes
 * the file worth having. credit_transactions is retention-protected, so this is
 * the complete record rather than a recent slice of it.
 */

/** Hard ceiling, so one request cannot try to stream a million rows. */
const MAX_ROWS = 50_000;

/** ISO date, or null - the same guard the screen uses. */
function parseDate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return Number.isNaN(Date.parse(`${raw}T00:00:00+05:30`)) ? null : raw;
}

function istStart(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

/**
 * One CSV field.
 *
 * Quotes everything rather than deciding per value: a truck number cannot
 * contain a comma today, but a note somebody typed certainly can, and one
 * unquoted comma shifts every later column on that row. Embedded quotes are
 * doubled, which is what RFC 4180 asks for.
 *
 * The leading apostrophe guard on =, +, - and @ is deliberate. Excel treats a
 * field starting with those as a formula, so a note reading "-2 credits, see
 * receipt" becomes an error cell or, worse, something executable.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new Response("Sign in first.", { status: 401 });
  }

  /*
   * A suspended account keeps its session cookie until it expires, so "signed
   * in" is not the same question as "still allowed". Every Server Action goes
   * through assertPortalUser(), which asks both; this route only asked the
   * first, and so kept handing a suspended account its own history on request.
   */
  if (session.profile.status !== "active") {
    return new Response("This account has been suspended.", { status: 403 });
  }

  /*
   * One request assembles up to fifty thousand rows and then looks up a profile
   * for every distinct account in them. Nobody downloads the same spreadsheet
   * five times in five minutes on purpose, and a loop that does is expensive
   * for everyone else on the database.
   */
  const throttle = await rateLimit("export:user", session.id);
  if (!throttle.allowed) {
    return new Response("Too many exports. Please wait a moment and try again.", {
      status: 429,
      headers: { "Retry-After": String(throttle.retryAfter) },
    });
  }

  const params = request.nextUrl.searchParams;
  const asked = params.get("user");
  const isAdmin = session.profile.role === "super_admin";

  /*
   * Resolved before a single row is read. An officer is pinned to their own id
   * whatever the URL said; only an admin may name somebody else or ask for
   * everybody.
   */
  let userId: string | null;
  if (isAdmin) {
    userId = asked && asked !== "all" ? asked : null;
  } else {
    if (asked && asked !== session.id) {
      return new Response("You can only export your own credit history.", { status: 403 });
    }
    userId = session.id;
  }

  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));
  const kind = params.get("kind");
  const reason = params.get("reason");
  const truck = params.get("truck");

  let query = getSupabaseAdmin()
    .from("credit_transactions")
    .select("created_at,user_id,reason,delta,balance_after,truck_number,note")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (userId) query = query.eq("user_id", userId);
  if (from) query = query.gte("created_at", istStart(from));
  if (to) query = query.lt("created_at", new Date(Date.parse(istStart(to)) + 86_400_000).toISOString());
  if (reason) query = query.eq("reason", reason);
  if (truck) query = query.eq("truck_number", truck);
  if (kind === "used") query = query.lt("delta", 0);
  if (kind === "added") query = query.gt("delta", 0);

  const { data, error } = await query;
  if (error) {
    console.error("credit export failed", error.message);
    return new Response("Could not read the ledger.", { status: 500 });
  }

  const rows = (data ?? []) as {
    created_at: string;
    user_id: string;
    reason: string;
    delta: number;
    balance_after: number;
    truck_number: string | null;
    note: string | null;
  }[];

  /* Named, so a downloaded file is identifiable a month later without opening
     it. Only accounts that actually appear are looked up. */
  const ids = [...new Set(rows.map((row) => row.user_id))];
  const nameOf = new Map<string, { name: string; email: string }>();
  if (ids.length > 0) {
    const { data: people } = await getSupabaseAdmin()
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    for (const p of (people ?? []) as { id: string; full_name: string | null; email: string }[]) {
      nameOf.set(p.id, { name: p.full_name?.trim() || "", email: p.email });
    }
  }

  const header = [
    "Timestamp (IST)",
    "Account",
    "Email",
    "Reason",
    "Truck number",
    "Credits",
    "Direction",
    "Balance after",
    "Note",
  ];

  const lines = [header.map(csvField).join(",")];
  for (const row of rows) {
    const who = nameOf.get(row.user_id);
    const credits = Number(row.delta) || 0;
    lines.push(
      [
        /* IST, matching every date on screen. A UTC timestamp in the file and an
           IST one in the app is how a reconciliation ends up a day out. */
        new Date(row.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        who?.name ?? "",
        who?.email ?? "",
        row.reason,
        row.truck_number ?? "",
        /* Absolute value with the direction in its own column, so a spreadsheet
           can sum "used" without every formula needing a sign convention. */
        Math.abs(credits),
        credits < 0 ? "used" : "added",
        row.balance_after,
        row.note ?? "",
      ]
        .map(csvField)
        .join(","),
    );
  }

  if (rows.length >= MAX_ROWS) {
    lines.push(csvField(`Truncated at ${MAX_ROWS} rows. Narrow the date range for the rest.`));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const who = userId ? (nameOf.get(userId)?.email ?? userId).replace(/[^a-zA-Z0-9._-]/g, "-") : "all-accounts";
  const filename = `credits-${who}-${stamp}.csv`;

  /* The BOM is for Excel: without it a rupee sign or a Devanagari name in a
     note is mangled on open, and the file looks corrupt to the person who
     asked for it. */
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
