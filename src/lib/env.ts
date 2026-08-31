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
  /**
   * Transactional email. The from address has to be on a domain verified with
   * the provider, or every send is rejected.
   */
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? "";
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? "";
  },
  /**
   * Where a password-reset link points. Falls back to the host Vercel provides,
   * which is right in production and harmless in a preview deployment.
   */
  get siteUrl() {
    const explicit = process.env.NEXT_PUBLIC_SITE_URL;
    if (explicit) return explicit.replace(/\/+$/, "");
    const vercel =
      process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
    return vercel ? `https://${vercel}` : "http://localhost:3000";
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
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  };
}
