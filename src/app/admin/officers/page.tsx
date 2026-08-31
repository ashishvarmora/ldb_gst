import Link from "next/link";
import { Filter, MessageCircle, Phone, Plus, Search, UserPlus } from "lucide-react";

import { AccountFields } from "./AccountFields";
import { createAccount } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Pager, pageFromParam } from "@/components/Pager";
import {
  Avatar,
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  QuotaBar,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtRelative, initials } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, Plan } from "@/lib/types";

export const metadata = { title: "Customers — Admin" };

const PER_PAGE = 25;

/** Below this a balance is worth chasing before the customer stops mid-job. */
const LOW_BALANCE = 20;

/**
 * The orders worth offering, and the column each one is really asking for.
 * Nulls always sink: an account that has never been seen is not the answer to
 * "who was here most recently".
 */
const SORTS = {
  recent: { label: "Newest first", column: "created_at", ascending: false },
  active: { label: "Last active", column: "last_active_at", ascending: false },
  name: { label: "Name", column: "full_name", ascending: true },
  balance: { label: "Lowest balance", column: "credits", ascending: true },
  spending: { label: "Spent most this month", column: "credits_spent_month", ascending: false },
  plan: { label: "Plan", column: "plan_name", ascending: true },
  status: { label: "Status", column: "status", ascending: true },
} as const;

type SortKey = keyof typeof SORTS;

function isSort(value: string | undefined): value is SortKey {
  return value !== undefined && value in SORTS;
}

type AccountSearchParams = {
  q?: string;
  status?: string;
  plan?: string;
  sort?: string;
  page?: string;
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<AccountSearchParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const { q, status, plan } = params;
  const sort: SortKey = isSort(params.sort) ? params.sort : "recent";
  const page = pageFromParam(params.page);

  const admin = getSupabaseAdmin();

  const { column, ascending } = SORTS[sort];

  // "officer" is the role name the database has always used for a customer
  // account. It is a stored value, not wording, so it stays as it is.
  let query = admin
    .from("officer_overview")
    .select("*", { count: "exact" })
    .eq("role", "officer")
    .order(column, { ascending, nullsFirst: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

  if (status === "active" || status === "suspended") query = query.eq("status", status);
  if (plan === "none") query = query.is("plan_id", null);
  else if (plan) query = query.eq("plan_id", plan);
  if (q) {
    const term = `%${q}%`;
    query = query.or(
      `full_name.ilike.${term},email.ilike.${term},office.ilike.${term},district.ilike.${term}`,
    );
  }

  const [{ data: accounts, error, count }, { data: plans }, settings] = await Promise.all([
    query,
    admin.from("plans").select("*").order("sort_order"),
    loadSettings(admin),
  ]);

  const rows = (accounts ?? []) as OfficerOverview[];
  const planList = (plans ?? []) as Plan[];
  const filtered = Boolean(q || status || plan);
  const total = count ?? rows.length;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`Every account on ${settings.brandName}, with the credits it has left right now.`}
        actions={
          <Modal
            triggerLabel="New customer"
            triggerIcon={<UserPlus size={15} />}
            title="Create an account"
            description="The account works immediately. Share the password over your own channel."
            width="xl"
          >
            <ActionForm action={createAccount} closeOnSuccess={false} resetOnSuccess>
              <AccountFields mode="create" plans={planList} />
              <FormActions>
                <SubmitButton pendingLabel="Creating...">
                  <Plus size={14} />
                  Create account
                </SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>
        }
      />

      {/* A plain GET form, so the filters live in the address bar: the view can
          be bookmarked, shared and reloaded, and needs no client state. Leaving
          out the page number is deliberate - a new filter starts at page 1. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Name, email, company or city"
            className="pl-9"
          />
        </div>

        <Select name="status" defaultValue={status ?? ""} className="w-40">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>

        <Select name="plan" defaultValue={plan ?? ""} className="w-48">
          <option value="">Any plan</option>
          <option value="none">No plan yet</option>
          {planList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <Select name="sort" defaultValue={sort} className="w-52">
          {Object.entries(SORTS).map(([key, option]) => (
            <option key={key} value={key}>
              Sort by {option.label.toLowerCase()}
            </option>
          ))}
        </Select>

        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {filtered || sort !== "recent" ? (
          <Link href="/admin/officers" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState
            title="Could not load the accounts"
            description={`${error.message}. If this mentions officer_overview, run the SQL migrations in supabase/migrations.`}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No accounts match those filters" : "No customers yet"}
            description={
              filtered
                ? "Try clearing the filters."
                : settings.signupEnabled
                  ? "Nobody has signed up yet. You can also create an account with the button above."
                  : "Public sign-up is closed, so accounts can only be created with the button above."
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Customer</th>
              <th className="th">Company</th>
              <th className="th">Plan</th>
              <th className="th">Trucks</th>
              <th className="th text-right">Credits left</th>
              <th className="th text-right">Spent this month</th>
              <th className="th">Contact</th>
              <th className="th">Last active</th>
            </Thead>
            <Tbody>
              {rows.map((account) => {
                const balance = Number(account.credits ?? 0);
                return (
                  <Tr key={account.id}>
                    <td className="td">
                      <Link
                        href={`/admin/officers/${account.id}`}
                        className="group flex items-center gap-3"
                      >
                        <Avatar text={initials(account.full_name, account.email)} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium text-ink group-hover:text-brand-400">
                              {account.full_name ?? "Unnamed"}
                            </span>
                            {account.status === "suspended" ? (
                              <Badge tone="bad">Suspended</Badge>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-faint">{account.email}</span>
                        </span>
                      </Link>
                    </td>

                    <td className="td">
                      <span className="block text-sm text-ink">{account.office ?? "--"}</span>
                      <span className="block text-xs text-faint">
                        {[account.district, account.state].filter(Boolean).join(", ") || "--"}
                      </span>
                    </td>

                    <td className="td">
                      {account.plan_name ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={account.plan_active ? "brand" : "warn"}>
                            {account.plan_name}
                          </Badge>
                          {account.has_overrides ? <Badge tone="warn">custom</Badge> : null}
                        </span>
                      ) : (
                        <Badge tone="bad">no plan</Badge>
                      )}
                      {account.plan_expires_on ? (
                        <span className="mt-1 block text-xs text-faint">
                          expires {fmtDate(account.plan_expires_on)}
                        </span>
                      ) : null}
                    </td>

                    <td className="td">
                      <QuotaBar used={account.active_trucks} limit={account.truck_limit} />
                    </td>

                    <td className="td text-right">
                      <Badge
                        tone={balance <= 0 ? "bad" : balance < LOW_BALANCE ? "warn" : "good"}
                      >
                        {formatCredits(balance)}
                      </Badge>
                    </td>

                    <td className="td text-right text-sm tabular-nums text-muted">
                      {formatCredits(account.credits_spent_month)}
                    </td>

                    <td className="td">
                      <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink">
                        <Phone size={13} className="shrink-0 text-faint" />
                        {account.phone ?? "--"}
                      </span>
                      <span
                        className="mt-1 flex items-center gap-1.5 text-xs text-faint"
                        title={
                          account.telegram_connected ? "Telegram connected" : "No Telegram chat id"
                        }
                      >
                        <MessageCircle
                          size={13}
                          className={account.telegram_connected ? "text-good-500" : "text-faint"}
                        />
                        {account.telegram_connected ? "Telegram" : "no Telegram"}
                      </span>
                    </td>

                    <td className="td whitespace-nowrap">
                      <span className="block text-xs text-muted">
                        {fmtRelative(account.last_active_at)}
                      </span>
                      <span className="block text-xs text-faint">
                        last crossing {fmtRelative(account.last_event_at)}
                      </span>
                    </td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Pager
        page={page}
        total={total}
        pageSize={PER_PAGE}
        noun="customers"
        href={{ path: "/admin/officers", params: { q, status, plan, sort } }}
      />

      {rows.length > 0 ? (
        <p className="mt-2 text-xs text-faint">
          Open a row for their contact details, the trucks they track, their credit history and
          everything they have done.
        </p>
      ) : null}
    </>
  );
}
