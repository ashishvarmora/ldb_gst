import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { runTrackingSweep } from "@/lib/tracking";

/**
 * The tracking worker. One tick polls every truck whose interval has elapsed.
 *
 * Protect it with CRON_SECRET. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` automatically once that variable exists,
 * so no extra header configuration is needed there. Any other scheduler
 * (cron-job.org, Supabase pg_cron, a VPS crontab) just has to send the same
 * header.
 *
 * There is no other way in. A caller with no secret gets a 403 before anything
 * is read, and a missing CRON_SECRET refuses the whole endpoint rather than
 * leaving it open - a sweep spends credits and calls the toll portal for every
 * truck on the platform, so "unprotected" is not a state it may run in.
 */

// node:crypto for the comparison below, so this may not run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Compares a candidate against the secret without leaking where it stopped
 * matching.
 *
 * A plain `!==` returns as soon as two bytes differ, so the time it takes says
 * how much of the secret was right. That is enough to recover a secret one
 * character at a time given enough attempts, and this endpoint accepts as many
 * attempts as anyone cares to make.
 *
 * Both sides are hashed to a fixed width first. timingSafeEqual throws on
 * length mismatch, and comparing raw strings would otherwise leak the secret's
 * length through that throw before any byte was compared.
 */
function secretMatches(candidate: string | null, secret: string): boolean {
  if (!candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  const secret = env.cronSecret;

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set, so the worker refuses to run." },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  /*
   * The query string is the second-best way to send this and is only still
   * accepted because some schedulers cannot set a header. A URL is written to
   * access logs, kept in proxy caches and shown in a browser's history, so a
   * secret in one should be treated as a secret that will eventually be read.
   * Prefer the Authorization header wherever the scheduler allows it.
   */
  const queryKey = request.nextUrl.searchParams.get("key");

  if (!secretMatches(bearer, secret) && !secretMatches(queryKey, secret)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const batchParam = Number(request.nextUrl.searchParams.get("batch"));
  const batch = Number.isInteger(batchParam) && batchParam > 0 ? Math.min(batchParam, 300) : undefined;

  try {
    const summary = await runTrackingSweep({ batch });

    // Keep the response small; the per-truck detail is only useful when
    // something went wrong.
    const failures = summary.outcomes.filter((outcome) => outcome.status === "failed");
    const blocked = summary.outcomes.filter(
      (outcome) => outcome.status === "skipped" && outcome.reason,
    );

    return NextResponse.json({
      ok: true,
      trackingEnabled: summary.trackingEnabled,
      durationMs: summary.durationMs,
      candidates: summary.candidates,
      // A truck is due because one of its alerts came due. Nothing else asks
      // for a check, so a truck with no alerts never appears here.
      due: summary.due,
      checked: summary.checked,
      skipped: summary.skipped,
      failed: summary.failed,
      deferred: summary.deferred,
      // Trucks that stopped themselves on this tick, by reason. A rising
      // `inactive` count is how a too-tight platform setting shows up before
      // customers start asking why their lorries went quiet.
      autoPaused: summary.autoPaused,
      newEvents: summary.newEvents,
      alerts: summary.alerts,
      alertsDelivered: summary.alertsDelivered,
      errors: summary.errors,
      // null unless the backup-and-purge came due on this tick
      backup: summary.backup,
      failures: failures.map((outcome) => ({
        truck: outcome.truckNumber,
        error: outcome.error,
        reason: outcome.reason,
      })),
      blocked: blocked.map((outcome) => ({
        truck: outcome.truckNumber,
        reason: outcome.reason,
      })),
    });
  } catch (error) {
    // The caller here is a scheduler, not a person, so this one keeps the real
    // message: it is the only place the failure is visible when a sweep dies.
    console.error("tracking sweep crashed", error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
