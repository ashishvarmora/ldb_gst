import { headers } from "next/headers";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DatabaseBackup,
  Globe,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  runBackupNow,
  runTrackingNow,
  saveBackupSettings,
  savePaymentSettings,
  saveSettings,
  saveSiteSettings,
} from "./actions";
import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, FormGrid, Input, Textarea } from "@/components/form";
import { Badge, DescRow, Mono, PageHeader, Panel } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { env, integrationHealth } from "@/lib/env";
import { fmtRelative } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
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

  // Raw rows for the panels that still need to tell "absent" from "off", and the
  // resolved object for the Site panel, whose defaults live in loadSettings().
  const [{ data: rows }, { data: plans }, site, headerList] = await Promise.all([
    admin.from("app_settings").select("key, value"),
    admin.from("plans").select("*").eq("is_active", true).order("sort_order"),
    loadSettings(admin),
    headers(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    (rows ?? []).map((row) => [row.key, row.value]),
  );
  const planList = (plans ?? []) as Plan[];
  const health = integrationHealth();

  const trackingEnabled = settings.tracking_enabled !== false;
  const razorpayEnabled = settings.razorpay_enabled === true;
  const razorpayKeyId = text(settings, "razorpay_key_id", "");

  const backupSheetId = text(settings, "backup_sheet_id", "");
  const retentionDays = num(settings, "data_retention_days", 30);
  const backupEvery = num(settings, "backup_interval_days", 7);
  const purgeEnabled = settings.purge_enabled !== false;
  const keepForEver = retentionDays === -1;
  // The one combination that loses data on purpose, and the reason the panel
  // below shouts rather than hints.
  const deletingWithNoCopy = purgeEnabled && !keepForEver && !backupSheetId;

  // Read straight from the environment. Only this yes/no reaches the page - the
  // secret itself must never be rendered anywhere.
  const razorpaySecretSet = Boolean(process.env.RAZORPAY_KEY_SECRET);

  // The address an outside scheduler has to call. Taken from the request so it
  // is right in every environment instead of being a guess in the copy.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const cronUrl = host ? `${proto}://${host}/api/cron/track` : "https://your-app/api/cron/track";

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`Platform-wide. Everything here applies to ${site.brandName} as a whole — there is nothing per customer on this page.`}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title="Site"
            description="What the product calls itself, whether anyone may register, and how to reach you. All of it is shown to people who are not signed in."
          >
            <ActionForm action={saveSiteSettings} closeOnSuccess={false}>
              <div className="space-y-4">
                <Field
                  label="Product name"
                  name="brand_name"
                  hint="Used everywhere the product names itself — the sign-in page, the footer, page titles and emails."
                >
                  <Input
                    name="brand_name"
                    required
                    maxLength={60}
                    defaultValue={site.brandName}
                    placeholder="Truck Watch"
                    autoComplete="off"
                  />
                </Field>

                <Checkbox
                  name="signup_enabled"
                  label="Anyone may create an account"
                  hint="Off hides and refuses public registration. Existing customers are unaffected, and you can still create accounts from the Customers page."
                  defaultChecked={site.signupEnabled}
                />

                <FormGrid cols={2}>
                  <Field
                    label="Support email"
                    name="support_email"
                    hint="Shown in the public footer. Leave blank to show no email at all."
                  >
                    <Input
                      name="support_email"
                      type="email"
                      defaultValue={site.supportEmail}
                      placeholder="help@example.com"
                      autoComplete="off"
                    />
                  </Field>

                  <Field
                    label="Support phone"
                    name="support_phone"
                    hint="Shown in the public footer. Blank means no number is published."
                  >
                    <Input
                      name="support_phone"
                      defaultValue={site.supportPhone}
                      placeholder="+91 98250 00000"
                      autoComplete="off"
                    />
                  </Field>
                </FormGrid>

                <Field
                  label="Postal address"
                  name="support_address"
                  hint="Shown in the public footer. Payment providers usually want a real address on the site."
                >
                  <Textarea
                    name="support_address"
                    rows={2}
                    maxLength={300}
                    defaultValue={site.supportAddress}
                    placeholder="12 Ring Road, Ahmedabad 380015"
                  />
                </Field>

                <FormGrid cols={2}>
                  <Field
                    label="Privacy policy link"
                    name="privacy_url"
                    hint="Linked from the footer and the sign-up page. Blank hides the link."
                  >
                    <Input
                      name="privacy_url"
                      type="url"
                      defaultValue={site.privacyUrl}
                      placeholder="https://example.com/privacy"
                      autoComplete="off"
                    />
                  </Field>

                  <Field
                    label="Terms link"
                    name="terms_url"
                    hint="Linked from the footer and the sign-up page. Blank hides the link."
                  >
                    <Input
                      name="terms_url"
                      type="url"
                      defaultValue={site.termsUrl}
                      placeholder="https://example.com/terms"
                      autoComplete="off"
                    />
                  </Field>
                </FormGrid>

                <p className="flex items-start gap-2.5 rounded-lg border border-line/70 bg-panel/50 p-4 text-xs leading-relaxed text-muted">
                  <Globe size={15} className="mt-0.5 shrink-0 text-brand-500" />
                  <span>
                    Every blank box above simply disappears from the public pages, so it is safe to
                    leave one empty until you have the real answer. Closing sign-up is the switch to
                    reach for while you are still setting prices — nobody can register, and you can
                    still make accounts by hand.
                  </span>
                </p>
              </div>

              <FormActions>
                <SubmitButton>Save site settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

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
                  hint="Turn off to pause every customer's background checking at once, without touching their plans or credits."
                  defaultChecked={trackingEnabled}
                />

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
                    className="max-w-40"
                  />
                </Field>

                <Field
                  label="Same plaza counts as the same crossing for (minutes)"
                  name="revisit_minutes"
                  hint="A toll plaza reports one crossing several times over. Inside this window a repeat is ignored; past it, the truck has come back and that is a new crossing worth alerting on. Raise it if return trips are being reported twice; lower it if a same-day round trip is being missed."
                >
                  <Input
                    name="revisit_minutes"
                    type="number"
                    min={5}
                    max={1440}
                    defaultValue={num(settings, "revisit_minutes", 90)}
                    className="max-w-40"
                  />
                </Field>
              </div>

              <FormActions>
                <SubmitButton>Save settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel
            title="Backup and retention"
            description="One sheet you own, written on a schedule, holding the crossings the database no longer keeps."
          >
            <ActionForm action={saveBackupSettings} closeOnSuccess={false}>
              <div className="space-y-4">
                <Field
                  label="Backup sheet"
                  name="backup_sheet_id"
                  hint="Paste the whole Google Sheets address; only the id is stored. Leave empty if you do not want a backup."
                >
                  <Input
                    name="backup_sheet_id"
                    defaultValue={backupSheetId}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    autoComplete="off"
                  />
                </Field>

                <FormGrid cols={2}>
                  <Field
                    label="Back up every (days)"
                    name="backup_interval_days"
                    hint="Checked at the end of a tracking sweep, so it runs on the next sweep after it falls due."
                  >
                    <Input
                      name="backup_interval_days"
                      type="number"
                      min={1}
                      max={365}
                      defaultValue={backupEvery}
                    />
                  </Field>

                  <Field
                    label="Keep history for (days)"
                    name="data_retention_days"
                    hint="Anything older than this is removed from the database. -1 keeps everything for ever."
                  >
                    <Input
                      name="data_retention_days"
                      type="number"
                      min={-1}
                      max={3650}
                      defaultValue={retentionDays}
                    />
                  </Field>
                </FormGrid>

                <Checkbox
                  name="purge_enabled"
                  label="Do this automatically"
                  hint="Off means old rows stay in the database until you press Run backup now."
                  defaultChecked={purgeEnabled}
                />

                <div
                  className={
                    deletingWithNoCopy
                      ? "rounded-lg border border-bad-500/50 bg-bad-500/10 p-4"
                      : "rounded-lg border border-line/70 bg-panel/50 p-4"
                  }
                >
                  <p
                    className={
                      deletingWithNoCopy
                        ? "flex items-center gap-2 text-sm font-medium text-bad-500"
                        : "flex items-center gap-2 text-sm font-medium text-ink"
                    }
                  >
                    {deletingWithNoCopy ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
                    {deletingWithNoCopy
                      ? "Old crossings are being deleted with no copy kept"
                      : "What actually happens"}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Every {backupEvery} day{backupEvery === 1 ? "" : "s"}, crossings older than{" "}
                    {keepForEver ? "the retention window" : `${retentionDays} days`} are copied to
                    the sheet above and then deleted from the database. Search logs and alert logs
                    older than the same window are deleted too — they are never copied.
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    <span className={deletingWithNoCopy ? "text-bad-500" : "text-ink"}>
                      If no sheet is set, nothing is backed up and the old rows are simply deleted.
                    </span>{" "}
                    There is no other copy and it cannot be undone. If the sheet is set but cannot be
                    written, nothing is deleted at all — a broken backup never turns into a deletion.
                  </p>
                  {health.googleSheets ? (
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      Share the sheet as <strong>Editor</strong> with{" "}
                      <Mono className="text-xs break-all text-ink">
                        {env.googleServiceAccountEmail}
                      </Mono>{" "}
                      or the app cannot write to it.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-warn-500">
                      No Google service account is configured, so no sheet can be written. Set
                      GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY first.
                    </p>
                  )}
                </div>
              </div>

              <FormActions>
                <SubmitButton>Save backup settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel
            title="Scheduling the worker"
            description="Nothing in this project schedules itself. An outside scheduler has to call the worker."
          >
            <div className="space-y-3 text-xs leading-relaxed text-muted">
              <p>
                Set up a job at <strong>cron-job.org</strong> (or any scheduler) that calls this
                address every 5 minutes. There is no Vercel cron and no GitHub Action any more — if
                nothing calls this, no truck is ever checked.
              </p>

              <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
                <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">URL</p>
                <Mono className="mt-1 block text-xs break-all text-ink">{cronUrl}</Mono>

                <p className="mt-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Request header
                </p>
                <Mono className="mt-1 block text-xs break-all text-ink">
                  Authorization: Bearer &lt;CRON_SECRET&gt;
                </Mono>

                <p className="mt-3 text-xs text-muted">
                  <Mono>CRON_SECRET</Mono> is the value in your environment.{" "}
                  {health.cron
                    ? "It is set here, so the worker will accept the call."
                    : "It is not set here, so the worker refuses every call until it is."}{" "}
                  A GET or a POST both work.
                </p>
              </div>

              <p>
                The scheduler needs no other setting. Add <Mono>?batch=50</Mono> to the address only
                if a run is timing out and you want smaller bites.
              </p>
            </div>
          </Panel>

          <Panel
            title="Customer payments"
            description="Razorpay, so customers can buy a plan and top up their credits themselves instead of settling with you offline."
          >
            <ActionForm action={savePaymentSettings} closeOnSuccess={false}>
              <div className="space-y-4">
                <Checkbox
                  name="razorpay_enabled"
                  label="Customers may pay online"
                  hint="Off means there is no online payment at all — plans and credits arrive only when you assign or add them by hand."
                  defaultChecked={razorpayEnabled}
                />

                <Field
                  label="Razorpay key id"
                  name="razorpay_key_id"
                  hint="Starts with rzp_. This is the public half of the pair and is safe to store."
                >
                  <Input
                    name="razorpay_key_id"
                    autoComplete="off"
                    defaultValue={razorpayKeyId}
                    placeholder="rzp_live_XXXXXXXXXXXX"
                  />
                </Field>

                <div className="rounded-lg border border-warn-500/40 bg-warn-500/10 p-4">
                  <p className="text-sm font-medium text-warn-500">
                    The key secret never goes in this form
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    It belongs in the environment as <Mono>RAZORPAY_KEY_SECRET</Mono>, alongside the
                    other server keys. Anything typed into a settings box is stored in the database
                    and read back by this page — fine for the key id, never for the secret.{" "}
                    {razorpaySecretSet
                      ? "RAZORPAY_KEY_SECRET is set in this environment."
                      : "RAZORPAY_KEY_SECRET is not set in this environment."}
                  </p>
                </div>

                <p className="rounded-lg border border-line/70 bg-panel/50 p-4 text-xs leading-relaxed text-muted">
                  <span className="text-ink">What a payment buys is not set here.</span> Plans carry
                  their own monthly price, and the credit packs on the Credits page are the top-up
                  price list. This panel only decides whether anyone may pay in the app at all.
                </p>
              </div>

              <FormActions>
                <SubmitButton>Save payment settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel
            title="What a customer has to give you"
            description="Nothing sensitive. You hold the credentials; the customer supplies one thing."
          >
            <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
              <p className="text-sm font-medium text-ink">Telegram chat id</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                You run one bot for the whole platform. The customer sends it <Mono>/start</Mono> —
                Telegram only allows a bot to message someone who has started it. Then read their
                numeric chat id with <Mono>node scripts/get-telegram-chat-id.mjs</Mono>, or have them
                fetch it from <Mono>@userinfobot</Mono>. Paste it on their account page. Never ask
                for a phone number — Telegram alerts do not use it.
              </p>
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
                detail="Needed to create customer accounts"
              />
              <HealthRow
                ok={health.telegram}
                label="Platform Telegram bot"
                detail="TELEGRAM_BOT_TOKEN"
              />
              <HealthRow
                ok={health.googleSheets}
                label="Google service account"
                detail="Writes the backup sheet"
              />
              <HealthRow
                ok={health.cron}
                label="Cron secret"
                detail="CRON_SECRET, what your scheduler sends"
              />
              <HealthRow
                ok={razorpaySecretSet}
                label="Razorpay key secret"
                detail="RAZORPAY_KEY_SECRET, needed before anyone can pay"
              />
            </ul>
          </Panel>

          <Panel
            title="Run the worker now"
            description="Polls every truck that is due, right now, instead of waiting for the scheduled call."
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
              Exactly the code path <Mono>/api/cron/track</Mono> runs.
            </p>
          </Panel>

          <Panel
            title="Run backup now"
            description="Copies old crossings to the sheet, then deletes them. Ignores the interval and the automatic switch."
          >
            <div className="flex items-start gap-2.5">
              <DatabaseBackup size={16} className="mt-0.5 shrink-0 text-brand-500" />
              <p className="text-xs leading-relaxed text-muted">
                {keepForEver
                  ? "History is set to be kept for ever, so this will do nothing."
                  : backupSheetId
                    ? `Crossings older than ${retentionDays} days are written to the sheet and then removed, along with search and alert logs of the same age.`
                    : `No sheet is set, so crossings older than ${retentionDays} days are deleted with no copy kept.`}
              </p>
            </div>

            <ActionForm action={runBackupNow} closeOnSuccess={false}>
              <FormActions>
                <ConfirmSubmitButton
                  message={
                    backupSheetId
                      ? "Copy old records to the backup sheet and then delete them from the database?"
                      : "No backup sheet is set. Old records will be deleted with no copy kept. Continue?"
                  }
                  size="md"
                >
                  <DatabaseBackup size={14} />
                  Back up and clear
                </ConfirmSubmitButton>
              </FormActions>
            </ActionForm>

            <p className="mt-3 flex items-center gap-1.5 border-t border-divider pt-3 text-[11px] leading-relaxed text-faint">
              <Clock size={12} className="shrink-0" />
              Last run:{" "}
              {typeof settings.last_backup_at === "string"
                ? fmtRelative(settings.last_backup_at)
                : "never"}
            </p>
          </Panel>

          <Panel title="Current values" description="Exactly what the site and the worker will read.">
            <dl>
              <DescRow label="Product name">{site.brandName}</DescRow>
              <DescRow label="Public sign-up">
                <Badge tone={site.signupEnabled ? "good" : "neutral"}>
                  {site.signupEnabled ? "open" : "closed"}
                </Badge>
              </DescRow>
              <DescRow label="Support email">{site.supportEmail || "not shown"}</DescRow>
              <DescRow label="Support phone">{site.supportPhone || "not shown"}</DescRow>
              <DescRow label="Policies">
                {site.privacyUrl || site.termsUrl
                  ? [site.privacyUrl ? "privacy" : null, site.termsUrl ? "terms" : null]
                      .filter(Boolean)
                      .join(" · ")
                  : "none linked"}
              </DescRow>
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
              <DescRow label="Same-plaza window">
                {num(settings, "revisit_minutes", 90)} min
              </DescRow>
              <DescRow label="Retention">
                {keepForEver ? "kept for ever" : `${retentionDays} days`}
              </DescRow>
              <DescRow label="Backup every">{backupEvery} days</DescRow>
              <DescRow label="Backup sheet">
                {backupSheetId ? (
                  <Mono className="text-xs break-all">{backupSheetId}</Mono>
                ) : (
                  <Badge tone={deletingWithNoCopy ? "bad" : "neutral"}>none — no copy kept</Badge>
                )}
              </DescRow>
              <DescRow label="Automatic">
                <Badge tone={purgeEnabled ? "good" : "neutral"}>{purgeEnabled ? "on" : "off"}</Badge>
              </DescRow>
              <DescRow label="Plans on sale">{planList.length}</DescRow>
              <DescRow label="Online payment">
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
