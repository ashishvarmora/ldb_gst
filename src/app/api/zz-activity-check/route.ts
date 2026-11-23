// TEMPORARY verification route - deleted after the check. Dev build dir only.
import { NextResponse } from "next/server";

import { SEARCHES_KEY, loadActivity, loadActivityEntries, type EntrySort } from "@/lib/credit-history";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  if (process.env.RAHDARI_BUILD_DIR !== ".next-dev") return new NextResponse("no", { status: 404 });
  const admin = getSupabaseAdmin();

  /* The busiest accounts of the last 30 days, by charges. */
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: daily } = await admin
    .from("credit_ledger_daily")
    .select("user_id,entries,reason")
    .in("reason", ["auto_check", "manual_search"])
    .gte("ist_date", since)
    .limit(5000);
  const per = new Map<string, number>();
  for (const row of (daily ?? []) as { user_id: string; entries: number }[]) {
    per.set(row.user_id, (per.get(row.user_id) ?? 0) + Number(row.entries));
  }
  const users = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);

  const report: unknown[] = [];
  for (const [u, userId] of users.entries()) {
    const data = await loadActivity(admin, userId, { from: null, to: null, mode: "all", truck: null });
    const tracked = new Set(data.trucks.map((t) => t.number));
    const keys = [...new Set(data.cells.map((c) => c.key))].slice(0, 6);
    for (const key of keys) {
      const cells = data.cells.filter((c) => c.key === key);
      const want = {
        checks: cells.reduce((s, c) => s + c.auto + c.manual, 0),
        credits: Math.round(cells.reduce((s, c) => s + c.credits, 0) * 100) / 100,
      };
      const scope = { from: null, to: null, key, mode: "all" as const, tracked };
      const big = await loadActivityEntries(admin, userId, scope, "newest", 1, 5000);
      const checks = big.rows.filter((r) => r.kind === "check");
      const got = {
        checks: checks.length,
        credits: Math.round(checks.reduce((s, r) => s + r.credits, 0) * 100) / 100,
        events: big.rows.length - checks.length,
        total: big.total,
      };
      /* Paging with a small page must give the same list, same order. */
      const paged: string[] = [];
      const size = 7;
      const pages = Math.min(Math.ceil(big.total / size), 40);
      for (let p = 1; p <= pages; p++) {
        const r = await loadActivityEntries(admin, userId, scope, "newest", p, size);
        paged.push(...r.rows.map((x) => x.key));
      }
      const sameOrder = paged.every((k, i) => big.rows[i]?.key === k);
      const oldest = await loadActivityEntries(admin, userId, scope, "oldest", 1, 5000);
      const reversed = oldest.rows.map((r) => r.key).join() === [...big.rows].reverse().map((r) => r.key).join();
      const most = await loadActivityEntries(admin, userId, scope, "most", 1, 30);
      const mostOk = most.rows.every((r, i) => i === 0 || most.rows[i - 1].credits >= r.credits);
      report.push({
        user: u,
        key: key === SEARCHES_KEY ? "searches" : "truck",
        want,
        got,
        pagedCompared: paged.length,
        sameOrder,
        oldestIsReverse: reversed,
        mostSorted: mostOk,
        errors: [big.error, oldest.error, most.error].filter(Boolean),
      });
    }
    /* Ungrouped, last 7 days, both sort families. */
    const all = await loadActivityEntries(
      admin,
      userId,
      { from: null, to: null, key: null, mode: "manual", tracked },
      "fewest" as EntrySort,
      1,
      25,
    );
    report.push({ user: u, ungroupedManualFewest: all.rows.length, total: all.total, error: all.error });
  }
  return NextResponse.json(report);
}
