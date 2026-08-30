import { CheckCircle2, Copy, Database, PlayCircle, Trash2, XCircle } from "lucide-react";

import { purgeOldDataNow, runTrackingNow, savePaymentSettings, saveSettings } from "./actions";
import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, FormGrid, Input, Select } from "@/components/form";
import { Badge, DescRow, Mono, PageHeader, Panel } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { env, integrationHealth } from "@/lib/env";
import { fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Plan } from "@/lib/types";

export const metadata = { title: "Settings — Admin" };

type SettingsMap = Record<string, unknown>;

function num(settings: SettingsMap, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === "number" ? value : fallback;
}

function text(settings: SettingsMap, key: string, fallback: string): string {
  const value = settings[key];
  return typeof value === "string" ? value : fallback;
}

export default async function SettingsPage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const [{ data: rows }, { data: plans }] = await Promise.all([
    admin.from("app_settings").select("key, value"),
    admin.from("plans").select("*").eq("is_active", true).order("sort_order"),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    (rows ?? []).map((row) => [row.key, row.value]),
  );
  const planList = (plans ?? []) as Plan[];
  const health = integrationHealth();

  const trackingEnabled = settings.tracking_enabled !== false;
  const razorpayEnabled = settings.razorpay_enabled === true;
  const razorpayKeyId = text(settings, "razorpay_key_id", "");

  // Read straight from the environment. Only this yes/no reaches the page - the
  // secret itself must never be rendered anywhere.
  const razorpaySecretSet = Boolean(process.env.RAZORPAY_KEY_SECRET);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Platform-wide defaults. Anything set on a plan or an individual officer wins over these."
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title="Tracking engine"
            description="Applies to the background worker, which checks a truck whenever one of its alerts falls due."
          >
            <ActionForm action={saveSettings} closeOnSuccess={false}>
              <div className="space-y-4">
                <Field
                  label="LDB API endpoint"
                  name="ldb_api_url"
                  hint="Change only if the portal moves. The worker POSTs { vehiclenumber } here."
                >
                  <Input
                    name="ldb_api_url"
                    defaultValue={text(settings, "ldb_api_url", env.ldbApiUrl)}
                  />
                </Field>

                <Checkbox
                  name="tracking_enabled"
                  label="Background tracking is running"
                  hint="Turn off to pause every officer's background checking at once, without touching their plans or credits."
                  defaultChecked={trackingEnabled}
                />

                <FormGrid cols={2}>
                  <Field
                    label="Default plan for new officers"
                    name="default_plan_name"
                    hint="Assigned automatically the moment an officer account is created, along with the credits that plan includes."
                  >
                    <Select
                      name="default_plan_name"
                      defaultValue={text(settings, "default_plan_name", "")}
                    >
                      <option value="">None</option>
                      {planList.map((plan) => (
                        <option key={plan.id} value={plan.name}>
                          {plan.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </FormGrid>

                <div className="border-t border-divider pt-4">
                  <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
                    Truck status
                  </p>
                  <FormGrid cols={2}>
                    <Field
                      label="Treat as no activity after (hours)"
                      name="no_activity_hours"
                      hint="A tracked truck that crosses no toll for this long is shown as no activity rather than idle."
                    >
                      <Input
                        name="no_activity_hours"
                        type="number"
                        min={1}
                        max={168}
                        defaultValue={num(settings, "no_activity_hours", 6)}
                      />
                    </Field>
                  </FormGrid>
                </div>

                <div className="border-t border-divider pt-4">
                  <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
                    Data retention
                  </p>
                  <FormGrid cols={2}>
                    <Field
                      label="Default: keep history for (days)"
                      name="data_retention_days"
                      hint="The starting point for new plans. Each plan, and each officer, can override it."
                    >
                      <Input
                        name="data_retention_days"
                        type="number"
                        min={1}
                        max={3650}
                        defaultValue={num(settings, "data_retention_days", 30)}
                      />
                    </Field>
                    <Checkbox
                      name="purge_enabled"
                      label="Clear old records automatically"
                      hint="Runs once a day at the end of a tracking sweep."
                      defaultChecked={settings.purge_enabled !== false}
                    />
                  </FormGrid>
                </div>
              </div>

              <FormActions>
                <SubmitButton>Save settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel
            title="Officer payments"
            description="Razorpay, so officers can buy their own credits instead of settling with you offline."
          >
            <ActionForm action={savePaymentSettings} closeOnSuccess={false}>
              <div className="space-y-4">
                <Checkbox
                  name="razorpay_enabled"
                  label="Officers may buy credits online"
                  hint="Off means credits only ever arrive from you, on the officer's page."
                  defaultChecked={settings.razorpay_enabled === true}
                />

                <FormGrid cols={2}>
                  <Field
                    label="Razorpay key id"
                    name="razorpay_key_id"
                    hint="Starts with rzp_. This is the public half of the pair and is safe to store."
                  >
                    <Input
                      name="razorpay_key_id"
                      autoComplete="off"
                      defaultValue={text(settings, "razorpay_key_id", "")}
                      placeholder="rzp_live_XXXXXXXXXXXX"
                    />
                  </Field>

                  <Field
                    label="Price per credit (Rs)"
                    name="credit_price_inr"
                    hint="What one credit costs an officer. Also used to value the balances on the credits page."
                  >
                    <Input
                      name="credit_price_inr"
                      type="number"
                      min={1}
                      max={100000}
                      step="0.5"
                      defaultValue={num(settings, "credit_price_inr", 10)}
                    />
                  </Field>
                </FormGrid>

                <div className="rounded-lg border border-warn-500/40 bg-warn-500/10 p-4">
                  <p className="text-sm font-medium text-warn-500">
                    The key secret never goes in this form
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    It belongs in the environment as <Mono>RAZORPAY_KEY_SECRET</Mono>, alongside the
                    other server keys. Anything typed into a settings box is stored in the database
                    and read back by this page — fine for the key id, never for the secret.
                  </p>
                </div>

                <p className="rounded-lg border border-line/70 bg-panel/50 p-4 text-xs leading-relaxed text-muted">
                  <span className="text-ink">Switching this on does not take payments yet.</span>{" "}
                  There is no checkout in the app: the key id and price are stored so that everything
                  is ready, and nothing more happens until the secret is set and the checkout is
                  built.{" "}
                  {razorpaySecretSet
                    ? "RAZORPAY_KEY_SECRET is set in this environment."
                    : "RAZORPAY_KEY_SECRET is not set in this environment."}{" "}
                  Until then, top officers up by hand from their own page.
                </p>
              </div>

              <FormActions>
                <SubmitButton>Save payment settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel
            title="What officers need to give you"
            description="Nothing sensitive. You hold the credentials; the officer only supplies two things."
          >
            <div className="space-y-4 text-sm leading-relaxed text-muted">
              <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
                <p className="font-medium text-ink">1. Telegram chat id</p>
                <p className="mt-1 text-xs text-muted">
                  You run one bot for the whole platform. The officer sends it{" "}
                  <Mono>/start</Mono> — Telegram only allows a bot to message someone who has
                  started it. Then read their numeric chat id with{" "}
                  <Mono>node scripts/get-telegram-chat-id.mjs</Mono>, or have them fetch it from{" "}
                  <Mono>@userinfobot</Mono>. Paste it on the officer&apos;s page. Never ask for their
                  phone number — Telegram alerts do not use it.
                </p>
              </div>

              <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
                <p className="font-medium text-ink">2. Google Sheet link</p>
                <p className="mt-1 text-xs text-muted">
                  The officer creates a blank sheet, shares it as <strong>Editor</strong> with your
                  service account below, and sends you the link. No Apps Script, no OAuth screen, no
                  credentials from them.
                </p>
                {health.googleSheets ? (
                  <p className="mt-2 flex items-center gap-2 rounded-md border border-line bg-page/60 px-2.5 py-1.5">
                    <Copy size={12} className="shrink-0 text-faint" />
                    <Mono className="text-xs break-all text-ink">
                      {env.googleServiceAccountEmail}
                    </Mono>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-warn-500">
                    No service account configured yet. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and
                    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, then this shows the address to share sheets
                    with.
                  </p>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Connection health" description="Read from environment variables at runtime.">
            <ul className="space-y-2.5">
              <HealthRow ok={health.supabase} label="Supabase project" detail="URL + anon key" />
              <HealthRow
                ok={health.serviceRole}
                label="Service role key"
                detail="Needed to create officer accounts"
              />
              <HealthRow
                ok={health.telegram}
                label="Platform Telegram bot"
                detail="TELEGRAM_BOT_TOKEN"
              />
              <HealthRow
                ok={health.googleSheets}
                label="Google service account"
                detail="Sheet sync"
              />
              <HealthRow ok={health.cron} label="Cron secret" detail="Protects the tracking worker" />
              <HealthRow
                ok={razorpaySecretSet}
                label="Razorpay key secret"
                detail="RAZORPAY_KEY_SECRET, needed before any officer can pay"
              />
            </ul>
          </Panel>

          <Panel
            title="Run the worker now"
            description="Polls every truck that is due, right now, instead of waiting for the next cron tick."
          >
            <ActionForm action={runTrackingNow} closeOnSuccess={false}>
              <Field
                label="Trucks to check"
                name="batch"
                hint="Keep it small the first time so a portal problem does not burn everyone's credits."
              >
                <Input
                  name="batch"
                  type="number"
                  min={1}
                  max={300}
                  defaultValue={20}
                  className="max-w-32"
                />
              </Field>
              <FormActions>
                <SubmitButton variant="secondary" pendingLabel="Running...">
                  <PlayCircle size={14} />
                  Run tracking sweep
                </SubmitButton>
              </FormActions>
            </ActionForm>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              The scheduled worker hits <Mono>/api/cron/track</Mono> every 5 minutes on Vercel. This
              button runs the same code path.
            </p>
          </Panel>

          <Panel
            title="Clear old records now"
            description="Trims each officer down to their own retention window."
          >
            <div className="flex items-start gap-2.5">
              <Database size={16} className="mt-0.5 shrink-0 text-brand-500" />
              <p className="text-xs leading-relaxed text-muted">
                Crossings, call logs and alerts older than the officer&apos;s retention are deleted.
                Their Google Sheet keeps everything, so this only trims the app&apos;s copy.
              </p>
            </div>

            <ActionForm action={purgeOldDataNow} closeOnSuccess={false}>
              <div className="mt-3">
                <Checkbox
                  name="force"
                  label="Include officers with no Google Sheet"
                  hint="Off by default. For them the app is the only copy, so clearing it loses the history for good."
                />
              </div>
              <FormActions>
                <ConfirmSubmitButton
                  message="Clear records older than each officer's retention window? This cannot be undone."
                  size="md"
                >
                  <Trash2 size={14} />
                  Clear old records
                </ConfirmSubmitButton>
              </FormActions>
            </ActionForm>

            <p className="mt-3 border-t border-divider pt-3 text-[11px] leading-relaxed text-faint">
              Last automatic run: {typeof settings.last_purge_at === "string"
                ? fmtRelative(settings.last_purge_at)
                : "never"}
            </p>
          </Panel>

          <Panel title="Current values" description="Exactly what the worker will read.">
            <dl>
              <DescRow label="LDB endpoint">
                <Mono className="text-xs break-all">
                  {text(settings, "ldb_api_url", env.ldbApiUrl)}
                </Mono>
              </DescRow>
              <DescRow label="Tracking">
                <Badge tone={trackingEnabled ? "good" : "bad"}>
                  {trackingEnabled ? "running" : "paused"}
                </Badge>
              </DescRow>
              <DescRow label="No-activity">{num(settings, "no_activity_hours", 6)} h</DescRow>
              <DescRow label="Default retention">
                {num(settings, "data_retention_days", 30)} days
              </DescRow>
              <DescRow label="Auto-clear">
                <Badge tone={settings.purge_enabled !== false ? "good" : "neutral"}>
                  {settings.purge_enabled !== false ? "on" : "off"}
                </Badge>
              </DescRow>
              <DescRow label="Active plans">{planList.length}</DescRow>
              <DescRow label="Price per credit">
                Rs {num(settings, "credit_price_inr", 10)}
              </DescRow>
              <DescRow label="Officer payments">
                <Badge tone={razorpayEnabled ? (razorpaySecretSet ? "good" : "warn") : "neutral"}>
                  {razorpayEnabled ? (razorpaySecretSet ? "on" : "on, no secret") : "off"}
                </Badge>
              </DescRow>
              {razorpayKeyId ? (
                <DescRow label="Razorpay key">
                  <Mono className="text-xs break-all">{razorpayKeyId}</Mono>
                </DescRow>
              ) : null}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

function HealthRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ? (
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good-500" />
      ) : (
        <XCircle size={15} className="mt-0.5 shrink-0 text-bad-500" />
      )}
      <span>
        <span className="block text-sm text-ink">{label}</span>
        <span className="block text-xs text-faint">{ok ? detail : `Not set — ${detail}`}</span>
      </span>
    </li>
  );
}
