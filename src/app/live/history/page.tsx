import { redirect } from "next/navigation";

import { logbookUrl } from "../logbook/redirect";

/* v6: History and Activity are one section now, the Logbook (docs/LIVE-PLAN-v6.md §3). Old links keep working. */
export default async function OldLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(logbookUrl(await searchParams));
}
