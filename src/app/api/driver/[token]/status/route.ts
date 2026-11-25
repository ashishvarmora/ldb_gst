import { NextResponse, type NextRequest } from "next/server";

import { driverStatus, type DriverAction } from "@/lib/live/driver";

/**
 * POST /api/driver/<token>/status - the driver's big buttons on /d/<token>:
 * { action: "started" | "reached" | "delivered", lat?, lng?, note? }.
 *
 * Public: the token is the credential. Only moves a trip forward
 * (planned/loading -> in transit -> arrived -> delivered); the owner alone can
 * reopen or cancel.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: DriverAction[] = ["started", "reached", "delivered"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const text = await request.text().catch(() => "");
  if (!text || text.length > 4_000) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const action = body.action as DriverAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
  const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;
  const note = typeof body.note === "string" ? body.note : null;

  const result = await driverStatus(token, action, lat !== null && lng !== null ? { lat, lng } : null, note);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true, status: result.status }, { headers: { "Cache-Control": "no-store" } });
}
