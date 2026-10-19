"use server";

import { recordAnnouncementEvent } from "@/lib/announcements";
import { assertPortalUser } from "@/lib/officer";

/**
 * The portal's half of announcements: a customer saw, closed or tapped one.
 *
 * Fire-and-forget from <Announcements>, so these return nothing and swallow
 * everything - a failed write costs one stats row, and an exception here would
 * surface as an error overlay on a page the customer was only reading.
 */
export async function markAnnouncements(
  ids: string[],
  kind: "seen" | "dismissed" | "clicked",
): Promise<void> {
  try {
    if (!Array.isArray(ids) || !["seen", "dismissed", "clicked"].includes(kind)) return;
    const session = await assertPortalUser();
    await recordAnnouncementEvent(
      session.id,
      ids.filter((id) => typeof id === "string"),
      kind,
    );
  } catch (error) {
    console.error("[announcements] mark failed:", error);
  }
}
