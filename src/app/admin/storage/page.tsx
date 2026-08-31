import {
  AlertTriangle,
  Database,
  FileSpreadsheet,
  HardDrive,
  Infinity as Forever,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";

import { RetentionRuleFields } from "./RetentionRuleFields";
import { runExportNow, saveRetentionRule } from "./actions";
import { KEEP_FOREVER, keepDaysLabel, prettyBytes } from "./keep-days";
import { CapNote } from "../pager";
import { ActionForm, ConfirmSubmitButton } from "@/components/ActionForm";
import { FormActions } from "@/components/form";
import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { loadRetentionRules } from "@/lib/backup";
import { env, integrationHealth } from "@/lib/env";
import { fmtNumber, fmtRelative } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { GoogleSheetConfig } from "@/lib/types";

export const metadata = { title: "Storage — Admin" };

/**
 * Retention lives on its own page rather than in Settings.
 *
 * There are seven rules, each wanting its own window, its own copy-first answer
 * and its own current size beside it, plus a row per account for the sheets
 * they are copied into. That is a page, not a panel, and Settings was already
 * long enough that a money table's window would have been edited below the
 * fold. Settings keeps the one thing that is genuinely platform-wide - the
 * fallback sheet and how often the export runs - and links here.
 */

/** Accounts read for the sheet table. Enough to spot a broken sheet without
 *  paging; the note under the table says when it stopped short. */
const ACCOUNTS_SCANNED = 200;
const ACCOUNTS_SHOWN = 25;

/** A sheet that has not been written for this long is worth looking at, which
 *  is the whole point of the table - a week of quiet failure is invisible
 *  otherwise. */
const STALE_DAYS = 7;

type TableSize = { entity: string; rows: number; bytes: number; pretty: string };
type Account = { id: string; email: string; full_name: string | null };

type SheetRow = {
  account: Account;
  config: GoogleSheetConfig | null;
  /** Days since the sheet was last written, or null if it never has been. */
  age: number | null;
  rank: number;
};

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? ms / 86_400_000 : null;
}

export default async function StoragePage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const [
    rules,
    { data: sizeData, error: sizeError },
    { data: sheetData },
    { data: accountData, count: accountCount },
    { data: settingRows },
    settings,
  ] = await Promise.all([
    loadRetentionRules(admin),
    admin.rpc("table_sizes"),
    admin.from("google_sheet_configs").select("*"),
    admin
      .from("profiles")
      .select("id, email, full_name", { count: "exact" })
      .eq("role", "officer")
      .order("created_at", { ascending: false })
      .limit(ACCOUNTS_SCANNED),
    admin.from("app_settings").select("key, value").in("key", ["last_sheet_export_at", "purge_enabled"]),
    loadSettings(admin),
  ]);

  const health = integrationHealth();
  const sizes = ((sizeData ?? []) as TableSize[]).map((row) => ({
    entity: row.entity,
    rows: Number(row.rows ?? 0),
    bytes: Number(row.bytes ?? 0),
    pretty: row.pretty ?? prettyBytes(Number(row.bytes ?? 0)),
  }));
  const sizeFor = new Map(sizes.map((row) => [row.entity, row]));

  const settingMap = new Map((settingRows ?? []).map((row) => [row.key, row.value as unknown]));
  const lastExport = settingMap.get("last_sheet_export_at");
  const purgeEnabled = settingMap.get("purge_enabled") !== false;

  const totalBytes = sizes.reduce((sum, row) => sum + row.bytes, 0);
  const biggest = sizes[0] ?? null;

  const covered = rules.filter((rule) => sizeFor.has(rule.entity));
  const rowsUnderRules = covered.reduce(
    (sum, rule) => sum + (sizeFor.get(rule.entity)?.rows ?? 0),
    0,
  );
  const bytesUnderRules = covered.reduce(
    (sum, rule) => sum + (sizeFor.get(rule.entity)?.bytes ?? 0),
    0,
  );

  const forEver = rules.filter((rule) => rule.keep_days === KEEP_FOREVER);
  const trimming = rules.filter((rule) => rule.is_enabled && rule.keep_days !== KEEP_FOREVER);
  const noCopy = trimming.filter((rule) => !rule.backup_before_delete);
  const protectedTrimmed = rules.filter(
    (rule) => rule.is_protected && rule.keep_days !== KEEP_FOREVER,
  );

  /* ------------------------------------------------------------------------ */
  /* per-account sheets                                                        */
  /* ------------------------------------------------------------------------ */

  const accounts = (accountData ?? []) as Account[];
  const configs = new Map(
    ((sheetData ?? []) as GoogleSheetConfig[]).map((config) => [config.user_id, config]),
  );

  const sheetRows: SheetRow[] = accounts.map((account) => {
    const config = configs.get(account.id) ?? null;
    const age = daysSince(config?.last_synced_at);
    const own = Boolean(config?.spreadsheet_id && config.is_enabled);

    // Ordered by what an admin has to do something about, not alphabetically.
    // A sheet that has been failing quietly for a week is the reason this table
    // exists, so it sorts to the top.
    const rank = config?.last_error
      ? 0
      : own && age !== null && age > STALE_DAYS
        ? 1
        : !own && !settings.backupSheetId
          ? 2
          : own
            ? 3
            : 4;

    return { account, config, age, rank };
  });
  sheetRows.sort((a, b) => a.rank - b.rank || (b.age ?? -1) - (a.age ?? -1));

  const shownSheets = sheetRows.slice(0, ACCOUNTS_SHOWN);
  const withOwnSheet = sheetRows.filter(
    (row) => row.config?.spreadsheet_id && row.config.is_enabled,
  ).length;
  const failing = sheetRows.filter((row) => row.config?.last_error).length;
  const accountTotal = accountCount ?? accounts.length;
  const capped = accountTotal > accounts.length || sheetRows.length > shownSheets.length;

  return (
    <>
      <PageHeader
        title="Storage"
        subtitle="The database is on a free tier and several tables grow without limit. Each one has its own window and its own answer to “was this copied first”."
        actions={
          <LinkButton href="/admin/settings" variant="secondary">
            Sheet and schedule settings
          </LinkButton>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Database size"
          value={prettyBytes(totalBytes)}
          sub={biggest ? `Biggest: ${biggest.entity} at ${biggest.pretty}` : "No sizes reported"}
          tone="brand"
          icon={<HardDrive size={15} />}
        />
        <StatCard
          label="Under a retention rule"
          value={prettyBytes(bytesUnderRules)}
          sub={`≈ ${fmtNumber(rowsUnderRules)} rows across ${covered.length} table(s)`}
          icon={<Database size={15} />}
        />
        <StatCard
          label="Tables being trimmed"
          value={trimming.length}
          sub={
            noCopy.length > 0
              ? `${noCopy.length} of them with no copy kept`
              : `${forEver.length} kept for ever`
          }
          tone={noCopy.length > 0 ? "warn" : "neutral"}
        />
        <StatCard
          label="Last export"
          value={typeof lastExport === "string" ? fmtRelative(lastExport) : "never"}
          sub={
            purgeEnabled
              ? `Automatic, every ${settings.sheetExportIntervalDays} day(s)`
              : "Automatic export is switched off"
          }
          tone={purgeEnabled ? "neutral" : "warn"}
        />
      </div>

      {sizeError ? (
        <Panel className="mb-5 border-warn-500/40">
          <p className="text-sm text-warn-500">
            Could not read table sizes: {sizeError.message}
          </p>
          <p className="mt-2 text-xs text-muted">
            The <Mono>table_sizes()</Mono> function comes with{" "}
            <Mono>0016_retention_rules_and_sheets.sql</Mono>. The rules below still work without it;
            only the sizes beside them are missing.
          </p>
        </Panel>
      ) : null}

      {protectedTrimmed.length > 0 ? (
        <Panel className="mb-5 border-bad-500/50">
          <p className="flex items-center gap-2 text-sm font-medium text-bad-500">
            <AlertTriangle size={15} className="shrink-0" />
            {protectedTrimmed.length === 1
              ? "A money record has a finite window"
              : `${protectedTrimmed.length} money records have finite windows`}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            {protectedTrimmed.map((rule) => rule.label).join(", ")} will be deleted past{" "}
            {protectedTrimmed.map((rule) => keepDaysLabel(rule.keep_days)).join(" / ")}. These are
            what balances, receipts and coupon claims are reconstructed from. Set them back to
            forever below unless you meant this.
          </p>
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title="Retention, one rule per table"
            description="Each rule saves on its own. There is no save-everything button, so a money table cannot be trimmed as a side effect of shortening a log."
            bodyClassName="p-0"
          >
            {rules.length === 0 ? (
              <EmptyState
                title="No retention rules"
                description="Run 0016_retention_rules_and_sheets.sql against the Supabase project, then reload. Until then nothing is deleted at all."
              />
            ) : (
              <div className="divide-y divide-divider">
                {rules.map((rule) => (
                  <div key={rule.entity} className="p-5">
                    <ActionForm action={saveRetentionRule} closeOnSuccess={false}>
                      <RetentionRuleFields
                        rule={rule}
                        size={sizeFor.get(rule.entity) ?? null}
                      />
                    </ActionForm>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Sheets, per account"
            description={`${withOwnSheet} of ${fmtNumber(accountTotal)} account(s) name their own sheet. Everyone else is copied into your fallback sheet.`}
            bodyClassName="p-0"
          >
            {shownSheets.length === 0 ? (
              <EmptyState
                title="No accounts yet"
                description="There is nothing to export until somebody signs up."
              />
            ) : (
              <>
                <TableWrap>
                  <Thead>
                    <th className="th">Account</th>
                    <th className="th">Sheet</th>
                    <th className="th">Last synced</th>
                    <th className="th">Last problem</th>
                  </Thead>
                  <Tbody>
                    {shownSheets.map(({ account, config, age }) => {
                      const own = Boolean(config?.spreadsheet_id && config.is_enabled);
                      const stale = own && age !== null && age > STALE_DAYS;
                      return (
                        <Tr key={account.id}>
                          <td className="td">
                            <span className="block truncate text-sm text-ink">
                              {account.full_name ?? "Unnamed account"}
                            </span>
                            <span className="block truncate text-xs text-faint">
                              {account.email}
                            </span>
                          </td>
                          <td className="td">
                            {own ? (
                              <>
                                <Badge tone="good">Own sheet</Badge>
                                <Mono className="mt-1 block max-w-52 truncate text-[11px] text-faint">
                                  {config?.spreadsheet_id}
                                </Mono>
                              </>
                            ) : config?.spreadsheet_id ? (
                              <Badge tone="neutral">Own sheet, switched off</Badge>
                            ) : settings.backupSheetId ? (
                              <Badge tone="neutral">Your fallback sheet</Badge>
                            ) : (
                              <Badge tone="bad">Nowhere to copy to</Badge>
                            )}
                          </td>
                          <td className="td">
                            {config?.last_synced_at ? (
                              <span className={stale ? "text-sm text-warn-500" : "text-sm text-ink"}>
                                {fmtRelative(config.last_synced_at)}
                              </span>
                            ) : (
                              <span className="text-sm text-faint">never</span>
                            )}
                          </td>
                          <td className="td">
                            {config?.last_error ? (
                              <span className="block max-w-72 text-xs leading-relaxed text-bad-500">
                                {config.last_error}
                              </span>
                            ) : stale ? (
                              <span className="text-xs text-warn-500">
                                Nothing written for {Math.floor(age ?? 0)} days
                              </span>
                            ) : (
                              <span className="text-xs text-faint">--</span>
                            )}
                          </td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </TableWrap>
                <div className="px-5 pb-4">
                  <p className="pt-3 text-xs leading-relaxed text-muted">
                    An account with a failing sheet keeps its rows: nothing is deleted for it while
                    the copy cannot be written.{" "}
                    {failing > 0
                      ? `${failing} sheet(s) are reporting a problem, so those accounts are still carrying their old rows.`
                      : "No sheet is reporting a problem."}
                  </p>
                  {capped ? (
                    <CapNote>
                      The newest {fmtNumber(accounts.length)} of {fmtNumber(accountTotal)} accounts
                      were checked, and the {ACCOUNTS_SHOWN} most worth looking at are listed —
                      failing sheets first, then stale ones.
                    </CapNote>
                  ) : null}
                </div>
              </>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="Run the export now"
            description="Copies out and trims immediately, ignoring both the interval and the automatic switch."
          >
            {trimming.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted">
                Every table is either kept for ever or switched off, so this would do nothing.
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
                {trimming.map((rule) => (
                  <li key={rule.entity} className="flex items-start gap-2">
                    {rule.backup_before_delete ? (
                      <ShieldCheck size={13} className="mt-0.5 shrink-0 text-good-500" />
                    ) : (
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-bad-500" />
                    )}
                    <span>
                      <span className="text-ink">{rule.label}</span> past {rule.keep_days} days
                      {rule.backup_before_delete ? " — copied, then deleted" : " — deleted, no copy"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <ActionForm action={runExportNow} closeOnSuccess={false}>
              <FormActions>
                <ConfirmSubmitButton
                  size="md"
                  variant={noCopy.length > 0 ? "danger" : "secondary"}
                  message={
                    noCopy.length > 0
                      ? `${noCopy.map((rule) => rule.label).join(", ")} will be deleted with no copy kept anywhere. Everything else is copied to a sheet first. Run the export now?`
                      : "Copy old rows to each account's sheet and then delete them from the database?"
                  }
                >
                  <PlayCircle size={14} />
                  Export and trim now
                </ConfirmSubmitButton>
              </FormActions>
            </ActionForm>

            <p className="mt-3 border-t border-divider pt-3 text-[11px] leading-relaxed text-faint">
              Each table is reported separately. Where one says nothing was deleted, its rows are
              still in the database — the full detail of the run is in the audit log.
            </p>
          </Panel>

          <Panel
            title="How deletion is decided"
            description="Two properties worth knowing before shortening a window."
          >
            <ul className="space-y-3 text-xs leading-relaxed text-muted">
              <li className="flex items-start gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-500" />
                <span>
                  <span className="text-ink">A failed copy deletes nothing.</span> When “copy to a
                  sheet first” is on and the sheet cannot be written, the rows stay in the database
                  and the run reports the failure. A misconfigured spreadsheet can never turn into a
                  deletion.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-bad-500" />
                <span>
                  <span className="text-ink">With that switch off, there is no copy at all.</span>{" "}
                  The rows are deleted straight out of the database — not to a sheet, not to a
                  recycle bin.{" "}
                  {noCopy.length > 0
                    ? `Right now that applies to ${noCopy.map((rule) => rule.label).join(", ")}.`
                    : "No rule is set that way at the moment."}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Forever size={14} className="mt-0.5 shrink-0 text-brand-400" />
                <span>
                  <span className="text-ink">Forever means forever.</span> A window of “forever”
                  (-1) is skipped entirely by the job, so the switch beside it makes no difference.
                </span>
              </li>
            </ul>
          </Panel>

          <Panel
            title="Where copies go"
            description="Each account may name its own sheet; yours is the fallback."
          >
            <div className="space-y-2.5 text-xs leading-relaxed text-muted">
              <p>
                Rows are exported per account, into that account&apos;s own sheet, so a customer can
                still read their history after it leaves the database. Anyone who has not named one
                is copied into your fallback sheet instead — which is why nothing is deleted uncopied
                just because a customer never set a sheet up.
              </p>
              <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
                <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Your fallback sheet
                </p>
                {settings.backupSheetId ? (
                  <Mono className="mt-1 block text-xs break-all text-ink">
                    {settings.backupSheetId}
                  </Mono>
                ) : (
                  <p className="mt-1">
                    <Badge tone="warn">not set</Badge>
                  </p>
                )}
                <p className="mt-2">
                  Export runs every {settings.sheetExportIntervalDays} day(s), and automatic export
                  is {purgeEnabled ? "on" : "off"}. Both are set in Settings.
                </p>
              </div>

              {health.googleSheets ? (
                <p>
                  Every sheet - yours and each account&apos;s - has to be shared as{" "}
                  <strong>Editor</strong> with{" "}
                  <Mono className="text-xs break-all text-ink">
                    {env.googleServiceAccountEmail}
                  </Mono>{" "}
                  or the app cannot write to it.
                </p>
              ) : (
                <p className="text-warn-500">
                  No Google service account is configured, so no sheet can be written and no rule
                  with “copy first” on will delete anything. Set
                  GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY first.
                </p>
              )}

              <LinkButton href="/admin/settings" variant="secondary" size="sm">
                <FileSpreadsheet size={13} />
                Change the fallback sheet
              </LinkButton>
            </div>
          </Panel>

          <Panel
            title="Biggest tables"
            description="Every table in the project, largest first."
            bodyClassName="p-0"
          >
            {sizes.length === 0 ? (
              <EmptyState title="No sizes reported" description="table_sizes() returned nothing." />
            ) : (
              <>
                <TableWrap>
                  <Thead>
                    <th className="th">Table</th>
                    <th className="th text-right">Rows</th>
                    <th className="th text-right">Size</th>
                  </Thead>
                  <Tbody>
                    {sizes.slice(0, 12).map((row) => {
                      const rule = rules.find((item) => item.entity === row.entity);
                      return (
                        <Tr key={row.entity}>
                          <td className="td">
                            <Mono className="text-xs text-ink">{row.entity}</Mono>
                            <span className="mt-1 block">
                              {rule ? (
                                <Badge tone={rule.keep_days === KEEP_FOREVER ? "neutral" : "brand"}>
                                  {keepDaysLabel(rule.keep_days)}
                                </Badge>
                              ) : (
                                <Badge>no rule</Badge>
                              )}
                            </span>
                          </td>
                          <td className="td text-right tabular-nums">
                            ≈ {fmtNumber(row.rows)}
                          </td>
                          <td className="td text-right tabular-nums">{row.pretty}</td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </TableWrap>
                <div className="px-5 pb-4">
                  <p className="pt-3 text-xs leading-relaxed text-muted">
                    Row counts are Postgres estimates from <Mono>reltuples</Mono>, refreshed by
                    ANALYZE — read them as a scale, not an exact count. An exact count would mean a
                    sequential scan of every table on every page load. Sizes include indexes and are
                    exact.
                  </p>
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
