import { Field, FormGrid, Input, Select, Textarea } from "@/components/form";
import { formatCredits } from "@/lib/credits";
import type { Plan, Profile } from "@/lib/types";

/**
 * Identity fields for one customer account. Shared by the create modal and the
 * edit form on the account page, so the two can never drift apart. `mode`
 * decides whether email, password and plan appear.
 *
 * The company and place fields are optional on purpose: anyone can sign up now,
 * and most people will fill in a name and nothing else.
 */
export function AccountFields({
  account,
  plans,
  mode,
}: {
  account?: Profile;
  plans?: Plan[];
  mode: "create" | "edit";
}) {
  return (
    <div className="space-y-4">
      {mode === "create" ? (
        <FormGrid cols={2}>
          <Field label="Email" name="email" hint="This is their sign-in id.">
            <Input
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="name@example.com"
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
            defaultValue={account?.full_name ?? ""}
            placeholder="R. K. Patel"
          />
        </Field>
        <Field label="Job title" name="designation" hint="Optional.">
          <Input
            name="designation"
            defaultValue={account?.designation ?? ""}
            placeholder="Fleet manager"
          />
        </Field>
      </FormGrid>

      <FormGrid cols={2}>
        <Field label="Company or organisation" name="office" hint="Optional.">
          <Input
            name="office"
            defaultValue={account?.office ?? ""}
            placeholder="Patel Roadlines"
          />
        </Field>
        <Field label="Phone" name="phone" hint="For your records. Alerts go over Telegram.">
          <Input name="phone" defaultValue={account?.phone ?? ""} placeholder="+91 98250 00000" />
        </Field>
      </FormGrid>

      <FormGrid cols={2}>
        <Field label="City or district" name="district">
          <Input name="district" defaultValue={account?.district ?? ""} placeholder="Ahmedabad" />
        </Field>
        <Field label="State" name="state">
          <Input name="state" defaultValue={account?.state ?? ""} placeholder="Gujarat" />
        </Field>
      </FormGrid>

      {mode === "create" && plans ? (
        <FormGrid cols={2}>
          <Field
            label="Plan"
            name="plan_id"
            hint="Picking one here hands over its included credits straight away. Leave it empty and the account can buy a plan itself."
          >
            <Select name="plan_id" defaultValue="">
              <option value="">No plan — they buy their own</option>
              {plans
                .filter((plan) => plan.is_active)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — {formatCredits(plan.included_credits)} credits
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Plan expires on"
            name="plan_expires_on"
            hint="Optional. After this date every search is refused."
          >
            <Input name="plan_expires_on" type="date" />
          </Field>
        </FormGrid>
      ) : null}

      {mode === "create" ? (
        <Field
          label="Telegram chat id"
          name="telegram_chat_id"
          hint="Optional now. They send /start to your bot to get it, and can fill it in themselves later."
        >
          <Input name="telegram_chat_id" placeholder="123456789" />
        </Field>
      ) : null}

      <Field label="Internal notes" name="notes" hint="Only you can see this.">
        <Textarea
          name="notes"
          rows={2}
          defaultValue={account?.notes ?? ""}
          placeholder="Pays by bank transfer. Renewal due April."
        />
      </Field>
    </div>
  );
}
