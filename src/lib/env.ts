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

/*
 * WHY EACH SUPABASE VARIABLE HAS A SECOND ACCEPTABLE NAME.
 *
 * Connecting a Supabase project to Vercel through the official integration
 * injects its own set of variables - SUPABASE_URL, SUPABASE_SECRET_KEY,
 * SUPABASE_PUBLISHABLE_KEY, POSTGRES_URL and friends - and it does NOT set the
 * NEXT_PUBLIC_* names this app was written against. So a project connected that
 * way looks fully configured in the Vercel dashboard while the app reads
 * nothing at all and keeps talking to whatever it was pointed at before.
 *
 * That is exactly how this app spent an afternoon serving a database nobody
 * meant to use: thirteen correct variables for the new project sat beside four
 * stale ones for the old, and only the stale four were being read.
 *
 * So each value accepts either spelling, with the app's own name winning. An
 * explicit NEXT_PUBLIC_SUPABASE_URL still overrides the integration, which
 * matters because the integration cannot be told to point somewhere else.
 *
 * Note SUPABASE_URL is deliberately NOT accepted for supabaseUrl: it is not
 * NEXT_PUBLIC_, so it does not reach the browser, and a server that talked to
 * one project while the browser talked to another would fail in a way nobody
 * could read. A url has to be public or it is not usable here.
 */
function firstOf(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      firstOf(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
    );
  },
  get serviceRoleKey() {
    /* SUPABASE_SECRET_KEY is what the Vercel integration calls the service-role
       key, and what a new Supabase project calls it in its own dashboard. */
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      firstOf(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]),
    );
  },
  get ldbApiUrl() {
    return process.env.LDB_API_URL ?? "https://ldb.co.in/api/ldbv2/truck/search";
  },
  get telegramBotToken() {
    return process.env.TELEGRAM_BOT_TOKEN ?? "";
  },
  /**
   * WhatsApp Cloud API, the second alert channel. Nothing is set yet - there is
   * no business account - so these are empty, whatsappConfigured() is false and
   * every send is a logged no-op. The url has a default because only the token
   * and the phone number id are ever account-specific; override it to move to a
   * newer Graph version without a code change.
   */
  get whatsappApiUrl() {
    return process.env.WHATSAPP_API_URL ?? "https://graph.facebook.com/v21.0";
  },
  get whatsappToken() {
    return process.env.WHATSAPP_TOKEN ?? "";
  },
  get whatsappPhoneId() {
    return process.env.WHATSAPP_PHONE_ID ?? "";
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
/**
 * What the admin health panel reports.
 *
 * IT MUST ASK THE SAME QUESTION THE APP ASKS. This read process.env directly
 * for each name, which meant it bypassed the fallbacks above - so a project
 * connected through the Supabase Vercel integration, which sets
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY rather than the
 * names this app was written against, showed "Supabase: not set" and "Service
 * role key: not set" while every query on the page was working.
 *
 * A health panel that disagrees with the running app is worse than no panel:
 * it sends somebody looking for a fault that is not there, and it would have
 * stayed silent about a real one. Each line below now resolves exactly the way
 * the accessor does, through a try/catch because the accessors throw on a
 * missing value by design.
 */
function resolves(read: () => string): boolean {
  try {
    return Boolean(read());
  } catch {
    return false;
  }
}

export function integrationHealth() {
  return {
    supabase: resolves(() => env.supabaseUrl) && resolves(() => env.supabaseAnonKey),
    serviceRole: resolves(() => env.serviceRoleKey),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    // False everywhere today, and expected to be: the channel is built but
    // unbought. Shown on the health panel so it reads as "not yet" rather than
    // as a feature nobody knows exists.
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
    googleSheets: Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ),
    cron: Boolean(process.env.CRON_SECRET),
    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    razorpayWebhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  };
}
