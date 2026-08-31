import { Trash2 } from "lucide-react";

import { OverridesPanel } from "./OverridesPanel";
import { AccountFields } from "../AccountFields";
import { assignPlan, deleteAccount, saveAccountIntegrations, updateAccount } from "../actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Badge, DescRow, Panel } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { LimitOverrides, OfficerOverview, Plan, Profile, TelegramConfig } from "@/lib/types";

/**
 * Everything that changes the account, in one place. Splitting the forms out of
 * the reading views is the point of the tabs: nobody scrolls past a delete
 * button on their way to a truck list any more.
 */
export async function SettingsTab({
  id,
  overview,
}: {
  id: string;
  overview: OfficerOverview;
}) {
  const admin = getSupabaseAdmin();

  const [{ data: profile }, { data: plans }, { data: overrides }, { data: telegram }] =
    await Promise.all([
      admin.from("profiles").select("*").eq("id", id).maybeSingle<Profile>(),
      admin.from("plans").select("*").order("sort_order"),
      admin
        .from("user_limit_overrides")
        .select("*")
        .eq("user_id", id)
        .maybeSingle<LimitOverrides>(),
      admin.from("telegram_configs").select("*").eq("user_id", id).maybeSingle<TelegramConfig>(),
    ]);

  const planList = (plans ?? []) as Plan[];
  const currentPlan = planList.find((plan) => plan.id === overview.plan_id) ?? null;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Panel
          title="Account details"
          description="Name, contact and your own notes. None of it is shown to anyone else."
        >
          <ActionForm action={updateAccount} closeOnSuccess={false}>
            <input type="hidden" name="user_id" value={id} />
            <AccountFields mode="edit" account={profile ?? undefined} />
            <FormActions>
              <SubmitButton>Save details</SubmitButton>
            </FormActions>
          </ActionForm>
        </Panel>

        <OverridesPanel account={overview} plan={currentPlan} overrides={overrides ?? null} />

        <Panel
          title="Telegram"
          description="Where this account's alerts are delivered. You can fill it in for them, or let them do it from their own dashboard."
        >
          <ActionForm action={saveAccountIntegrations} closeOnSuccess={false}>
            <input type="hidden" name="user_id" value={id} />
            <div className="space-y-4">
              <Field
                label="Telegram chat id"
                name="telegram_chat_id"
                hint="They send /start to your bot; the bot replies with this number."
              >
                <Input
                  name="telegram_chat_id"
                  defaultValue={telegram?.chat_id ?? ""}
                  placeholder="123456789"
                />
              </Field>

              <Field
                label="Own bot token"
                name="telegram_bot_token"
                hint="Leave blank to use the platform bot. Only set this if they insist on their own."
              >
                <Input
                  name="telegram_bot_token"
                  defaultValue={telegram?.bot_token ?? ""}
                  placeholder="platform bot"
                />
              </Field>

              <Checkbox
                name="telegram_is_enabled"
                label="Send Telegram alerts"
                defaultChecked={telegram?.is_enabled ?? true}
              />
            </div>
            <FormActions>
              <SubmitButton>Save Telegram</SubmitButton>
            </FormActions>
          </ActionForm>

          <dl className="mt-4 border-t border-divider pt-3">
            <DescRow label="Verified">{fmtRelative(telegram?.verified_at)}</DescRow>
            {telegram?.last_error ? (
              <DescRow label="Last error">
                <span className="text-bad-500">{telegram.last_error}</span>
              </DescRow>
            ) : null}
          </dl>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel
          title="Plan"
          description="Takes effect on the next search. Credits are only handed over if you ask for them below."
          actions={
            <Badge tone={overview.plan_active ? "good" : "bad"}>
              {overview.plan_active ? "live" : "not live"}
            </Badge>
          }
        >
          <ActionForm action={assignPlan} closeOnSuccess={false}>
            <input type="hidden" name="user_id" value={id} />
            <div className="space-y-4">
              <Field label="Assigned plan" name="plan_id">
                <Select name="plan_id" defaultValue={overview.plan_id ?? ""}>
                  <option value="">No plan — searches refused</option>
                  {planList.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                      {plan.is_active ? "" : " (archived)"}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Expires on"
                name="plan_expires_on"
                hint="Blank means no expiry. A past date blocks every search."
              >
                <Input
                  name="plan_expires_on"
                  type="date"
                  defaultValue={overview.plan_expires_on ?? ""}
                />
              </Field>

              <Checkbox
                name="grant_included_credits"
                label="Also hand over the credits the plan includes"
                hint="Tick this when you are opening or renewing a paid-for account. Leave it clear when you are only correcting a date, or the balance goes up for no reason."
              />
            </div>
            <FormActions>
              <SubmitButton>Save plan</SubmitButton>
            </FormActions>
          </ActionForm>

          {currentPlan ? (
            <dl className="mt-4 border-t border-divider pt-3">
              <DescRow label="Assigned">{fmtDateTime(overview.plan_assigned_at)}</DescRow>
              <DescRow label="Price">
                {currentPlan.price_per_month > 0
                  ? `Rs ${currentPlan.price_per_month} a month`
                  : "Free"}
              </DescRow>
              <DescRow label="Credits included">
                {formatCredits(currentPlan.included_credits)}
              </DescRow>
            </dl>
          ) : null}
        </Panel>

        <Panel title="Danger zone" className="border-bad-500/30">
          <p className="text-xs leading-relaxed text-muted">
            Deleting removes the sign-in, every tracked truck, all toll crossings, search history and
            alerts for this account. There is no undo. Suspending, from the button at the top of the
            page, stops everything without losing anything.
          </p>
          <div className="mt-3">
            <Modal
              triggerLabel="Delete account"
              triggerIcon={<Trash2 size={13} />}
              triggerVariant="danger"
              triggerSize="sm"
              title="Delete this account"
              description="Everything belonging to it is removed."
              width="sm"
            >
              <ActionForm action={deleteAccount} closeOnSuccess={false}>
                <input type="hidden" name="user_id" value={id} />
                <Field label="Type the email to confirm" name="confirm_email" hint={overview.email}>
                  <Input name="confirm_email" autoComplete="off" placeholder={overview.email} />
                </Field>
                <FormActions>
                  <SubmitButton variant="danger" pendingLabel="Deleting...">
                    Delete permanently
                  </SubmitButton>
                </FormActions>
              </ActionForm>
            </Modal>
          </div>
        </Panel>
      </div>
    </div>
  );
}
