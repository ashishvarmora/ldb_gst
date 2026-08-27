import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SessionUser } from "@/lib/auth";

type AuditInput = {
  action: string;
  entity?: string;
  entityId?: string | null;
  entityLabel?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Append-only record of admin actions. Never throws - a failed audit write
 * must not roll back the change the admin just made, but it is logged.
 */
export async function writeAudit(actor: SessionUser, input: AuditInput): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_logs").insert({
      actor_id: actor.id,
      actor_email: actor.email,
      action: input.action,
      entity: input.entity ?? null,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      meta: input.meta ?? {},
    });
  } catch (error) {
    console.error("audit write failed", input.action, error);
  }
}

/** Only the fields that actually changed, for a readable audit trail. */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = before ? before[key] : undefined;
    const to = after[key];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      diff[key] = { from: from ?? null, to: to ?? null };
    }
  }
  return diff;
}
