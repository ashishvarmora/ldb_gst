"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { fail, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { runManualLookup } from "@/lib/manual-search";
import { assertPortalUser } from "@/lib/officer";
import type { ActionResult } from "@/lib/types";

/**
 * Manual lookup from the search box. On success the officer lands on a permanent
 * URL for that truck, so the result can be revisited without spending another
 * credit.
 */
export async function manualSearch(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();

  const raw = str(fd, "truck_number");
  if (!raw) return fail("Enter a truck number.");

  const truckNumber = normalizeTruck(raw);
  if (truckNumber.length < 6) return fail("That truck number looks too short.");
  if (!looksLikeTruckNumber(truckNumber)) {
    return fail(`"${truckNumber}" does not look like a registration number. Example: GJ02AT8546`);
  }

  const result = await runManualLookup({ userId: session.id, truckNumber });
  if (!result.ok) return fail(result.error);

  revalidatePath("/portal");
  revalidatePath("/portal/search");
  redirect(`/portal/search/${truckNumber}`);
}

/**
 * Re-runs a lookup for a truck already on screen. Spends another credit, and
 * says so on the button, so it is never a surprise.
 */
export async function searchAgain(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();

  const raw = str(fd, "truck_number");
  if (!raw) return fail("Missing truck number.");
  const truckNumber = normalizeTruck(raw);

  const result = await runManualLookup({ userId: session.id, truckNumber });
  if (!result.ok) return fail(result.error);

  revalidatePath("/portal");
  revalidatePath(`/portal/search/${truckNumber}`);

  return {
    ok: true,
    message:
      result.newCount > 0
        ? `${result.newCount} new crossing${result.newCount === 1 ? "" : "s"} found.`
        : `No new crossings. The portal is showing ${result.found} recent crossing${result.found === 1 ? "" : "s"}.`,
  };
}
