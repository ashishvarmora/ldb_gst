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

/**
 * Empties the bell.
 *
 * Sets cleared_at rather than deleting. The bell is a reading surface, not the
 * record: the rows stay for the admin's alert log and for the account's own
 * history, and only stop being listed here. Somebody who clears by accident has
 * lost a panel, not evidence.
 *
 * read_at is set in the same write. A row that was never opened but has been
 * cleared should not keep the badge lit from behind a panel that no longer
 * shows it.
 */
export async function clearAlerts(): Promise<void> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  /*
   * Two writes, and the order matters. Anything still unread is stamped read
   * first - a row that was never opened but has been cleared must not keep the
   * badge lit from behind a panel that no longer lists it. Narrowed to
   * read_at is null so a row that was genuinely read last Tuesday keeps saying
   * Tuesday rather than being back-dated to this click.
   */
  await admin
    .from("alert_logs")
    .update({ read_at: now })
    .eq("user_id", session.id)
    .is("read_at", null)
    .is("cleared_at", null);

  await admin
    .from("alert_logs")
    .update({ cleared_at: now })
    .eq("user_id", session.id)
    .is("cleared_at", null);

  revalidatePath("/portal", "layout");
}
