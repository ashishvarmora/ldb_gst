import { LogExplorer, type LogQuery } from "@/components/LogExplorer";
import { PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";

export const metadata = { title: "Logs — Rahdari admin" };

/**
 * The one log screen.
 *
 * Searches, alert deliveries and admin actions were four separate pages plus
 * two dashboard previews, each with its own filters and row layout for the same
 * three tables. They are one surface now and everything else links here, so
 * "what happened around four o'clock on Tuesday" is one question asked in one
 * place rather than a guess about which screen holds the answer.
 *
 * The page is this short on purpose: it checks who is asking and hands over.
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<LogQuery>;
}) {
  await requireSuperAdmin();
  const query = await searchParams;

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Every search, every alert and every change made in this console. Filter by account, truck or day."
      />
      <LogExplorer query={query} />
    </>
  );
}
