import type { Sort } from "@/components/charts";
import { toCsv } from "@/components/report";
import { LIFECYCLE_STAGES, stageOf, type AccountActivity } from "@/lib/analytics";

/**
 * How the account population is filtered, ordered and exported.
 *
 * Out here rather than inside the page because the CSV route needs every one of
 * these and has to agree with the screen exactly: an export that filtered
 * slightly differently, or ordered by something the table cannot order by, is a
 * spreadsheet that disagrees with the page it was downloaded from - and the
 * person who notices is always the one halfway through a renewal call.
 */

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

export type AccountFilters = {
  stage?: string;
  q?: string;
  /** "range": signed up inside the window. */
  joined?: string;
  /** "range": paid something in the window. "none": paid nothing. */
  paid?: string;
};

/** The filters a URL is actually allowed to set, so a stale link cannot blank the list. */
export function parseAccountFilters(params: {
  stage?: string;
  q?: string;
  joined?: string;
  paid?: string;
}): AccountFilters {
  return {
    stage: LIFECYCLE_STAGES.some((s) => s.key === params.stage) ? params.stage : undefined,
    q: params.q?.trim() ? params.q : undefined,
    joined: params.joined === "range" ? "range" : undefined,
    paid: params.paid === "range" || params.paid === "none" ? params.paid : undefined,
  };
}

/**
 * The accounts a filter set leaves.
 *
 * In JavaScript, and that is safe here rather than a shortcut, because
 * admin_account_activity() returns the whole population in one read - there are
 * no further pages to miss. It is what lets the totals line be a total of every
 * matching account rather than of the twenty-five on screen.
 *
 * `joined` compares against the report's own window rather than a separate
 * date filter: "new in range" and the range in the URL have to be the same
 * range, or the headline count and the list under it are answering two
 * different questions.
 */
export function filterAccounts(
  rows: AccountActivity[],
  filters: AccountFilters,
  range: { from: string; to: string },
): AccountActivity[] {
  const search = (filters.q ?? "").trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.stage && row.stage !== filters.stage) return false;

    if (filters.joined === "range") {
      if (row.signed_up_on < range.from || row.signed_up_on > range.to) return false;
    }

    const paid = Number(row.paid_inr) || 0;
    if (filters.paid === "range" && paid <= 0) return false;
    if (filters.paid === "none" && paid > 0) return false;

    if (!search) return true;
    return (
      row.email.toLowerCase().includes(search) ||
      (row.full_name ?? "").toLowerCase().includes(search) ||
      (row.district ?? "").toLowerCase().includes(search)
    );
  });
}

/** How a filter set reads, for a panel that has to say what it is showing. */
export function filtersSentence(filters: AccountFilters): string {
  const parts: string[] = [];
  if (filters.stage) parts.push(stageOf(filters.stage)?.label.toLowerCase() ?? filters.stage);
  if (filters.joined === "range") parts.push("signed up in this range");
  if (filters.paid === "range") parts.push("paid in this range");
  if (filters.paid === "none") parts.push("paid nothing in this range");
  if (filters.q) parts.push(`matching “${filters.q.trim()}”`);
  return parts.join(", ");
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every column the table can be ordered by, with the direction that column
 * means when nobody has said.
 *
 * `desc` here is only the fallback for a link that names a column and not a
 * direction - a bookmark, or one of the older `?sort=spent` links other screens
 * still carry. A header click always writes an explicit direction. The defaults
 * are chosen by what the column is FOR: money and usage want the biggest first,
 * a name wants A to Z, and a balance wants the lowest first because the reason
 * to sort by balance is to find who is about to run out mid-job.
 */
export const ACCOUNT_SORT: Record<
  string,
  { pick: (row: AccountActivity) => number | string; desc: boolean }
> = {
  name: { pick: (row) => (row.full_name ?? row.email).toLowerCase(), desc: false },
  stage: { pick: (row) => row.stage, desc: false },
  plan: { pick: (row) => row.plan_name ?? "", desc: false },
  paid_inr: { pick: (row) => Number(row.paid_inr) || 0, desc: true },
  payments: { pick: (row) => Number(row.payments) || 0, desc: true },
  credits_bought: { pick: (row) => Number(row.credits_bought) || 0, desc: true },
  free: {
    pick: (row) => (Number(row.credits_free) || 0) + (Number(row.credits_admin) || 0),
    desc: true,
  },
  credits_spent: { pick: (row) => Number(row.credits_spent) || 0, desc: true },
  searches: { pick: (row) => Number(row.searches) || 0, desc: true },
  auto_checks: { pick: (row) => Number(row.auto_checks) || 0, desc: true },
  credits: { pick: (row) => Number(row.credits) || 0, desc: false },
  signed_up_on: { pick: (row) => row.signed_up_on, desc: true },
  // Never seen sorts as the empty string, which puts it first ascending - and
  // "quietest first" is precisely why somebody sorts this column.
  last_active_at: { pick: (row) => row.last_active_at ?? "", desc: true },
};

/**
 * The orders other screens already link here with, kept working.
 *
 * /admin/usage has sent readers to `?sort=spent` since it stopped carrying its
 * own per-account table, and the Overview links `?stage=never_bought`. Renaming
 * the sort vocabulary without this map would turn every one of those links into
 * a report ordered by something else, silently.
 */
const LEGACY_SORT: Record<string, Sort> = {
  value: { key: "paid_inr", desc: true },
  spent: { key: "credits_spent", desc: true },
  recent: { key: "signed_up_on", desc: true },
  active: { key: "last_active_at", desc: true },
  quiet: { key: "last_active_at", desc: false },
  balance: { key: "credits", desc: false },
};

export function parseAccountSort(params: { sort?: string; dir?: string }): Sort {
  const raw = params.sort;
  if (!raw) return { key: "paid_inr", desc: true };

  const legacy = LEGACY_SORT[raw];
  if (legacy && !(raw in ACCOUNT_SORT)) return legacy;

  const column = ACCOUNT_SORT[raw];
  if (!column) return { key: "paid_inr", desc: true };

  return { key: raw, desc: params.dir ? params.dir !== "asc" : column.desc };
}

export function sortAccounts(rows: AccountActivity[], sort: Sort): AccountActivity[] {
  const column = ACCOUNT_SORT[sort.key];
  if (!column) return rows;

  const direction = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = column.pick(a);
    const right = column.pick(b);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });
}

/* -------------------------------------------------------------------------- */
/* The same accounts, as a spreadsheet                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every column the table has, plus the account id.
 *
 * The id is here and not on screen for the same reason the pivot export carries
 * it: a spreadsheet exists to be joined against something else, and a display
 * name is the one thing that cannot be joined on - two officers called Kirtan
 * are two rows a name cannot separate.
 *
 * The money and credit figures are for the report's window and the balance and
 * stage are as of now, which is the one thing about this sheet somebody could
 * misread, so the header says so in the column names themselves rather than in
 * a note nobody exports.
 */
export function accountCsv(rows: AccountActivity[], range: { from: string; to: string }): string {
  const window = `${range.from} to ${range.to}`;

  return toCsv(
    [
      "Account",
      "Email",
      "Account id",
      "District",
      "Stage (now)",
      "Status (now)",
      "Plan (now)",
      "Signed up",
      "Last seen",
      `Paid INR (${window})`,
      `Payments (${window})`,
      `Credits bought (${window})`,
      `Credits free (${window})`,
      `Credits by admin (${window})`,
      `Credits spent (${window})`,
      `Manual searches (${window})`,
      `Automatic checks (${window})`,
      "Balance now",
    ],
    rows.map((row) => [
      row.full_name ?? "",
      row.email,
      row.id,
      row.district ?? "",
      stageOf(row.stage)?.label ?? row.stage,
      row.status,
      row.plan_name ?? "",
      row.signed_up_on,
      row.last_active_at ?? "",
      Number(row.paid_inr) || 0,
      Number(row.payments) || 0,
      Number(row.credits_bought) || 0,
      Number(row.credits_free) || 0,
      Number(row.credits_admin) || 0,
      Number(row.credits_spent) || 0,
      Number(row.searches) || 0,
      Number(row.auto_checks) || 0,
      Number(row.credits) || 0,
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* The table's columns                                                         */
/* -------------------------------------------------------------------------- */


