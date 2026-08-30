"use server";

import { revalidatePath } from "next/cache";

import { assertPortalUser } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Marks every unread alert as read.
 *
 * The bell is the only place alerts are seen now, so opening it is the whole
 * "I have looked at these" gesture - there is no list page left to visit and no
 * per-row tick to press.
 */
export async function markAlertsRead(): Promise<void> {
  const session = await assertPortalUser();

  await getSupabaseAdmin()
    .from("alert_logs")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.id)
    .is("read_at", null);

  // The unread count lives in the portal layout, so the whole segment is stale.
  revalidatePath("/portal", "layout");
}
