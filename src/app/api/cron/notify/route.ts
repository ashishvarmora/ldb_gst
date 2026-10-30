import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { sendUnseenChatEmails } from "@/lib/chat-email";
import { maybeSendDailySummary } from "@/lib/daily-summary";
import { env } from "@/lib/env";
import { reconcileRecentPayments } from "@/lib/payment-reconcile";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The light, frequent tick: mail and money, never trucks.
 *
 * /api/cron/track runs every five minutes and spends credits checking lorries.
 * An unread chat message is meant to be mailed about after two minutes, so it
 * cannot wait for that tick - and running the truck sweep every minute to get
 * there would cost five times the credits. So this endpoint does only the cheap
 * work, and is meant to be called every minute (cron-job.org, same secret,
 * same header as the tracking worker):
 *
 *   - unread chat messages, mailed to the customer or to the admins
 *   - the daily summary, once a day at the configured IST hour
 *   - payments Razorpay captured that nothing settled (payment-reconcile.ts)
 *
 * Each step is independent and never throws, so one failing does not stop the
 * others. The tracking tick runs the same three as a fallback, so a missing
 * minute-schedule only makes them slower, never absent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The same constant-time check as /api/cron/track - see the comment there. */
function secretMatches(candidate: string | null, secret: string): boolean {
  if (!candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  const secret = env.cronSecret;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not set." }, { status: 500 });
  }

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const queryKey = request.nextUrl.searchParams.get("key");
  if (!secretMatches(bearer, secret) && !secretMatches(queryKey, secret)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const started = Date.now();
  const admin = getSupabaseAdmin();

  const [chat, summary, payments] = await Promise.all([
    sendUnseenChatEmails(admin),
    maybeSendDailySummary(admin),
    reconcileRecentPayments(admin),
  ]);

  return NextResponse.json({ ok: true, durationMs: Date.now() - started, chat, summary, payments });
}

export const GET = handle;
export const POST = handle;
