"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reportError } from "@/lib/errors";
import { done, fail, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { assertPortalUser } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/**
 * Case folders group the vehicles in one investigation, so an officer can look
 * at a whole fake-billing ring at once instead of truck by truck.
 */

async function ownedCase(userId: string, caseId: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("truck_groups")
    .select("id, name")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function createCase(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const name = str(fd, "name");
  if (!name) return fail("Give the case a name.");

  const { data, error } = await admin
    .from("truck_groups")
    .insert({
      user_id: session.id,
      name,
      description: str(fd, "description"),
    })
    .select("id")
    .single();

  if (error) return fail(reportError("creating a case", error, "Could not create that case."));

  // Optional seed list, e.g. pasted straight out of a notice.
  const seed = str(fd, "truck_numbers");
  let added = 0;
  if (seed) {
    const numbers = [
      ...new Set(
        seed
          .split(/[\s,;\n]+/)
          .map((item) => normalizeTruck(item))
          .filter((item) => looksLikeTruckNumber(item)),
      ),
    ];
    if (numbers.length > 0) {
      await admin.from("truck_group_members").upsert(
        numbers.map((truck_number) => ({ group_id: data.id, truck_number })),
        { onConflict: "group_id,truck_number", ignoreDuplicates: true },
      );
      added = numbers.length;
    }
  }

  revalidatePath("/portal/cases");
  return done(
    added > 0
      ? `Case "${name}" created with ${added} truck${added === 1 ? "" : "s"}.`
      : `Case "${name}" created.`,
  );
}

export async function updateCase(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const caseId = str(fd, "case_id");
  const name = str(fd, "name");
  if (!caseId) return fail("Missing case id.");
  if (!name) return fail("Give the case a name.");

  const { error } = await admin
    .from("truck_groups")
    .update({ name, description: str(fd, "description") })
    .eq("id", caseId)
    .eq("user_id", session.id);

  if (error) return fail(reportError("saving a case", error, "Could not save that case."));

  revalidatePath("/portal/cases");
  revalidatePath(`/portal/cases/${caseId}`);
  return done("Case saved.");
}

export async function deleteCase(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const caseId = str(fd, "case_id");
  if (!caseId) return fail("Missing case id.");

  const { error } = await admin
    .from("truck_groups")
    .delete()
    .eq("id", caseId)
    .eq("user_id", session.id);

  if (error) return fail(reportError("deleting a case", error, "Could not delete that case."));

  revalidatePath("/portal/cases");
  redirect("/portal/cases");
}

export async function addTruckToCase(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const caseId = str(fd, "case_id");
  const raw = str(fd, "truck_number");
  if (!caseId) return fail("Pick a case folder.");
  if (!raw) return fail("Enter a truck number.");

  const owned = await ownedCase(session.id, caseId);
  if (!owned) return fail("That case folder is not yours.");

  const truckNumber = normalizeTruck(raw);
  if (!looksLikeTruckNumber(truckNumber)) {
    return fail(`"${truckNumber}" does not look like a registration number.`);
  }

  const { error } = await admin
    .from("truck_group_members")
    .upsert({ group_id: caseId, truck_number: truckNumber }, {
      onConflict: "group_id,truck_number",
      ignoreDuplicates: true,
    });

  if (error) {
    return fail(reportError("adding a truck to a case", error, "Could not add that truck."));
  }

  revalidatePath("/portal/cases");
  revalidatePath(`/portal/cases/${caseId}`);
  return done(`${truckNumber} added to "${owned.name}".`);
}

export async function removeTruckFromCase(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const caseId = str(fd, "case_id");
  const truckNumber = str(fd, "truck_number");
  if (!caseId || !truckNumber) return fail("Missing case or truck.");

  const owned = await ownedCase(session.id, caseId);
  if (!owned) return fail("That case folder is not yours.");

  const { error } = await admin
    .from("truck_group_members")
    .delete()
    .eq("group_id", caseId)
    .eq("truck_number", truckNumber);

  if (error) {
    return fail(reportError("removing a truck from a case", error, "Could not remove that truck."));
  }

  revalidatePath(`/portal/cases/${caseId}`);
  return done(`${truckNumber} removed.`);
}
