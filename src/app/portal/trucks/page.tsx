import Link from "next/link";
import { Plus } from "lucide-react";

import { addTruck } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { TruckCard } from "@/components/TruckCard";
import { EmptyState, PageHeader, Panel, QuotaBar, cx } from "@/components/ui";
import { fmtNumber } from "@/lib/format";
import { INTERVAL_CHOICES, intervalLabel, monthlyCallsAt } from "@/lib/intervals";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TrackedTruck } from "@/lib/types";

export const metadata = { title: "My trucks — Truck Watch" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "watchlist", label: "Watchlist" },
  { key: "moving", label: "Moving" },
  { key: "quiet", label: "No activity" },
  { key: "paused", label: "Paused" },
] as const;

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: trucks }, settings] = await Promise.all([
    admin
      .from("tracked_trucks")
      .select("*")
      .eq("user_id", overview.id)
      .order("is_watchlist", { ascending: false })
      .order("last_event_at", { ascending: false, nullsFirst: false }),
    loadSettings(admin),
  ]);

  const all = (trucks ?? []) as TrackedTruck[];

  const shown = all.filter((truck) => {
    switch (filter) {
      case "watchlist":
        return truck.is_watchlist;
      case "moving":
        return truck.is_active && truck.status === "moving";
      case "quiet":
        return truck.is_active && truck.status === "no_activity";
      case "paused":
        return !truck.is_active;
      default:
        return true;
    }
  });

  const floor = Math.max(overview.min_polling_interval_minutes, settings.globalPollingFloor);
  const intervals = INTERVAL_CHOICES.filter((minutes) => minutes >= floor);
  const slots = truckSlotsLeft(overview);
  const canAdd = slots > 0 && Boolean(overview.plan_id);

  // What the current list actually costs per month, so the officer can see why
  // the monthly pool moves the way it does.
  const projected = all
    .filter((truck) => truck.is_active)
    .reduce((sum, truck) => sum + monthlyCallsAt(truck.polling_interval_minutes), 0);

  return (
    <>
      <PageHeader
        title="My trucks"
        subtitle="Trucks the platform checks for you in the background. Every check is logged and can raise an alert."
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

                <Field
                  label="Check every"
                  name="polling_interval_minutes"
                  hint={`Fastest allowed on your plan: ${floor} min. A slower interval stretches your monthly pool much further.`}
                >
                  <Select name="polling_interval_minutes" defaultValue={String(Math.max(30, floor))}>
                    {intervals.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {intervalLabel(minutes)} · ~{fmtNumber(monthlyCallsAt(minutes))} checks/month
                      </option>
                    ))}
                  </Select>
                </Field>

                <Checkbox
                  name="is_watchlist"
                  label="Watchlist truck"
                  hint="Alert me on every crossing, not just rule matches."
                />
              </div>
              <FormActions>
                <SubmitButton pendingLabel="Adding...">Start tracking</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Panel bodyClassName="px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
            Tracking slots
          </p>
          <QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />
        </Panel>
        <Panel bodyClassName="px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
            Monthly checks used
          </p>
          <QuotaBar
            used={overview.tracking_queries_month}
            limit={overview.tracking_queries_per_month}
          />
        </Panel>
        <Panel bodyClassName="px-4 py-3">
          <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
            This list costs
          </p>
          <p className="mt-1.5 text-sm text-ink">
            ~{fmtNumber(projected)} checks / month
            {overview.tracking_queries_per_month !== -1 &&
            projected > overview.tracking_queries_per_month ? (
              <span className="mt-0.5 block text-xs text-warn-500">
                More than your monthly pool. Slow some trucks down or you will run out mid-month.
              </span>
            ) : (
              <span className="mt-0.5 block text-xs text-faint">
                At the intervals you have set right now.
              </span>
            )}
          </p>
        </Panel>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((option) => {
          const active = (filter ?? "") === option.key;
          const count = all.filter((truck) => {
            switch (option.key) {
              case "watchlist":
                return truck.is_watchlist;
              case "moving":
                return truck.is_active && truck.status === "moving";
              case "quiet":
                return truck.is_active && truck.status === "no_activity";
              case "paused":
                return !truck.is_active;
              default:
                return true;
            }
          }).length;

          return (
            <Link
              key={option.key || "all"}
              href={option.key ? `/portal/trucks?filter=${option.key}` : "/portal/trucks"}
              className={cx(
                "inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-medium transition",
                active
                  ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
                  : "border-line bg-panel text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              {option.label}
              <span className="ml-1.5 opacity-60">{count}</span>
            </Link>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title={all.length === 0 ? "No trucks under tracking" : "Nothing matches this filter"}
            description={
              all.length === 0
                ? "Add a truck and the platform checks it every few minutes, logs each toll crossing and messages you on Telegram when a rule matches."
                : "Try a different filter."
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((truck) => (
            <TruckCard key={truck.id} truck={truck} />
          ))}
        </div>
      )}
    </>
  );
}
