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
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: NextRequest) {
  const secret = env.cronSecret;

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set, so the worker refuses to run." },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization");
  const queryKey = request.nextUrl.searchParams.get("key");

  if (header !== `Bearer ${secret}` && queryKey !== secret) {
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
      due: summary.due,
      polled: summary.polled,
      skipped: summary.skipped,
      failed: summary.failed,
      deferred: summary.deferred,
      newEvents: summary.newEvents,
      alerts: summary.alerts,
      alertsDelivered: summary.alertsDelivered,
      sheetErrors: summary.sheetErrors,
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
    console.error("tracking sweep crashed", error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
