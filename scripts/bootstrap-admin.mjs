/**
 * Creates (or promotes) the first super admin.
 *
 *   node scripts/bootstrap-admin.mjs you@example.com "YourPassword123" "Your Name"
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
 * (or the real environment). Safe to run more than once: an existing account is
 * promoted instead of duplicated.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const [email, password, fullName] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node scripts/bootstrap-admin.mjs <email> <password> ["Full Name"]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Fill in .env.local first.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName ?? "Administrator", role: "super_admin" },
});

let userId = created?.user?.id;

if (createError) {
  if (!/already been registered|already exists/i.test(createError.message)) {
    console.error("Could not create the account:", createError.message);
    process.exit(1);
  }
  // Already there - find it and reset the password so you can definitely log in.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) {
    console.error("Could not list users:", listError.message);
    process.exit(1);
  }
  const existing = list.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (!existing) {
    console.error(`${email} exists but could not be found in the first 200 users.`);
    process.exit(1);
  }
  userId = existing.id;
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
  if (updateError) {
    console.error("Could not reset the password:", updateError.message);
    process.exit(1);
  }
  console.log(`Account already existed - password reset for ${email}.`);
}

const { error: profileError } = await admin.from("profiles").upsert(
  {
    id: userId,
    email,
    full_name: fullName ?? "Administrator",
    role: "super_admin",
    status: "active",
  },
  { onConflict: "id" },
);

if (profileError) {
  console.error("Account created but the profile row failed:", profileError.message);
  console.error("Did you run both files in supabase/migrations?");
  process.exit(1);
}

console.log(`Super admin ready: ${email}`);
console.log("Sign in at /login");
