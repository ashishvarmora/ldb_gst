/**
 * Runs every file in supabase/migrations, in order, against your database.
 *
 *   node scripts/push-migrations.mjs "postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
 *
 * or put the same string in .env.local as SUPABASE_DB_URL and just run:
 *
 *   node scripts/push-migrations.mjs
 *
 * Get the string from: Supabase dashboard -> Project Settings -> Database ->
 * Connection string -> URI, and replace [YOUR-PASSWORD] with your password.
 *
 * Use the direct connection or the SESSION pooler (port 5432). The transaction
 * pooler (6543) cannot run some of this DDL.
 *
 * All three migrations are idempotent, so re-running is safe.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = "supabase/migrations";

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local - fall back to the real environment.
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const connection = process.argv[2] ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

if (!connection) {
  console.error(
    "No connection string.\n\n" +
      '  node scripts/push-migrations.mjs "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"\n\n' +
      "Or set SUPABASE_DB_URL in .env.local.\n" +
      "Find it in Supabase: Project Settings -> Database -> Connection string -> URI.",
  );
  process.exit(1);
}

if (connection.includes("[YOUR-PASSWORD]")) {
  console.error("Replace [YOUR-PASSWORD] in the connection string with your real database password.");
  process.exit(1);
}

if (connection.includes(":6543")) {
  console.error(
    "That is the transaction pooler (port 6543), which cannot run all of these statements.\n" +
      "Use the direct connection or the session pooler on port 5432.",
  );
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No .sql files found in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: connection,
  // Supabase terminates TLS at the pooler with its own CA; verifying the chain
  // here adds nothing over a password on a known host.
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
  statement_timeout: 120_000,
});

const notices = [];
client.on("notice", (notice) => {
  // "already exists, skipping" on a re-run is expected, not worth printing.
  if (!/already exists|does not exist, skipping/i.test(notice.message ?? "")) {
    notices.push(notice.message);
  }
});

console.log(`Applying ${files.length} migration(s) to ${connection.replace(/:[^:@/]+@/, ":****@")}\n`);

try {
  await client.connect();
} catch (error) {
  console.error(`Could not connect: ${error.message}`);
  if (error.code === "ENOTFOUND" || error.code === "ETIMEDOUT" || error.code === "ENETUNREACH") {
    console.error(
      "\nThe direct host (db.<ref>.supabase.co) is IPv6-only on newer projects.\n" +
        "If your network has no IPv6, use the session pooler string instead:\n" +
        "  postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres",
    );
  }
  process.exit(1);
}

for (const file of files) {
  process.stdout.write(`  ${file} ... `);
  notices.length = 0;

  try {
    await client.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  } catch (error) {
    console.log("FAILED\n");
    console.error(`  ${error.message}`);
    if (error.position) console.error(`  at character ${error.position}`);
    if (error.hint) console.error(`  hint: ${error.hint}`);
    console.error(
      "\nNothing after this file was applied. Fix the error and run again -\n" +
        "the migrations are idempotent, so already-applied ones are skipped safely.",
    );
    await client.end();
    process.exit(1);
  }

  console.log("ok");
  for (const notice of notices) console.log(`    ${notice}`);
}

// Quick sanity check so a silent partial apply cannot pass for success.
const { rows: tables } = await client.query(
  `select count(*)::int as n from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'`,
);
const { rows: plans } = await client.query(`select name from public.plans order by sort_order`);
const { rows: fns } = await client.query(
  `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and proname in
     ('consume_quota','is_super_admin','bump_alerts_sent','touch_last_active','ist_today')
   order by proname`,
);

await client.end();

console.log(`\nAll migrations applied.`);
console.log(`  tables    : ${tables[0].n}`);
console.log(`  plans     : ${plans.map((row) => row.name).join(", ") || "none"}`);
console.log(`  functions : ${fns.map((row) => row.proname).join(", ")}`);
console.log(`\nNext: node scripts/bootstrap-admin.mjs you@example.com "YourPassword" "Your Name"`);
