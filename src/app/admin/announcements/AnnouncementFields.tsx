"use client";

import { useState } from "react";

import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/form";
import {
  AUDIENCE_LABELS,
  FREQUENCY_LABELS,
  type Announcement,
  type AnnouncementAudience,
} from "@/lib/announcement-rules";

/**
 * Every field of an announcement, shared by the create and edit forms.
 *
 * A client component for one reason: the plan picker and the customer box only
 * make sense for their own audience, and showing both all the time invited
 * filling in the wrong one. Everything else is a plain input the Server Action
 * reads.
 */
export function AnnouncementFields({
  announcement,
  plans,
  targetUsers = "",
}: {
  announcement?: Announcement;
  plans: { id: string; name: string; is_active: boolean }[];
  /** The chosen customers as emails, one per line - ids mean nothing to a reader. */
  targetUsers?: string;
}) {
  const [audience, setAudience] = useState<AnnouncementAudience>(announcement?.audience ?? "all");
  const pushSent = Boolean(announcement?.push_sent_at);

  return (
    <div className="space-y-4">
      <FormGrid>
        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input
            name="title"
            required
            maxLength={120}
            defaultValue={announcement?.title}
            placeholder="Diwali offer: 20% extra credits"
          />
        </Field>

        <Field
          label="Message"
          name="body"
          className="sm:col-span-2"
          hint="Plain text. Line breaks are kept. The phone notification shows the first 180 characters."
        >
          <Textarea name="body" maxLength={1000} rows={4} defaultValue={announcement?.body} />
        </Field>

        <Field label="Style" name="tone" hint="Colour only.">
          <Select name="tone" defaultValue={announcement?.tone ?? "info"}>
            <option value="info">Information (blue)</option>
            <option value="offer">Offer (brand)</option>
            <option value="success">Good news (green)</option>
            <option value="warning">Warning (amber)</option>
          </Select>
        </Field>

        <Field label="How often" name="frequency">
          <Select name="frequency" defaultValue={announcement?.frequency ?? "once"}>
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>

      <div>
        <p className="field-label">Where it appears</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Checkbox
            name="show_banner"
            label="Banner"
            hint="A strip under the header on every portal page."
            defaultChecked={announcement?.show_banner ?? true}
          />
          <Checkbox
            name="show_popup"
            label="Popup"
            hint="A box in the middle of the screen. One at a time."
            defaultChecked={announcement?.show_popup ?? false}
          />
          <Checkbox
            name="send_push"
            label="Phone notification"
            hint={
              pushSent
                ? "Already sent - it never goes twice."
                : "Sent once, at the start time, to every phone set up."
            }
            defaultChecked={announcement?.send_push ?? false}
          />
        </div>
      </div>

      <Checkbox
        name="dismissible"
        label="Customers can close it"
        hint="Off: a 'once' shows a single time, an 'always' stays on every page until it ends."
        defaultChecked={announcement?.dismissible ?? true}
      />

      <FormGrid>
        <Field label="Who sees it" name="audience" className="sm:col-span-2">
          <Select
            name="audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as AnnouncementAudience)}
          >
            {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        {audience === "plans" ? (
          <div className="sm:col-span-2">
            <p className="field-label">Plans</p>
            {plans.length === 0 ? (
              <p className="text-xs text-muted">There are no plans yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {plans.map((plan) => (
                  <label
                    key={plan.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5 text-sm text-ink hover:border-line-strong"
                  >
                    <input
                      type="checkbox"
                      name="target_plan_ids"
                      value={plan.id}
                      defaultChecked={announcement?.target_plan_ids?.includes(plan.id)}
                      className="size-4 shrink-0 accent-[color:var(--color-brand-500)]"
                    />
                    <span className="min-w-0 truncate">{plan.name}</span>
                    {plan.is_active ? null : <span className="text-xs text-faint">archived</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {audience === "users" ? (
          <Field
            label="Customers"
            name="target_users"
            className="sm:col-span-2"
            hint="Emails or mobile numbers, one per line or separated by commas. Any that match no account are named back to you and nothing is saved."
          >
            <Textarea
              name="target_users"
              rows={4}
              defaultValue={targetUsers}
              placeholder={"officer@example.com\n98765 43210"}
            />
          </Field>
        ) : null}

        <Field label="Starts (IST)" name="starts_at" hint="Blank means now.">
          <Input name="starts_at" type="datetime-local" defaultValue={istLocal(announcement?.starts_at)} />
        </Field>
        <Field label="Ends (IST)" name="ends_at" hint="Blank means it runs until you pause or delete it.">
          <Input name="ends_at" type="datetime-local" defaultValue={istLocal(announcement?.ends_at)} />
        </Field>

        <Field label="Button label" name="cta_label" hint="Optional. Needs a link too.">
          <Input
            name="cta_label"
            maxLength={40}
            defaultValue={announcement?.cta_label ?? ""}
            placeholder="Buy credits"
          />
        </Field>
        <Field label="Button link" name="cta_url" hint="A page here, like /portal/credits, or an https:// address.">
          <Input name="cta_url" defaultValue={announcement?.cta_url ?? ""} placeholder="/portal/credits" />
        </Field>
      </FormGrid>
    </div>
  );
}

/** A stored timestamp as the "YYYY-MM-DDTHH:mm" a datetime-local wants, in IST. */
function istLocal(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  // sv-SE writes "2026-10-19 18:30:00", which is one replace away.
  return d
    .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata", hour12: false })
    .replace(" ", "T")
    .slice(0, 16);
}
