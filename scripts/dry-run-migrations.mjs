/**
 * Applies every migration inside ONE transaction and rolls it back.
 *
 * Catches syntax errors, missing columns and broken dependency order without
 * touching the live database - which still serves the old code until the new
 * build is deployed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

for (const p of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  statement_timeout: 180000,
});

await client.connect();
console.log(`Dry-running ${files.length} migration(s) in a transaction that will be rolled back.\n`);

let failed = false;
try {
  await client.query("begin");
  for (const file of files) {
    process.stdout.write(`  ${file} ... `);
    try {
      await client.query(readFileSync(join(DIR, file), "utf8"));
      console.log("ok");
    } catch (error) {
      console.log("FAILED");
      console.error(`\n  ${error.message}`);
      if (error.hint) console.error(`  hint: ${error.hint}`);
      if (error.where) console.error(`  where: ${error.where}`);
      failed = true;
      break;
    }
  }

  if (!failed) {
    // Prove the end state is what the app expects, still inside the transaction.
    const checks = [
      ["officer_overview columns", `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='officer_overview'`],
      ["credits on profiles", `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='credits'`],
      ["alert templates seeded", `select count(*)::int n from public.alert_rule_templates`],
      ["credit rates seeded", `select count(*)::int n from public.credit_rates`],
      ["toll plazas backfilled", `select count(*)::int n from public.toll_plazas`],
      ["truck_alerts table", `select count(*)::int n from public.truck_alerts`],
      ["polling_interval gone", `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='tracked_trucks' and column_name='polling_interval_minutes'`],
      ["consume_quota gone", `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and proname='consume_quota'`],
      ["spend_credits present", `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and proname='spend_credits'`],
    ];
    console.log("");
    for (const [label, sql] of checks) {
      const { rows } = await client.query(sql);
      console.log(`  ${label}: ${rows[0].n}`);
    }

    // Exercise the credit RPC end to end against a real officer.
    const { rows: who } = await client.query(
      `select id, email, credits from public.profiles order by created_at limit 1`,
    );
    if (who.length) {
      await client.query(`select public.grant_credits($1, 100, 'admin_topup', null, 'dry run')`, [who[0].id]);
      const { rows: spent } = await client.query(
        `select public.spend_credits($1, 'auto_check', 1, 'TEST') as v`,
        [who[0].id],
      );
      const { rows: after } = await client.query(`select credits from public.profiles where id=$1`, [who[0].id]);
      console.log(`\n  spend_credits verdict: ${JSON.stringify(spent[0].v)}`);
      console.log(`  balance after +100 then one auto_check: ${after[0].credits} (expected 99.50)`);
    }
  }
} finally {
  await client.query("rollback");
  await client.end();
  console.log(`\nRolled back. Nothing was changed.`);
}

process.exit(failed ? 1 : 0);
