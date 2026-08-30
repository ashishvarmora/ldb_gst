import { CheckCircle2, Copy, Database, PlayCircle, Trash2, XCircle } from "lucide-react";

import { purgeOldDataNow, runTrackingNow, saveSettings } from "./actions";
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
            description="Applies to the background worker that polls LDB for every tracked truck."
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
                  hint="Turn off to pause every officer's polling at once, without touching their plans."
                  defaultChecked={trackingEnabled}
                />

                <FormGrid cols={2}>
                  <Field
                    label="Hard polling floor (minutes)"
                    name="global_polling_floor"
                    hint="No plan may poll faster than this, whatever its own setting says."
                  >
                    <Input
                      name="global_polling_floor"
                      type="number"
                      min={1}
                      max={1440}
                      defaultValue={num(settings, "global_polling_floor", 5)}
                    />
                  </Field>

                  <Field
                    label="Default plan for new officers"
                    name="default_plan_name"
                    hint="Pre-selected in the create-officer form."
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
                hint="Keep it small the first time so a portal problem does not burn everyone's quota."
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
              <DescRow label="Polling floor">
                {num(settings, "global_polling_floor", 5)} min
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
