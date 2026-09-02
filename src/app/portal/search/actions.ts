"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { fail, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { runManualLookup } from "@/lib/manual-search";
import { assertPortalUser } from "@/lib/officer";
import { rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import type { ActionResult } from "@/lib/types";

/**
 * Both lookups here are throttled per account, and neither limit is about
 * abuse of the balance: the credit charge already caps how many searches
 * somebody may run, and spend_credits decides that atomically. This exists for
 * the two things a balance does not cover - a client stuck in a retry loop,
 * which would empty that balance in seconds before anybody noticed, and the
 * toll portal upstream, which rate-limits this platform as a whole and so lets
 * one runaway account degrade every other officer's searches.
 */
const SEARCH_SUBJECT = "searches at once";

/**
 * Manual lookup from the search box. On success it lands on a permanent URL for
 * that truck, so the result can be revisited without spending another credit.
 */
export async function manualSearch(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();

  const throttle = await rateLimit("search:user", session.id);
  if (!throttle.allowed) return fail(rateLimitMessage(throttle, SEARCH_SUBJECT));

  const raw = str(fd, "truck_number");
  if (!raw) return fail("Enter a truck number.");

  const truckNumber = normalizeTruck(raw);
  if (truckNumber.length < 6) return fail("That truck number looks too short.");
  if (!looksLikeTruckNumber(truckNumber)) {
    return fail(`"${truckNumber}" does not look like a registration number. Example: MH12AB1234`);
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

  const throttle = await rateLimit("search:user", session.id);
  if (!throttle.allowed) return fail(rateLimitMessage(throttle, SEARCH_SUBJECT));

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
        : `No new crossings. The toll network is showing ${result.found} recent crossing${result.found === 1 ? "" : "s"}.`,
  };
}
