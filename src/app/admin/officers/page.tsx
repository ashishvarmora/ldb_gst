import Link from "next/link";
import { Filter, MessageCircle, Phone, Plus, Search, UserPlus } from "lucide-react";

import { OfficerFields } from "./OfficerFields";
import { createOfficer } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
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
import { fmtRelative, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, Plan } from "@/lib/types";

export const metadata = { title: "Officers — Admin" };

type OfficerSearchParams = { q?: string; status?: string; plan?: string };

export default async function OfficersPage({
  searchParams,
}: {
  searchParams: Promise<OfficerSearchParams>;
}) {
  await requireSuperAdmin();
  const { q, status, plan } = await searchParams;
  const admin = getSupabaseAdmin();

  let query = admin
    .from("officer_overview")
    .select("*")
    .eq("role", "officer")
    .order("created_at", { ascending: false });

  if (status === "active" || status === "suspended") query = query.eq("status", status);
  if (plan === "none") query = query.is("plan_id", null);
  else if (plan) query = query.eq("plan_id", plan);
  if (q) {
    const term = `%${q}%`;
    query = query.or(
      `full_name.ilike.${term},email.ilike.${term},office.ilike.${term},district.ilike.${term}`,
    );
  }

  const [{ data: officers, error }, { data: plans }] = await Promise.all([
    query,
    admin.from("plans").select("*").order("sort_order"),
  ]);

  const rows = (officers ?? []) as OfficerOverview[];
  const planList = (plans ?? []) as Plan[];
  const filtered = Boolean(q || status || plan);

  return (
    <>
      <PageHeader
        title="Officers"
        subtitle="Every GST officer account on the platform, with the credits they have left right now."
        actions={
          <Modal
            triggerLabel="New officer"
            triggerIcon={<UserPlus size={15} />}
            title="Create an officer account"
            description="The account works immediately. Share the password over your own channel."
            width="xl"
          >
            <ActionForm action={createOfficer} closeOnSuccess={false} resetOnSuccess>
              <OfficerFields mode="create" plans={planList} />
              <FormActions>
                <SubmitButton pendingLabel="Creating...">
                  <Plus size={14} />
                  Create officer
                </SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Name, email, office or district"
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
          <option value="none">No plan assigned</option>
          {planList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {filtered ? (
          <Link href="/admin/officers" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState
            title="Could not load officers"
            description={`${error.message}. If this mentions officer_overview, run the SQL migrations in supabase/migrations.`}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No officers match those filters" : "No officers yet"}
            description={
              filtered
                ? "Try clearing the filters."
                : "Create the first officer account with the button above."
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Officer</th>
              <th className="th">Posting</th>
              <th className="th">Plan</th>
              <th className="th">Trucks</th>
              <th className="th text-right">Credits left</th>
              <th className="th text-right">Spent this month</th>
              <th className="th">Contact</th>
              <th className="th">Last event</th>
            </Thead>
            <Tbody>
              {rows.map((officer) => (
                <Tr key={officer.id}>
                  <td className="td">
                    <Link
                      href={`/admin/officers/${officer.id}`}
                      className="flex items-center gap-3 group"
                    >
                      <Avatar text={initials(officer.full_name, officer.email)} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink group-hover:text-brand-400">
                            {officer.full_name ?? "Unnamed"}
                          </span>
                          {officer.status === "suspended" ? (
                            <Badge tone="bad">Suspended</Badge>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-faint">{officer.email}</span>
                      </span>
                    </Link>
                  </td>

                  <td className="td">
                    <span className="block text-sm text-ink">{officer.office ?? "--"}</span>
                    <span className="block text-xs text-faint">
                      {[officer.district, officer.state].filter(Boolean).join(", ") || "--"}
                    </span>
                  </td>

                  <td className="td">
                    {officer.plan_name ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="brand">{officer.plan_name}</Badge>
                        {officer.has_overrides ? <Badge tone="warn">custom</Badge> : null}
                      </span>
                    ) : (
                      <Badge tone="bad">no plan</Badge>
                    )}
                    {officer.plan_expires_on ? (
                      <span className="mt-1 block text-xs text-faint">
                        expires {officer.plan_expires_on}
                      </span>
                    ) : null}
                  </td>

                  <td className="td">
                    <QuotaBar used={officer.active_trucks} limit={officer.truck_limit} />
                  </td>

                  <td className="td text-right">
                    <Badge
                      tone={
                        Number(officer.credits ?? 0) <= 0
                          ? "bad"
                          : Number(officer.credits ?? 0) < 20
                            ? "warn"
                            : "good"
                      }
                    >
                      {formatCredits(officer.credits)}
                    </Badge>
                  </td>

                  <td className="td text-right text-sm tabular-nums text-muted">
                    {formatCredits(officer.credits_spent_month)}
                  </td>

                  <td className="td">
                    <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink">
                      <Phone size={13} className="shrink-0 text-faint" />
                      {officer.phone ?? "--"}
                    </span>
                    <span
                      className="mt-1 flex items-center gap-1.5 text-xs text-faint"
                      title={officer.telegram_connected ? "Telegram connected" : "No Telegram chat id"}
                    >
                      <MessageCircle
                        size={13}
                        className={officer.telegram_connected ? "text-good-500" : "text-faint"}
                      />
                      {officer.telegram_connected ? "Telegram" : "no Telegram"}
                    </span>
                  </td>

                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtRelative(officer.last_event_at)}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      {rows.length > 0 ? (
        <p className="mt-3 text-xs text-faint">
          {rows.length} officer{rows.length === 1 ? "" : "s"} shown. Click a row for their contact
          details, the trucks they track and their full credit history.
        </p>
      ) : null}
    </>
  );
}
