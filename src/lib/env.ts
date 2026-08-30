/**
 * Central env access. Throws loudly at first use instead of failing with an
 * opaque Supabase error three layers down.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get ldbApiUrl() {
    return process.env.LDB_API_URL ?? "https://ldb.co.in/api/ldbv2/truck/search";
  },
  get telegramBotToken() {
    return process.env.TELEGRAM_BOT_TOKEN ?? "";
  },
  get googleServiceAccountEmail() {
    return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  },
  get googleServiceAccountKey() {
    return process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  /**
   * Razorpay. The key id is public and also reaches the browser through
   * NEXT_PUBLIC_RAZORPAY_KEY_ID; the secret and the webhook secret never leave
   * the server, and are the reason no payment can be forged by a client.
   */
  get razorpayKeyId() {
    return process.env.RAZORPAY_KEY_ID ?? process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "";
  },
  get razorpayKeySecret() {
    return process.env.RAZORPAY_KEY_SECRET ?? "";
  },
  get razorpayWebhookSecret() {
    return process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  },
};

/** Which integrations are wired up, for the Settings page health panel. */
export function integrationHealth() {
  return {
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    googleSheets: Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ),
    cron: Boolean(process.env.CRON_SECRET),
    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    razorpayWebhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
  };
}
