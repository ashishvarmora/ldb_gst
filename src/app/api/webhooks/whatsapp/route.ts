import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Meta's WhatsApp webhook. In the Meta app: WhatsApp → Configuration →
 * Callback URL https://rahdari.in/api/webhooks/whatsapp, Verify token =
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN, and subscribe the `messages` field.
 *
 * GET  - Meta's one-time check of the url: echo hub.challenge when the
 *        verify token matches.
 * POST - message statuses (sent / delivered / read / failed) for what we sent,
 *        recorded against the wamid in whatsapp_messages, and messages people
 *        send to the Rahdari number (logged only, for a future inbox).
 *
 * Every POST is signed: X-Hub-Signature-256 = HMAC-SHA256 of the raw body with
 * the app secret. Without META_APP_SECRET nothing is accepted.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const expected = env.whatsappWebhookVerifyToken;
  if (q.get("hub.mode") === "subscribe" && expected && q.get("hub.verify_token") === expected) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

function signatureValid(raw: string, header: string | null): boolean {
  const secret = env.metaAppSecret;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"), "utf8");
  const given = Buffer.from(header.slice("sha256=".length), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type StatusEvent = {
  id?: string;
  status?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};

const ORDER: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!signatureValid(raw, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: { statuses?: StatusEvent[]; messages?: unknown[] } }[] }[] } | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const statuses: StatusEvent[] = [];
  let incoming = 0;
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      statuses.push(...(change.value?.statuses ?? []));
      incoming += change.value?.messages?.length ?? 0;
    }
  }
  if (incoming) console.info(`[whatsapp] ${incoming} incoming message(s) received`);

  const admin = getSupabaseAdmin();
  for (const event of statuses) {
    if (!event.id || !event.status || !(event.status in ORDER)) continue;
    const { data: row } = await admin
      .from("whatsapp_messages")
      .select("status")
      .eq("wamid", event.id)
      .maybeSingle<{ status: string }>();
    // Statuses can arrive out of order; never move "read" back to "delivered".
    if (row && (ORDER[row.status] ?? 0) >= ORDER[event.status] && event.status !== "failed") continue;
    const err = event.errors?.[0];
    const { error } = await admin
      .from("whatsapp_messages")
      .update({
        status: event.status,
        error_code: err?.code ?? null,
        error_message: err ? (err.error_data?.details ?? err.message ?? err.title ?? null) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("wamid", event.id);
    if (error) console.error("[whatsapp] status update failed:", error.message);
  }

  return NextResponse.json({ ok: true });
}
