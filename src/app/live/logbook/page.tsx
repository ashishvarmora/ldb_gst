import { redirect } from "next/navigation";

import { logbookUrl } from "./redirect";

/** /live/logbook opens on Trips (filters kept). */
export default async function LogbookHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  redirect(logbookUrl(await searchParams));
}
