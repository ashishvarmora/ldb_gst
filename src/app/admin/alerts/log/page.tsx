import { redirect } from "next/navigation";

/** The alert delivery log is a filter on the one log screen now. */
export default async function AlertLogRedirect({
  searchParams,
}: {
  searchParams: Promise<{ officer?: string; delivered?: string }>;
}) {
  const { officer, delivered } = await searchParams;
  const params = new URLSearchParams({ type: "alerts" });
  if (officer) params.set("officer", officer);
  // The old page spelled this as delivered=false; the new one as status=failed.
  if (delivered === "false") params.set("status", "failed");
  if (delivered === "true") params.set("status", "ok");
  redirect(`/admin/logs?${params.toString()}`);
}
