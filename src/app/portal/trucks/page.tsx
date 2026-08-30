import { Plus } from "lucide-react";

import { addTruck } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input } from "@/components/form";
import { Modal } from "@/components/Modal";
import { TruckCard } from "@/components/TruckCard";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TrackedTruck, TruckAlertWithTemplate } from "@/lib/types";

export const metadata = { title: "My trucks — Truck Watch" };

export default async function TrucksPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: trucks }, { data: alerts }] = await Promise.all([
    admin
      .from("tracked_trucks")
      .select("*")
      .eq("user_id", overview.id)
      .order("last_event_at", { ascending: false, nullsFirst: false }),
    admin
      .from("truck_alerts")
      .select("*, template:alert_rule_templates(*)")
      .eq("user_id", overview.id),
  ]);

  const all = (trucks ?? []) as TrackedTruck[];

  const byTruck = new Map<string, TruckAlertWithTemplate[]>();
  for (const alert of (alerts ?? []) as TruckAlertWithTemplate[]) {
    const list = byTruck.get(alert.tracked_truck_id) ?? [];
    list.push(alert);
    byTruck.set(alert.tracked_truck_id, list);
  }

  const slots = truckSlotsLeft(overview);
  const canAdd = slots > 0 && Boolean(overview.plan_id);

  return (
    <>
      <PageHeader
        title="My trucks"
        subtitle="A truck is checked only when one of its alerts is due, so a truck with no alerts costs nothing."
        actions={
          <Modal
            triggerLabel="Add truck"
            triggerIcon={<Plus size={15} />}
            title="Add a truck to tracking"
            description={
              canAdd
                ? slots === Number.POSITIVE_INFINITY
                  ? "Unlimited tracking slots on your plan."
                  : `${slots} slot${slots === 1 ? "" : "s"} free on your plan.`
                : "No slots free — pause or remove a truck first."
            }
            width="sm"
          >
            <ActionForm action={addTruck} closeOnSuccess={false} resetOnSuccess>
              <div className="space-y-4">
                <Field
                  label="Truck number"
                  name="truck_number"
                  hint="Spaces and dashes are ignored."
                >
                  <Input
                    name="truck_number"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="GJ02AT8546"
                    className="font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
                  />
                </Field>

                <Field label="Label" name="label" hint="Optional. Which case is this for?">
                  <Input name="label" placeholder="Textile case — supplier vehicle" />
                </Field>

                <p className="rounded-lg border border-line bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted">
                  Nothing is checked until you add an alert. Open the truck after adding it and
                  pick the alert you want.
                </p>
              </div>
              <FormActions>
                <SubmitButton pendingLabel="Adding...">Add truck</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>
        }
      />

      {all.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="No trucks under tracking"
            description="Add a truck, then add an alert to it. Every toll crossing is logged and you get a Telegram message when the alert fires."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {all.map((truck) => (
            <TruckCard key={truck.id} truck={truck} alerts={byTruck.get(truck.id) ?? []} />
          ))}
        </div>
      )}
    </>
  );
}
