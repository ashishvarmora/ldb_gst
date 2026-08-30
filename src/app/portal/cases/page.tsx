import Link from "next/link";
import { FolderOpen, Plus, Truck } from "lucide-react";

import { createCase } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Textarea } from "@/components/form";
import { Modal } from "@/components/Modal";
import { EmptyState, Mono, PageHeader, Panel } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckGroup } from "@/lib/types";

export const metadata = { title: "Cases — Truck Watch" };

export default async function CasesPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const { data: groups } = await admin
    .from("truck_groups")
    .select("*")
    .eq("user_id", overview.id)
    .order("created_at", { ascending: false });

  const caseList = (groups ?? []) as TruckGroup[];

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
        title="Case folders"
        subtitle="Group the vehicles in one investigation and read the whole set at once."
        actions={
          <Modal
            triggerLabel="New case"
            triggerIcon={<Plus size={15} />}
            title="Create a case folder"
            description="You can paste a whole list of truck numbers at once."
            width="md"
          >
            <ActionForm action={createCase} resetOnSuccess>
              <div className="space-y-4">
                <Field label="Case name" name="name">
                  <Input name="name" required placeholder="Fake billing — textile ring" />
                </Field>
                <Field label="Notes" name="description" hint="Optional. Only you can see this.">
                  <Textarea
                    name="description"
                    rows={2}
                    placeholder="Three suppliers, invoices dated Jul–Aug 2026."
                  />
                </Field>
                <Field
                  label="Truck numbers"
                  name="truck_numbers"
                  hint="Optional. Separate with commas, spaces or new lines — anything that is not a registration number is ignored."
                >
                  <Textarea
                    name="truck_numbers"
                    rows={3}
                    placeholder="GJ02AT8546, GJ01XX1234, MH04AB9999"
                    className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
                  />
                </Field>
              </div>
              <FormActions>
                <SubmitButton pendingLabel="Creating...">Create case</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>
        }
      />

      {caseList.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="No case folders yet"
            description="A case folder is just a named list of trucks. Open one and you see every crossing across the whole group on a single timeline."
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
    </>
  );
}
