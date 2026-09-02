import {
  accountCsv,
  filterAccounts,
  parseAccountFilters,
  parseAccountSort,
  sortAccounts,
} from "../accounts";
import { csvFile } from "@/components/report";
import { loadAccountActivity, resolveRange } from "@/lib/analytics";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The account population, as the reader currently has it on screen.
 *
 * The whole query string comes along, so the file is the same window, the same
 * filters and the same order: download the renewal list and you get the renewal
 * list, not every account on the platform. A one-click "export everything"
 * would have been less code and would have answered a different question from
 * the one on the page.
 *
 * There is already an export at /admin/usage/export and this is not a second
 * copy of it. That one is officer_overview - the operational sheet: plan, truck
 * limit, credits left, what to collect. This one is admin_account_activity for
 * a chosen window with a chosen filter, which is the analytical sheet, and the
 * column headers name the window so the two cannot be confused after the fact.
 *
 * getSessionUser and a 403, rather than requireSuperAdmin: that helper redirects
 * to /login, and a redirect answering a download either saves the login page as
 * a .csv or fails silently, neither of which tells anybody what went wrong.
 */
export async function GET(request: Request) {
  const session = await getSessionUser();
  if (
    !session ||
    session.profile.role !== "super_admin" ||
    session.profile.status !== "active"
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const query = new URL(request.url).searchParams;
  const range = resolveRange({
    range: query.get("range") ?? undefined,
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
    bucket: query.get("bucket") ?? undefined,
  });

  const filters = parseAccountFilters({
    stage: query.get("stage") ?? undefined,
    q: query.get("q") ?? undefined,
    joined: query.get("joined") ?? undefined,
    paid: query.get("paid") ?? undefined,
  });
  const sort = parseAccountSort({
    sort: query.get("sort") ?? undefined,
    dir: query.get("dir") ?? undefined,
  });

  const admin = getSupabaseAdmin();
  const accounts = await loadAccountActivity(admin, range);
  const rows = sortAccounts(filterAccounts(accounts, filters, range), sort);

  const stamp = range.from === range.to ? range.from : `${range.from}_${range.to}`;
  return csvFile(`rahdari-accounts-${stamp}.csv`, accountCsv(rows, range));
}
