import { Trash2 } from "lucide-react";

import { OverridesPanel } from "./OverridesPanel";
import { AccountFields } from "../AccountFields";
import { assignPlan, deleteAccount, saveAccountIntegrations, updateAccount } from "../actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { TelegramChatIdInfo } from "@/components/TelegramChatIdInfo";
import { Badge, DescRow, Panel } from "@/components/ui";
import { formatCredits, planChargeInr, planTermSuffix } from "@/lib/credits";
import { fmtDateTime, fmtRelative, fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  GoogleSheetConfig,
  LimitOverrides,
  OfficerOverview,
  Plan,
  Profile,
  TelegramConfig,
} from "@/lib/types";

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

  const [{ data: profile }, { data: plans }, { data: overrides }, { data: telegram }, { data: sheet }] =
    await Promise.all([
      admin.from("profiles").select("*").eq("id", id).maybeSingle<Profile>(),
      admin.from("plans").select("*").order("sort_order"),
      admin
        .from("user_limit_overrides")
        .select("*")
        .eq("user_id", id)
        .maybeSingle<LimitOverrides>(),
      admin.from("telegram_configs").select("*").eq("user_id", id).maybeSingle<TelegramConfig>(),
      admin
        .from("google_sheet_configs")
        .select("*")
        .eq("user_id", id)
        .maybeSingle<GoogleSheetConfig>(),
    ]);

  const planList = (plans ?? []) as Plan[];
  const currentPlan = planList.find((plan) => plan.id === overview.plan_id) ?? null;

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
      <div className="space-y-5">
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
          title="Alerts & backup"
          description="Where this account's alerts go, and where its history is copied. Fill either in for them, or let them do it from their own dashboard."
        >
          <ActionForm action={saveAccountIntegrations} closeOnSuccess={false}>
            <input type="hidden" name="user_id" value={id} />
            <div className="space-y-4">
              {/* The same three steps the customer sees on their own settings
                  page, so an admin filling this in for somebody can read them
                  the identical instructions instead of a paraphrase. */}
              <div>
                <LabelWithInfo
                  label="Telegram chat id"
                  htmlFor="telegram_chat_id"
                  info={<TelegramChatIdInfo />}
                />
                <Input
                  id="telegram_chat_id"
                  name="telegram_chat_id"
                  defaultValue={telegram?.chat_id ?? ""}
                  placeholder="123456789"
                  className="mt-1.5"
                />
              </div>

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

              {/*
                The per-account backup sheet. Its absence is the reason this is
                here: an account that skipped it at signup had nowhere to be
                given one except the platform-wide fallback, where every
                account's rows pile into a single file.
              */}
              <div className="border-t border-divider pt-4">
                <Field
                  label="Backup Google Sheet"
                  name="sheet_url"
                  hint="Paste the whole share link. Their exported history is copied here before old rows are purged."
                >
                  <Input
                    name="sheet_url"
                    defaultValue={sheet?.sheet_url ?? ""}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                  />
                </Field>

                <div className="mt-3">
                  <Checkbox
                    name="sheet_is_enabled"
                    label="Copy this account's history to the sheet"
                    defaultChecked={sheet?.is_enabled ?? true}
                  />
                </div>
              </div>
            </div>
            <FormActions>
              <SubmitButton>Save alerts & backup</SubmitButton>
            </FormActions>
          </ActionForm>

          <dl className="mt-4 border-t border-divider pt-3">
            <DescRow label="Telegram verified">{fmtRelative(telegram?.verified_at)}</DescRow>
            {telegram?.last_error ? (
              <DescRow label="Telegram error">
                <span className="text-bad-500">{telegram.last_error}</span>
              </DescRow>
            ) : null}
            <DescRow label="Sheet last copied">
              {sheet?.spreadsheet_id ? fmtRelative(sheet.last_synced_at) : "no sheet set"}
            </DescRow>
            {sheet?.last_error ? (
              <DescRow label="Sheet error">
                <span className="text-bad-500">{sheet.last_error}</span>
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
              {/* Price and term together, both from the helpers - so this row
                  cannot say "a month" about a plan that runs ninety days. */}
              <DescRow label="Price">
                {currentPlan.price_inr > 0
                  ? `${fmtRupees(planChargeInr(currentPlan))} ${planTermSuffix(currentPlan)}`
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
