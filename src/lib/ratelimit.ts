import { headers } from "next/headers";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * How often one person may do one thing.
 *
 * WHY THE DATABASE. This deploys to Vercel, where consecutive requests land on
 * whichever serverless instance happens to be warm. A counter in a Map is
 * therefore not a limit: ten instances answering a password spray each count to
 * ten and let a hundred attempts through, and a fresh instance starts at zero.
 * The real count lives in one place both instances can see, which here means a
 * row in Postgres and rate_limit_hit() doing the increment atomically.
 *
 * WHY THERE IS STILL A MAP. A round trip per attempt is the wrong answer to a
 * hot loop: the loop is the thing being refused, and paying a database call to
 * say no to it hands the attacker a way to make the database the bottleneck.
 * So each instance remembers what the database last told it. Once a bucket is
 * known to be over its limit, this instance refuses locally until the window
 * turns over, and stops asking. The Map is a cache of refusals, never the
 * authority on permission.
 *
 * WHY IT FAILS OPEN. If the database call errors - a cold connection, a
 * migration in flight, the pooler out of slots - the request is allowed and the
 * failure is logged. A limiter that fails closed turns its own outage into a
 * total sign-in outage, which is a worse day than the one it was protecting
 * against. The log line is how anyone finds out it happened.
 */

export type RateVerdict = {
  allowed: boolean;
  /** Attempts left in this window. Zero once refused. */
  remaining: number;
  /** Whole seconds until the window turns over. Zero when allowed. */
  retryAfter: number;
};

type Rule = {
  /** How many hits the window allows before the next one is refused. */
  limit: number;
  windowSeconds: number;
};

const MINUTE = 60;
const HOUR = 60 * 60;

/**
 * Every limit in the app, with the reasoning for the number beside it. The
 * numbers are meant to be invisible to anyone using the product honestly and
 * ruinous to anyone scripting it, so each one is set against what real use
 * actually looks like rather than against a round figure.
 */
export const RATE_LIMITS = {
  /*
   * SIGNING IN. An office shares one public IP, so the per-address limit has to
   * survive several colleagues arriving at nine o'clock; twenty in a quarter
   * hour does, and a spray through a list of accounts does not.
   */
  "login:ip": { limit: 20, windowSeconds: 15 * MINUTE },
  /*
   * The per-email limit is the one that matters, because it is the one an
   * attacker with a botnet cannot spread across addresses. Somebody who has
   * forgotten which password they used tries three or four and then asks for a
   * reset link; eight leaves room for a caps-lock key without leaving room for
   * a dictionary.
   */
  "login:email": { limit: 8, windowSeconds: 15 * MINUTE },

  /*
   * SIGNING UP. Every new account is handed the free-tier credits, so this is
   * the throttle on manufacturing them - and on the follow-on trick of
   * redeeming one bonus code once per account. Five an hour still covers a
   * manager registering their whole team in one sitting.
   */
  "signup:ip": { limit: 5, windowSeconds: HOUR },

  /*
   * PASSWORD RESETS. Each one sends a real email from our domain, so an
   * unlimited form is a mail cannon pointed at whichever address is typed into
   * it. Three an hour to one address is more than anyone needs and far too few
   * to be worth using as a weapon; ten from one IP allows a shared office
   * without allowing a list.
   */
  "forgot:ip": { limit: 10, windowSeconds: HOUR },
  "forgot:email": { limit: 3, windowSeconds: HOUR },

  /*
   * VERIFYING A MAILBOX before the free trial. Each send is a real email from
   * our domain to an address somebody typed, so an unlimited form is a mail
   * cannon pointed at a stranger's inbox - the same shape as the reset form
   * above, and limited the same way.
   *
   * Per account rather than per address: the address is read from the profile,
   * not from the form, so the account is the thing being throttled. Five in a
   * quarter hour covers a code that went to spam and a genuine second attempt.
   * The database throttles to one a minute on top of this, which is the floor
   * that holds even if the endpoint is reached another way.
   */
  "email_code:user": { limit: 5, windowSeconds: 15 * MINUTE },
  "email_code:ip": { limit: 20, windowSeconds: 15 * MINUTE },
  /*
   * CHECKING a code. The row itself dies after five wrong guesses, so this is
   * the limit on burning through fresh rows - twelve attempts covers two
   * honestly mistyped codes and a resend.
   */
  "email_verify:user": { limit: 12, windowSeconds: 15 * MINUTE },

  /*
   * OPENING A CHECKOUT. Each call creates a payments row and a real order at
   * Razorpay. A buyer who changes their mind between packs a few times fits
   * inside ten; a script opening orders in a loop to hold coupon claims does
   * not.
   */
  "checkout:user": { limit: 10, windowSeconds: 10 * MINUTE },

  /*
   * REDEEMING A CREDIT CODE. This is the brute-force target - a hit is worth
   * free credits, and the answer distinguishes "no such code" from every other
   * refusal, so the form is an oracle as well as a prize. Somebody holding a
   * code needs one attempt and mistypes it at most twice. Ten an hour makes
   * guessing pointless without making a typo expensive.
   */
  "coupon:user": { limit: 10, windowSeconds: HOUR },
  /*
   * The discount-code preview asks the same oracle, so it is limited too - but
   * it is typed at a checkout and legitimately re-asked every time the amount
   * changes, which is why it gets far more room than the redemption above.
   */
  "coupon:preview": { limit: 30, windowSeconds: 10 * MINUTE },

  /*
   * SEARCHING FOR A TRUCK. The credit balance is the real cap on how many
   * searches somebody may run, and this is not trying to replace it. It is here
   * because a stuck retry loop in a client would otherwise empty a balance and
   * hammer the toll portal in the time it takes to notice - and because the
   * toll portal rate-limits us collectively, so one runaway account degrades
   * the service for everyone.
   */
  "search:user": { limit: 20, windowSeconds: MINUTE },

  /*
   * EXPORTING THE LEDGER. One request can assemble fifty thousand rows and a
   * profile lookup for every account in them. Nobody downloads the same
   * spreadsheet six times in five minutes on purpose.
   */
  "export:user": { limit: 5, windowSeconds: 5 * MINUTE },
} as const satisfies Record<string, Rule>;

export type RateBucket = keyof typeof RATE_LIMITS;

/* -------------------------------------------------------------------------- */
/* the in-process cache of refusals                                            */
/* -------------------------------------------------------------------------- */

type LocalCount = {
  /** Milliseconds. The start of the window this instance thinks it is in. */
  windowStartedAt: number;
  hits: number;
  /** Milliseconds. While in the future, refuse without asking the database. */
  blockedUntil: number;
};

const local = new Map<string, LocalCount>();

/**
 * A cap on the Map, because a serverless instance can live for hours and every
 * distinct IP that ever reached it would otherwise stay in memory. Pruned only
 * when it grows past this, so the ordinary path costs nothing.
 */
const LOCAL_MAX_KEYS = 5_000;

function prune(now: number): void {
  if (local.size <= LOCAL_MAX_KEYS) return;
  for (const [key, entry] of local) {
    // Anything whose window is long over and which is not currently blocked
    // tells us nothing we would act on.
    if (entry.blockedUntil <= now && now - entry.windowStartedAt > HOUR * 1000) {
      local.delete(key);
    }
  }
  // Still full: the instance is genuinely seeing that many live callers, so
  // drop the oldest insertions rather than growing without bound.
  if (local.size > LOCAL_MAX_KEYS) {
    const overflow = local.size - LOCAL_MAX_KEYS;
    let dropped = 0;
    for (const key of local.keys()) {
      local.delete(key);
      if (++dropped >= overflow) break;
    }
  }
}

const allow = (remaining: number): RateVerdict => ({ allowed: true, remaining, retryAfter: 0 });

const refuse = (retryAfter: number): RateVerdict => ({
  allowed: false,
  remaining: 0,
  retryAfter: Math.max(1, Math.ceil(retryAfter)),
});

/* -------------------------------------------------------------------------- */
/* asking                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Counts one attempt against a bucket and says whether it may proceed.
 *
 * `identity` is whatever the bucket counts - an IP address, an email, an
 * account id. A blank one is allowed through rather than lumped into a shared
 * bucket: a caller with no identity to offer is usually a header that did not
 * arrive, and giving everyone in that position one counter between them would
 * be a denial-of-service switch anybody could flip by stripping a header.
 */
export async function rateLimit(
  bucket: RateBucket,
  identity: string | null | undefined,
): Promise<RateVerdict> {
  const rule = RATE_LIMITS[bucket];
  const who = (identity ?? "").trim().toLowerCase();
  if (!who) return allow(rule.limit);

  const key = `${bucket}:${who}`;
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;

  const seen = local.get(key);

  // Already known to be over. This is the fast path a hot loop lands on, and
  // the whole reason the Map exists: no database call, no connection, no cost
  // beyond a lookup.
  if (seen && seen.blockedUntil > now) {
    return refuse((seen.blockedUntil - now) / 1000);
  }

  const entry: LocalCount =
    seen && now - seen.windowStartedAt < windowMs
      ? { ...seen, hits: seen.hits + 1 }
      : { windowStartedAt: now, hits: 1, blockedUntil: 0 };

  /*
   * This instance alone has already seen more than the whole allowance, so the
   * answer cannot be yes whatever the shared count says. Refusing here matters
   * when a burst arrives faster than the database round trips complete: without
   * it, every request in the burst is in flight before any of them has been
   * counted.
   */
  if (entry.hits > rule.limit) {
    entry.blockedUntil = entry.windowStartedAt + windowMs;
    local.set(key, entry);
    prune(now);
    return refuse((entry.blockedUntil - now) / 1000);
  }

  local.set(key, entry);
  prune(now);

  try {
    const { data, error } = await getSupabaseAdmin().rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_identity: who,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (error) throw error;

    const verdict = (data ?? {}) as { allowed?: boolean; remaining?: number; retry_after?: number };

    if (verdict.allowed === false) {
      const retryAfter = Number(verdict.retry_after) || rule.windowSeconds;
      entry.blockedUntil = now + retryAfter * 1000;
      local.set(key, entry);
      return refuse(retryAfter);
    }

    return allow(Number(verdict.remaining) || 0);
  } catch (error) {
    /*
     * Fail open, loudly. The shared counter is unavailable, so the only honest
     * options are "let everyone in" and "let nobody in", and locking every real
     * customer out of their account because a rate limiter could not reach the
     * database is the worse of the two. The local counter above still holds,
     * so a hot loop against this instance is refused regardless.
     */
    console.error(`rate limit: ${bucket} could not be counted, allowing through:`, error);
    return allow(rule.limit);
  }
}

/* -------------------------------------------------------------------------- */
/* who is asking                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The caller's IP address, as far as anything can be sure of it.
 *
 * On Vercel the edge network sets x-forwarded-for and the LAST entry is the one
 * it observed - but it also sets x-real-ip to exactly that address, so x-real-ip
 * is preferred and the first x-forwarded-for entry is the fallback for running
 * anywhere else.
 *
 * This is a header, which means the client can write whatever it likes in it
 * behind a proxy that does not overwrite it. So it is used for RATE LIMITING
 * AND NOTHING ELSE. It never decides who someone is, what they may see or what
 * they own - those all come from the session. The worst a forged header buys is
 * a fresh bucket, which is the same thing a new IP address buys, and the
 * per-email and per-account limits are there because of it.
 */
export async function clientIp(): Promise<string> {
  const head = await headers();

  const real = head.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = head.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "";
}

/* -------------------------------------------------------------------------- */
/* saying no                                                                   */
/* -------------------------------------------------------------------------- */

/** "in 45 seconds" / "in 3 minutes" - rounded the way a person would say it. */
function describeWait(seconds: number): string {
  if (seconds <= 90) return `in ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "in a minute" : `in ${minutes} minutes`;
}

/**
 * The refusal, worded for whoever hit it.
 *
 * `subject` finishes the sentence "Too many ..." - "sign-in attempts", "codes
 * tried". Deliberately says nothing about what the limit is or how much of it
 * is left: a counter shown to a person being throttled is a counter shown to
 * whoever is scripting them, and it turns guesswork into arithmetic.
 */
export function rateLimitMessage(verdict: RateVerdict, subject: string): string {
  return `Too many ${subject}. Please try again ${describeWait(verdict.retryAfter)}.`;
}
