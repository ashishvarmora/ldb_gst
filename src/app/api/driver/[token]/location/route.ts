import { NextResponse, type NextRequest } from "next/server";

import { recordDriverReport, type IncomingPoint } from "@/lib/live-location";

/**
 * POST /api/driver/<token>/location - the driver's phone reporting in.
 *
 * Public: the token in the path is the only credential (see /d/[token]).
 * Body: { points: [{lat,lng,accuracy,speed,heading,t}], consent?: true, stop?: true }.
 * An empty points array is a heartbeat ("page still open").
 *
 * Validation, throttling (one request per ~8 s per token) and the India
 * bounding-box check live in recordDriverReport().
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous for 120 points, tiny for anything legitimate. */
const MAX_BODY_BYTES = 32_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const raw = body as { points?: unknown; consent?: unknown; stop?: unknown };
  const points = Array.isArray(raw.points)
    ? (raw.points.filter((p) => p && typeof p === "object") as IncomingPoint[])
    : [];

  const result = await recordDriverReport(token, {
    points,
    consent: raw.consent === true,
    stop: raw.stop === true,
  });

  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (result.status === 429 && "retryAfter" in result.body && result.body.retryAfter) {
    headers["Retry-After"] = String(result.body.retryAfter);
  }
  return NextResponse.json(result.body, { status: result.status, headers });
}
