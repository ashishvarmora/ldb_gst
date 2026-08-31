import Link from "next/link";
import { FolderOpen, Plus, Truck } from "lucide-react";

import { createCase } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Textarea } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Pager, pageFromParam } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import { EmptyState, LinkButton, Mono, PageHeader, Panel } from "@/components/ui";
import { fmtDate, fmtNumber } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckGroup } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Groups — ${brandName}` };
}

/** Cards per page. Fills the three-column grid four rows deep on a laptop. */
const PAGE_SIZE = 12;

/**
 * A group is a named list of truck numbers - the table behind it is
 * truck_groups, and the route keeps its older /cases path so existing links
 * still work.
 */
export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const page = pageFromParam((await searchParams).page);
  const from = (page - 1) * PAGE_SIZE;

  const { data: groups, count } = await admin
    .from("truck_groups")
    .select("*", { count: "exact" })
    .eq("user_id", overview.id)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const caseList = (groups ?? []) as TruckGroup[];
  const total = count ?? caseList.length;

  // Members are read only for the groups on this page - the count under each
  // card is worth one small query, a whole account's membership is not.
  const byGroup = new Map<string, string[]>();
  if (caseList.length > 0) {
    const { data: members } = await admin
      .from("truck_group_members")
      .select("group_id, truck_number")
      .in("group_id", caseList.map((group) => group.id));

    for (const row of members ?? []) {
      const list = byGroup.get(row.group_id) ?? [];
      list.push(row.truck_number);
      byGroup.set(row.group_id, list);
    }
  }

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle={
          total > 0
            ? `${fmtNumber(total)} group${total === 1 ? "" : "s"}. Put the trucks that belong together in one place and read them on a single timeline.`
            : "Put the trucks that belong together in one place and read them on a single timeline."
        }
        actions={
          <Modal
            triggerLabel="New group"
            triggerIcon={<Plus size={15} />}
            title="Create a group"
            description="You can paste a whole list of truck numbers at once."
            width="md"
          >
            <ActionForm action={createCase} resetOnSuccess>
              <div className="space-y-4">
                <Field label="Group name" name="name">
                  <Input name="name" required placeholder="e.g. Delhi–Mumbai run" />
                </Field>
                <Field label="Notes" name="description" hint="Optional. Only you can see this.">
                  <Textarea
                    name="description"
                    rows={2}
                    placeholder="e.g. Three vehicles on contract until December."
                  />
                </Field>
                <Field
                  label="Truck numbers"
                  name="truck_numbers"
                  hint="Optional. Commas, spaces or new lines — anything else is ignored."
                >
                  <Textarea
                    name="truck_numbers"
                    rows={3}
                    placeholder="e.g. MH12AB1234, GJ02AT8546, KA01CD5678"
                    className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
                  />
                </Field>
              </div>
              <FormActions>
                <SubmitButton pendingLabel="Creating...">Create group</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>
        }
      />

      {caseList.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title={page > 1 ? "Nothing on this page" : "No groups yet"}
            description={
              page > 1
                ? "There are no groups this far back."
                : "A group is just a named list of trucks. Open one and you see every crossing across the whole group on a single timeline."
            }
            action={
              page > 1 ? <LinkButton href="/portal/cases">Back to the first page</LinkButton> : null
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {caseList.map((group) => {
            const trucks = byGroup.get(group.id) ?? [];
            return (
              <Link
                key={group.id}
                href={`/portal/cases/${group.id}`}
                className="panel group block p-4 transition hover:border-brand-500/40 hover:bg-raised/70"
              >
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-brand-400">
                    <FolderOpen size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink group-hover:text-brand-400">
                      {group.name}
                    </p>
                    <p className="text-xs text-faint">Created {fmtDate(group.created_at)}</p>
                  </div>
                </div>

                {group.description ? (
                  <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-muted">
                    {group.description}
                  </p>
                ) : null}

                <div className="mt-3 border-t border-divider pt-2.5">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
                    <Truck size={11} />
                    {trucks.length} truck{trucks.length === 1 ? "" : "s"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {trucks.slice(0, 4).map((number) => (
                      <Mono
                        key={number}
                        className="rounded border border-line bg-raised px-1.5 py-0.5 text-[11px] text-muted"
                      >
                        {number}
                      </Mono>
                    ))}
                    {trucks.length > 4 ? (
                      <span className="px-1 py-0.5 text-[11px] text-faint">
                        +{trucks.length - 4}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Pager
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        noun="groups"
        href={{ path: "/portal/cases" }}
        className="mt-4"
      />
    </>
  );
}
