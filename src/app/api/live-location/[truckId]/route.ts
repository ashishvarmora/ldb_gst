import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { inviteDriver, loadLiveLocation, revokeDriver } from "@/lib/live-location";

/**
 * The owner's side of live location, for LiveLocationCard.
 *
 *   GET  -> LiveLocationView JSON (polled every ~30 s while the card is visible)
 *   POST { action: "invite", driverName?, phone?, ownerLabel? } -> new link (old one revoked)
 *   POST { action: "revoke" }                                   -> stop sharing
 *
 * A JSON route rather than router.refresh(), so the 30-second poll re-reads two
 * small queries instead of re-rendering the whole truck page.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function owner() {
  const session = await getSessionUser();
  if (!session) return { error: NextResponse.json({ error: "Please sign in again." }, { status: 401, headers: NO_STORE }) };
  if (session.profile.status !== "active") {
    return { error: NextResponse.json({ error: "Account suspended." }, { status: 403, headers: NO_STORE }) };
  }
  return { session };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params;
  const who = await owner();
  if (who.error) return who.error;

  const view = await loadLiveLocation(who.session.id, truckId);
  if (!view) return NextResponse.json({ error: "Truck not found." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(view, { headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params;
  const who = await owner();
  if (who.error) return who.error;

  // Same-origin only: this changes state, and the session cookie is SameSite=Lax.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Bad origin." }, { status: 403, headers: NO_STORE });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : null);

  const result =
    body.action === "invite"
      ? await inviteDriver(who.session.id, truckId, {
          driverName: str(body.driverName),
          phone: str(body.phone),
          ownerLabel: str(body.ownerLabel),
        })
      : body.action === "revoke"
        ? await revokeDriver(who.session.id, truckId)
        : ({ ok: false, error: "Unknown action." } as const);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400, headers: NO_STORE });
  }
  const view = await loadLiveLocation(who.session.id, truckId);
  return NextResponse.json(view, { headers: NO_STORE });
}
