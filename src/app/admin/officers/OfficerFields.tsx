import { Field, FormGrid, Input, Select, Textarea } from "@/components/form";
import type { Plan, Profile } from "@/lib/types";

/**
 * Identity fields for an officer. Used by the create modal and the edit form on
 * the officer detail page. `mode` decides whether email/password/plan appear.
 */
export function OfficerFields({
  officer,
  plans,
  mode,
}: {
  officer?: Profile;
  plans?: Plan[];
  mode: "create" | "edit";
}) {
  return (
    <div className="space-y-4">
      {mode === "create" ? (
        <FormGrid cols={2}>
          <Field label="Email" name="email" hint="This is their login id.">
            <Input
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="officer@gujaratgst.gov.in"
            />
          </Field>
          <Field
            label="Password"
            name="password"
            hint="Leave blank and a strong one is generated and shown once."
          >
            <Input
              name="password"
              type="text"
              autoComplete="off"
              minLength={8}
              placeholder="auto-generate"
            />
          </Field>
        </FormGrid>
      ) : null}

      <FormGrid cols={2}>
        <Field label="Full name" name="full_name">
          <Input
            name="full_name"
            required
            defaultValue={officer?.full_name ?? ""}
            placeholder="R. K. Patel"
          />
        </Field>
        <Field label="Designation" name="designation">
          <Input
            name="designation"
            defaultValue={officer?.designation ?? ""}
            placeholder="State Tax Officer"
          />
        </Field>
      </FormGrid>

      <FormGrid cols={2}>
        <Field label="Office" name="office">
          <Input
            name="office"
            defaultValue={officer?.office ?? ""}
            placeholder="Ahmedabad GST — Ghatak 12"
          />
        </Field>
        <Field label="Phone" name="phone" hint="For your records. Alerts go over Telegram.">
          <Input name="phone" defaultValue={officer?.phone ?? ""} placeholder="+91 98250 00000" />
        </Field>
      </FormGrid>

      <FormGrid cols={2}>
        <Field label="District" name="district">
          <Input name="district" defaultValue={officer?.district ?? ""} placeholder="Ahmedabad" />
        </Field>
        <Field label="State" name="state">
          <Input name="state" defaultValue={officer?.state ?? "Gujarat"} placeholder="Gujarat" />
        </Field>
      </FormGrid>

      {mode === "create" && plans ? (
        <FormGrid cols={2}>
          <Field
            label="Plan"
            name="plan_id"
            hint="Leave on the default and the account picks up the default plan and its credits by itself. You can change it any time."
          >
            <Select name="plan_id" defaultValue="">
              <option value="">Default plan (set in Settings)</option>
              {plans
                .filter((plan) => plan.is_active)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Plan expires on"
            name="plan_expires_on"
            hint="Optional. After this date all searches are refused."
          >
            <Input name="plan_expires_on" type="date" />
          </Field>
        </FormGrid>
      ) : null}

      {mode === "create" ? (
        <FormGrid cols={2}>
          <Field
            label="Telegram chat id"
            name="telegram_chat_id"
            hint="Optional now. Officer sends /start to your bot to get it."
          >
            <Input name="telegram_chat_id" placeholder="123456789" />
          </Field>
          <Field
            label="Google Sheet URL"
            name="sheet_url"
            hint="Optional. Must be shared with your service account."
          >
            <Input name="sheet_url" placeholder="https://docs.google.com/spreadsheets/d/..." />
          </Field>
        </FormGrid>
      ) : null}

      <Field label="Internal notes" name="notes" hint="Only you can see this.">
        <Textarea
          name="notes"
          rows={2}
          defaultValue={officer?.notes ?? ""}
          placeholder="Charges collected in cash for FY 26-27. Renewal due April."
        />
      </Field>
    </div>
  );
}
