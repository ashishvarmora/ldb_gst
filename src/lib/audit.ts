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
 * Append-only record of what people did. Never throws - a failed audit write
 * must not roll back the change that prompted it, but it is logged.
 *
 * Admins and officers both land here. actor_role separates them, because the
 * question worth asking of this table is "what has this officer been doing",
 * and that only works if the role is stamped at write time - the actor's
 * profile can change afterwards, and the log has to say what was true then.
 */
export async function writeAudit(actor: SessionUser, input: AuditInput): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_logs").insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.profile.role,
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

/**
 * Same row, for code that holds an officer's identity but not a SessionUser -
 * the worker and the shared lookup path, which run from a cron tick or from
 * inside another action and never have a request session to hand.
 */
export async function recordActivity(
  actor: { id: string; email: string; role: string },
  input: AuditInput,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_logs").insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
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

/**
 * An officer's own activity: searches, trucks, alerts, top-ups.
 *
 * The same table and the same row shape - this exists so the call sites in the
 * portal read as what they are, and so a future change to how officer activity
 * is recorded has one place to happen.
 */
export async function writeOfficerAudit(
  actor: SessionUser,
  input: AuditInput,
): Promise<void> {
  await writeAudit(actor, input);
}
