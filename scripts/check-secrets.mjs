/**
 * Scans everything git is about to commit for real credentials.
 *
 *   npm run check-secrets          # scan staged files (use before committing)
 *   npm run check-secrets -- --all # scan every tracked file
 *
 * This exists because a live Supabase service_role key and a Telegram bot token
 * once ended up in .env.example, which IS committed. Placeholders are fine; real
 * values are not.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scanAll = process.argv.includes("--all");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const files = git(
  scanAll ? ["ls-files"] : ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
)
  .split(/\r?\n/)
  .filter(Boolean);

if (files.length === 0) {
  console.log(scanAll ? "No tracked files." : "Nothing staged.");
  process.exit(0);
}

/** A finding is only real if the matched text is not an obvious placeholder. */
const PLACEHOLDER = /x{6,}|<[^>]+>|your-|example|placeholder|\bAA\.\.\.|MIIE\.\.\.|\.\.\.$/i;

const RULES = [
  {
    name: "Supabase service_role JWT",
    // A Supabase JWT whose payload decodes to role=service_role.
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    verify: (match) => {
      try {
        const payload = JSON.parse(Buffer.from(match.split(".")[1], "base64url").toString());
        return payload.role === "service_role" || payload.role === "anon";
      } catch {
        return false;
      }
    },
  },
  {
    name: "Supabase secret key",
    pattern: /sb_secret_[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: "Supabase publishable key",
    pattern: /sb_publishable_[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: "Telegram bot token",
    pattern: /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}/g,
  },
  {
    name: "Private key with real body",
    // A PEM whose first body line is long enough to be a real key, not "MIIE...".
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/]{40,}/g,
  },
  {
    name: "Postgres URL with password",
    pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]{6,}@[^\s/]+/g,
  },
  {
    name: "Google service-account JSON",
    pattern: /"type"\s*:\s*"service_account"/g,
  },
];

const findings = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // deleted, binary, or unreadable
  }

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const text = match[0];
      if (PLACEHOLDER.test(text)) continue;
      if (rule.verify && !rule.verify(text)) continue;

      const line = content.slice(0, match.index).split("\n").length;
      findings.push({
        file,
        line,
        rule: rule.name,
        preview: `${text.slice(0, 28)}...`,
      });
    }
  }
}

if (findings.length === 0) {
  console.log(`No secrets found in ${files.length} file(s).`);
  process.exit(0);
}

console.error(`\nFound ${findings.length} likely credential(s) in files git will commit:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.rule}: ${f.preview}\n`);
}
console.error("Replace them with placeholders, or move the file into .gitignore.");
console.error("If one of these was already pushed, rotate it - removing the line is not enough.");
process.exit(1);
