import { headers } from "next/headers";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Globe,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  runTrackingNow,
  saveBackupSettings,
  saveNotificationSettings,
  savePaymentSettings,
  saveSettings,
  saveSiteSettings,
} from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { SectionTabs, activeSection, type Section } from "@/components/SectionTabs";
import { Checkbox, Field, FormActions, FormGrid, Input, Textarea } from "@/components/form";
import { Badge, DescRow, LinkButton, Mono, PageHeader, Panel } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { loadRetentionRules } from "@/lib/backup";
import { emailSenderProblem } from "@/lib/email";
import { env, integrationHealth } from "@/lib/env";
import { fmtRelative } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ALERT_BOT_USERNAME, ID_BOT_USERNAME } from "@/lib/telegram-bot";
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

const SETTINGS_SECTIONS: Section[] = [
  { key: "site", label: "Brand & site", hint: "Name, registration, support and legal links" },
  { key: "tracking", label: "Tracking", hint: "The engine, its schedule, and running it by hand" },
  { key: "payments", label: "Payments", hint: "Taking money, and what a customer must provide" },
  { key: "data", label: "Data & exports", hint: "Sheets, exporting and how long rows are kept" },
  { key: "health", label: "Health", hint: "Whether it is wired up, and the values in force" },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const section = activeSection(SETTINGS_SECTIONS, (await searchParams).section);
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  // Raw rows for the panels that still need to tell "absent" from "off", and the
  // resolved object for the Site panel, whose defaults live in loadSettings().
  const [{ data: rows }, { data: plans }, site, rules, headerList] = await Promise.all([
    admin.from("app_settings").select("key, value"),
    admin.from("plans").select("*").eq("is_active", true).order("sort_order"),
    loadSettings(admin),
    // Only counted here. The rules themselves are edited on /admin/storage, and
    // this page shows enough to tell whether anything is being deleted at all.
    loadRetentionRules(admin),
    headers(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    (rows ?? []).map((row) => [row.key, row.value]),
  );
  const planList = (plans ?? []) as Plan[];
  const health = integrationHealth();
  /* Why a password reset cannot reach a customer, or null. Its own line on
     the health panel because "the key is set" and "a stranger receives the
     mail" are different questions, and only the second one matters. */
  const emailProblem = emailSenderProblem();

  const trackingEnabled = settings.tracking_enabled !== false;
  const razorpayEnabled = settings.razorpay_enabled === true;
  const razorpayKeyId = text(settings, "razorpay_key_id", "");

  const backupSheetId = text(settings, "backup_sheet_id", "");
  const exportEvery = num(settings, "sheet_export_interval_days", 1);
  const purgeEnabled = settings.purge_enabled !== false;

  // Retention is per table now, so "is anything being deleted" is a question
  // about the rules rather than about one number on this page.
  const trimming = rules.filter((rule) => rule.is_enabled && rule.keep_days !== -1);
  const noCopy = trimming.filter((rule) => !rule.backup_before_delete);
  const protectedTrimmed = rules.filter((rule) => rule.is_protected && rule.keep_days !== -1);
  // A rule that wants a copy and has nowhere to put it keeps its rows, so this
  // is a warning about an export that is not happening, not about data loss.
  const noFallbackSheet = purgeEnabled && trimming.length > noCopy.length && !backupSheetId;

  // Read straight from the environment. Only this yes/no reaches the page - the
  // secret itself must never be rendered anywhere.
  const razorpaySecretSet = Boolean(process.env.RAZORPAY_KEY_SECRET);

  // The address an outside scheduler has to call. Taken from the request so it
  // is right in every environment instead of being a guess in the copy.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const cronUrl = host ? `${proto}://${host}/api/cron/track` : "https://your-app/api/cron/track";

  /*
   * THE PUBLIC ADDRESS, AND WHETHER IT IS STILL TRUE.
   *
   * NEXT_PUBLIC_SITE_URL is the value every link that leaves the building is
   * built from - password resets, the welcome email, referral links. It has a
   * fallback to the *.vercel.app host Vercel maintains, so when it is stale
   * nothing on this site looks broken: the failures all happen in somebody
   * else's inbox, where nobody here can see them.
   *
   * So it is shown rather than merely checked, and compared against the host
   * actually serving this page. A mismatch is the signature of a domain that
   * moved without this variable following it. www is ignored on both sides -
   * reaching the admin through www.example.com does not make example.com wrong.
   */
  const configuredSiteUrl = env.siteUrl;
  const bareHost = (value: string) => value.replace(/^www\./i, "").toLowerCase();
  const siteUrlHost = (() => {
    try {
      return bareHost(new URL(configuredSiteUrl).host);
    } catch {
      return "";
    }
  })();
  // Only judged against a real request. A local run serves localhost and would
  // otherwise report the production address as wrong every time.
  const siteUrlChecked = Boolean(host) && !host.startsWith("localhost");
  const siteUrlMatchesHost = !siteUrlChecked || siteUrlHost === bareHost(host);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`Platform-wide. Everything here applies to ${site.brandName} as a whole — there is nothing per customer on this page.`}
      />

      {/*
        Five groups rather than ten stacked panels. Nothing was removed and no
        field changed forms - these are the same panels, shown a group at a
        time, because a 746-line scroll meant reaching one setting by passing
        nine you were not looking for.
      */}
      <SectionTabs sections={SETTINGS_SECTIONS} active={section} basePath="/admin/settings" />

      {section === "site" ? (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
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
                    placeholder="Rahdari"
                    autoComplete="off"
                  />
                </Field>

                <Checkbox
                  name="signup_enabled"
                  label="Anyone may create an account"
                  hint="Off hides and refuses public registration. Existing customers are unaffected, and you can still create accounts from the Customers page."
                  defaultChecked={site.signupEnabled}
                />

                <Field
                  label="Free credits for a new account"
                  name="signup_free_credits"
                  hint="Handed over the moment someone registers, so they can try a search before paying. 0 switches the free tier off. It shows in their credit history as a signup bonus, and it does not give them a plan — a plan is still needed before they can watch a truck."
                >
                  <Input
                    name="signup_free_credits"
                    type="number"
                    min={0}
                    max={100000}
                    defaultValue={num(settings, "signup_free_credits", 0)}
                    className="max-w-40"
                  />
                </Field>

                {/*
                  Blank is no longer harmless, so it says so.
                  Every customer screen now offers a way to report a problem,
                  and with both of these empty that way is the /contact page,
                  which with nothing filled in has nothing to give them. The
                  warning is here rather than in a doc because this is the
                  screen where it gets fixed.
                */}
                {!site.supportEmail && !site.supportPhone ? (
                  <p className="mb-4 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
                    <span className="text-warn-500">
                      No support contact is published.
                    </span>{" "}
                    Customers who hit a problem are sent to the contact page, and it currently
                    lists no way to reach you. Fill in at least one of these.
                  </p>
                ) : null}

                <FormGrid cols={2}>
                  <Field
                    label="Support email"
                    name="support_email"
                    hint="Shown in the public footer, and offered to any customer reporting a problem."
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
                    hint="Shown in the public footer, and dialled straight from a phone."
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

          {/*
            Deliberately in the same two-column grid as the Site panel, next to
            the support address rather than over on the Payments tab. The one
            mistake this setting invites is being read as another way to write
            "support email", and the surest guard against that is the two boxes
            being visible at the same time with a sentence between them saying
            which is which. Sign-up is not a payment event either, so Payments
            would only have held two of the three.
          */}
          <Panel
            title="Notify an admin"
            description="One internal address, told when a customer or a payment arrives. Never shown to anybody."
          >
            <ActionForm action={saveNotificationSettings} closeOnSuccess={false}>
              <div className="space-y-4">
                <Field
                  label="Notification email"
                  name="admin_notify_email"
                  hint={
                    <>
                      Not the support address above — that one is published in the footer for
                      customers to write to, this one is where the takings are announced. Leave it
                      blank to send nothing at all.
                    </>
                  }
                >
                  <Input
                    name="admin_notify_email"
                    type="email"
                    defaultValue={site.adminNotifyEmail}
                    placeholder="owner@example.com"
                    autoComplete="off"
                  />
                </Field>

                <div className="space-y-3">
                  <Checkbox
                    name="admin_notify_signup"
                    label="A new customer signs up"
                    hint="Name, mobile and whether they were invited. They have no plan at this point, so it is a lead rather than a sale."
                    defaultChecked={site.adminNotifySignup}
                  />
                  <Checkbox
                    name="admin_notify_plan"
                    label="A plan is bought"
                    hint="The plan, what was paid, the term it runs to, and any credits bought in the same payment."
                    defaultChecked={site.adminNotifyPlan}
                  />
                  <Checkbox
                    name="admin_notify_topup"
                    label="Credits are topped up"
                    hint="What was paid, how many credits, and their balance afterwards."
                    defaultChecked={site.adminNotifyTopup}
                  />
                </div>

                {/*
                  The address being set is not the same as mail being able to
                  leave, and the gap between those two is what makes a broken
                  notification look like a missing feature. Only shown when
                  there is an address, so an operator who has not set one up
                  yet is not told off for a second thing.
                */}
                {site.adminNotifyEmail && emailProblem ? (
                  <p className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
                    <span className="text-warn-500">Nothing can be sent yet.</span> {emailProblem}{" "}
                    Notifications are held back rather than failing one at a time — the Health tab
                    has the same line.
                  </p>
                ) : null}

                <p className="rounded-lg border border-line/70 bg-panel/50 p-4 text-xs leading-relaxed text-muted">
                  <span className="text-ink">Each mail carries a link to the account.</span> A
                  payment recorded by hand on the Finance page counts too, and says who recorded it
                  and how the money arrived. A notification that cannot be sent is never allowed to
                  fail the sign-up or the payment it was about.
                </p>
              </div>

              <FormActions>
                <SubmitButton>Save notification settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>
        </div>
      ) : null}

      {section === "tracking" ? (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
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
                  hint="A tracked truck that crosses no toll for this long is shown as no activity rather than idle. This only changes the WORD on screen — checking carries on. The setting below is the one that actually stops it, which is why the two numbers are nothing like each other."
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
                  label="Pause a truck after this many failed checks"
                  name="tracking_failure_cutoff"
                  hint="A check fails when the toll network cannot answer for that number - usually a typo or a lorry it has stopped reporting. After five failures in a row the officer is messaged; at this number the truck is paused rather than left spending a credit per check on a question with no answer. Nothing is deleted. This is the fallback: an officer who set their own number for a truck keeps it."
                >
                  <Input
                    name="tracking_failure_cutoff"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={num(settings, "tracking_failure_cutoff", 10)}
                    className="max-w-40"
                  />
                </Field>

                <Field
                  label="Pause a truck after this long without movement (hours)"
                  name="inactive_pause_hours"
                  hint="A parked lorry answers every check with the same crossing it gave yesterday, so the checks cost credits and tell nobody anything. Counted from the last crossing that came through: past this, the truck is paused and its owner is told it stopped moving. This is the fallback - an officer who set their own number for a truck keeps it. Generous by default, because the cost of setting it too low is a customer whose lorry quietly stopped being watched over a long weekend."
                >
                  <Input
                    name="inactive_pause_hours"
                    type="number"
                    min={1}
                    max={8760}
                    defaultValue={num(settings, "inactive_pause_hours", 72)}
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
        </div>
      ) : null}

      {section === "payments" ? (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
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
                  their own price and their own term, and the credit packs on the Credits page are
                  the top-up price list. This panel only decides whether anyone may pay in the app
                  at all.
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
              {/* Both bots named, because an admin walking a customer through
                  this on the phone can only name what this panel names - and
                  the two jobs are the thing that gets conflated: one hands
                  over the number, the other has to be started or nothing we
                  send is allowed through. */}
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Two bots, and the customer sends <Mono>/start</Mono> to both.{" "}
                <Mono>@{ID_BOT_USERNAME}</Mono> replies with their numeric chat id — or read it
                yourself with <Mono>node scripts/get-telegram-chat-id.mjs</Mono>. Then{" "}
                <Mono>@{ALERT_BOT_USERNAME}</Mono>, ours, which alerts are sent from: Telegram only
                allows a bot to message someone who has started it, so without that second{" "}
                <Mono>/start</Mono> a correct chat id still delivers nothing. Paste the number on
                their account page. Never ask for a phone number — Telegram alerts do not use it.
              </p>
            </div>
          </Panel>
        </div>
      ) : null}

      {section === "data" ? (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <Panel
            title="Sheets and exporting"
            description="Where old rows are copied before they leave the database, and how often. How long each table is kept is per table, on the Storage page."
            actions={
              <LinkButton href="/admin/storage" variant="secondary" size="sm">
                <Database size={13} />
                Retention rules
              </LinkButton>
            }
          >
            <ActionForm action={saveBackupSettings} closeOnSuccess={false}>
              <div className="space-y-4">
                <FormGrid cols={2}>
                  <Field
                    label="Fallback sheet"
                    name="backup_sheet_id"
                    hint="Used for any account that has not named a sheet of its own. Paste the whole Google Sheets address; only the id is stored."
                  >
                    <Input
                      name="backup_sheet_id"
                      defaultValue={backupSheetId}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      autoComplete="off"
                    />
                  </Field>

                  <Field
                    label="Export every (days)"
                    name="sheet_export_interval_days"
                    hint="Checked at the end of a tracking sweep, so it runs on the next sweep after it falls due."
                  >
                    <Input
                      name="sheet_export_interval_days"
                      type="number"
                      min={1}
                      max={365}
                      defaultValue={exportEvery}
                    />
                  </Field>
                </FormGrid>

                <Checkbox
                  name="purge_enabled"
                  label="Do this automatically"
                  hint="Off means nothing is exported or deleted until you press the button on the Storage page."
                  defaultChecked={purgeEnabled}
                />

                <div
                  className={
                    noCopy.length > 0
                      ? "rounded-lg border border-bad-500/50 bg-bad-500/10 p-4"
                      : "rounded-lg border border-line/70 bg-panel/50 p-4"
                  }
                >
                  <p
                    className={
                      noCopy.length > 0
                        ? "flex items-center gap-2 text-sm font-medium text-bad-500"
                        : "flex items-center gap-2 text-sm font-medium text-ink"
                    }
                  >
                    {noCopy.length > 0 ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
                    {noCopy.length > 0
                      ? `${noCopy.map((rule) => rule.label).join(", ")} — deleted with no copy kept`
                      : "What actually happens"}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Every {exportEvery} day{exportEvery === 1 ? "" : "s"}, each account&apos;s rows
                    older than that table&apos;s window are copied into that account&apos;s own
                    sheet — or into the fallback sheet above if it has none — and then deleted.{" "}
                    {trimming.length === 0
                      ? "No table has a finite window at the moment, so nothing is being deleted at all."
                      : `${trimming.length} table(s) are being trimmed.`}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    <span className="text-ink">
                      If a sheet is set but cannot be written, nothing is deleted at all.
                    </span>{" "}
                    A broken sheet never turns into a deletion. A rule with copying switched off is
                    the exception: those rows are deleted with no copy anywhere, and that cannot be
                    undone.
                  </p>
                  {health.googleSheets ? (
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      Every sheet — yours and each account&apos;s — has to be shared as{" "}
                      <strong>Editor</strong> with{" "}
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
                  {noFallbackSheet ? (
                    <p className="mt-2 text-xs leading-relaxed text-warn-500">
                      No fallback sheet is set, so an account that has not named one has nowhere to
                      copy to. Its rows are kept rather than deleted uncopied, which means the
                      database will not shrink for those accounts.
                    </p>
                  ) : null}
                </div>
              </div>

              <FormActions>
                <SubmitButton>Save sheet settings</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel
            title="Storage and retention"
            description="How long each table is kept, what it costs on disk, and the button that exports and trims on demand."
          >
            <div className="flex items-start gap-2.5">
              <Database size={16} className="mt-0.5 shrink-0 text-brand-500" />
              <p className="text-xs leading-relaxed text-muted">
                {rules.length === 0
                  ? "No retention rules are set up, so nothing is ever deleted. Run 0016_retention_rules_and_sheets.sql against the project."
                  : trimming.length === 0
                    ? `All ${rules.length} tables are kept for ever, so the database only grows. Set a window on the logs to hold it down.`
                    : `${trimming.length} of ${rules.length} tables are trimmed${
                        noCopy.length > 0 ? `, ${noCopy.length} with no copy kept` : ""
                      }.`}
                {protectedTrimmed.length > 0
                  ? ` ${protectedTrimmed.length} money record(s) have a finite window — worth checking.`
                  : ""}
              </p>
            </div>

            <FormActions>
              <LinkButton href="/admin/storage">
                <Database size={14} />
                Open Storage
              </LinkButton>
            </FormActions>

            <p className="mt-3 flex items-center gap-1.5 border-t border-divider pt-3 text-[11px] leading-relaxed text-faint">
              <Clock size={12} className="shrink-0" />
              Last export:{" "}
              {typeof settings.last_sheet_export_at === "string"
                ? fmtRelative(settings.last_sheet_export_at)
                : "never"}
            </p>
          </Panel>
        </div>
      ) : null}

      {section === "health" ? (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
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
              {/* The one channel whose failure is invisible from the customer's
                  side: with a key missing the phone still subscribes and every
                  send is rejected, so this row is where it shows. */}
              <HealthRow
                ok={health.webPush}
                label="Phone notifications"
                detail="VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT, and the public key again as NEXT_PUBLIC_VAPID_PUBLIC_KEY so a browser can subscribe. Generate a pair with npx web-push generate-vapid-keys — no account, no cost"
              />
              <HealthRow
                ok={health.fcm}
                label="Notifications in the Android app"
                detail="FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY, from a Firebase project service account. The app's WebView has no Web Push, so it goes through Firebase Cloud Messaging instead — free. See mobile/README.md"
              />
              {/* Expected to be red, and here anyway: the channel is built and
                  waiting on an account, so this row is the only place that says
                  what is missing before WhatsApp alerts can be switched on. */}
              <HealthRow
                ok={health.whatsapp}
                label="WhatsApp alerts"
                detail="WHATSAPP_TOKEN + WHATSAPP_PHONE_ID. Until both are set, WhatsApp is shown to customers as coming soon and sends nothing — Telegram is unaffected"
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
              {/* Every outbound link is built from this, and all of them fail
                  somewhere nobody here can see. See the banner below. */}
              <HealthRow
                ok={siteUrlMatchesHost}
                label="Public address"
                badPrefix={null}
                detail={
                  siteUrlMatchesHost
                    ? `NEXT_PUBLIC_SITE_URL — ${configuredSiteUrl}`
                    : `NEXT_PUBLIC_SITE_URL is ${configuredSiteUrl}, but this page came from ${proto}://${host}`
                }
              />
              <HealthRow
                ok={!emailProblem}
                label="Password reset email"
                detail="RESEND_API_KEY + EMAIL_FROM on a verified domain"
              />
            </ul>

            {emailProblem ? (
              <p className="mt-4 flex items-start gap-2.5 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2.5 text-xs leading-relaxed text-bad-500">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>Nobody can reset their password.</strong> {emailProblem}
                </span>
              </p>
            ) : null}

            {/*
              Shown only when the address disagrees, and it lists the places the
              address is written down rather than just reporting the mismatch.
              This site moved to a new domain and took every payment with it:
              Razorpay refuses any payment started from a site it does not have
              on file, so checkout broke on the day of the move, in a way that
              looked from here like ordinary card failures.
            */}
            {!siteUrlMatchesHost ? (
              <p className="mt-4 flex items-start gap-2.5 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2.5 text-xs leading-relaxed text-bad-500">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>This site has moved and something was left behind.</strong> Every link
                  sent out by email — password resets, welcome mails, referral links — still points
                  at <Mono className="text-xs">{configuredSiteUrl}</Mono>. A domain change has to be
                  made in four places: <strong>NEXT_PUBLIC_SITE_URL</strong> in Vercel,{" "}
                  <strong>Razorpay</strong> (both the registered website and the webhook URL —
                  Razorpay blocks payments from a site it does not have on file),{" "}
                  <strong>Supabase</strong> (Site URL and Redirect URLs), and your{" "}
                  <strong>cron scheduler</strong>. See docs/CHANGING-THE-DOMAIN.md.
                </span>
              </p>
            ) : null}

            {/* A reset link is built from this, and a link on the wrong host is
                one Supabase refuses to redirect to. */}
            <p className="mt-3 border-t border-divider pt-3 text-[11px] leading-relaxed text-faint">
              Reset links point at <Mono className="text-xs break-all">{env.siteUrl}</Mono>. Set{" "}
              <Mono className="text-xs">NEXT_PUBLIC_SITE_URL</Mono> if that is not your public
              address, and add <Mono className="text-xs break-all">{env.siteUrl}/reset-password</Mono>{" "}
              to the redirect allow-list in Supabase under Authentication → URL Configuration.
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
              {/* Beside the support address for the same reason the form is:
                  the two get mistaken for each other, and this panel is where
                  an operator comes to check what is actually in force. The
                  events are listed rather than counted, because "2 of 3" does
                  not say which one has been switched off. */}
              <DescRow label="Admin notifications">
                {site.adminNotifyEmail
                  ? `${site.adminNotifyEmail} · ${
                      [
                        site.adminNotifySignup ? "sign-ups" : null,
                        site.adminNotifyPlan ? "plans" : null,
                        site.adminNotifyTopup ? "top-ups" : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || "every event switched off"
                    }`
                  : "off — no address set"}
              </DescRow>
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
              <DescRow label="Pause when still for">
                {num(settings, "inactive_pause_hours", 72)} h
              </DescRow>
              <DescRow label="Pause after">
                {num(settings, "tracking_failure_cutoff", 10)} failed checks
              </DescRow>
              <DescRow label="Same-plaza window">
                {num(settings, "revisit_minutes", 90)} min
              </DescRow>
              <DescRow label="Retention">
                {rules.length === 0
                  ? "no rules"
                  : trimming.length === 0
                    ? "every table kept for ever"
                    : `${trimming.length} of ${rules.length} tables trimmed`}
              </DescRow>
              <DescRow label="Export every">{exportEvery} days</DescRow>
              <DescRow label="Fallback sheet">
                {backupSheetId ? (
                  <Mono className="text-xs break-all">{backupSheetId}</Mono>
                ) : (
                  <Badge tone={noFallbackSheet ? "warn" : "neutral"}>none set</Badge>
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
      ) : null}
    </>
  );
}

/**
 * `badPrefix` exists because not every red row here is a missing value. Almost
 * all of them are, so "Not set" stays the default and no existing row changed;
 * a row whose failure is a disagreement rather than an absence says so instead,
 * and reads as the sentence it is rather than as "Not set — <a value>".
 */
function HealthRow({
  ok,
  label,
  detail,
  badPrefix = "Not set",
}: {
  ok: boolean;
  label: string;
  detail: string;
  badPrefix?: string | null;
}) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ? (
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good-500" />
      ) : (
        <XCircle size={15} className="mt-0.5 shrink-0 text-bad-500" />
      )}
      <span>
        <span className="block text-sm text-ink">{label}</span>
        <span className="block text-xs text-faint">
          {ok || !badPrefix ? detail : `${badPrefix} — ${detail}`}
        </span>
      </span>
    </li>
  );
}
