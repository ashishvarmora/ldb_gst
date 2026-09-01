import { redirect } from "next/navigation";

/**
 * The audit log moved into the one log screen.
 *
 * Kept as a redirect rather than deleted: the console linked here from several
 * panels and an admin may well have it bookmarked, and a 404 on a page somebody
 * used yesterday reads as data having been lost. Filters carry across, so an
 * existing link to one actor's actions still lands on that actor's actions.
 */
export default async function AuditRedirect({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string; q?: string }>;
}) {
  const { actor, action } = await searchParams;
  const params = new URLSearchParams({ type: "admin" });
  if (actor) params.set("officer", actor);
  if (action) params.set("action", action);
  redirect(`/admin/logs?${params.toString()}`);
}
