import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { AdminChatThread } from "./AdminChatThread";
import { PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { CHAT_KEEP_DAYS, loadThread } from "@/lib/chat";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * One customer's conversation, from the admin's side.
 *
 * The account link in the header is the whole reason this is a page rather than
 * a panel on the list: answering a support message almost always means looking
 * at the balance, the plan or the last payment first, and that is one tap away
 * rather than a search.
 */
export const dynamic = "force-dynamic";

export default async function AdminChatThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;

  const admin = getSupabaseAdmin();

  /*
   * The account is read before the messages, and a missing one is a 404 rather
   * than an empty chat. A conversation whose owner has been deleted is not a
   * conversation anybody can usefully reply to, and rendering the box anyway
   * would let a reply be written into a thread nobody will ever open.
   */
  const { data: person } = await admin
    .from("profiles")
    .select("id, full_name, email, status")
    .eq("id", id)
    .maybeSingle<{ id: string; full_name: string | null; email: string; status: string }>();

  if (!person) notFound();

  const messages = await loadThread(admin, person.id, "admin");
  const name = person.full_name?.trim() || person.email;

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      <div className="mb-1">
        <Link
          href="/admin/chat"
          className="inline-flex min-h-9 items-center gap-1.5 text-xs text-muted transition hover:text-ink"
        >
          <ArrowLeft size={14} />
          All conversations
        </Link>
      </div>

      <PageHeader
        title={name}
        subtitle={
          <>
            {person.email}
            {person.status !== "active" ? " · account suspended" : ""} ·{" "}
            <Link href={`/admin/officers/${person.id}`} className="text-brand-400 hover:underline">
              Open account <ExternalLink size={11} className="inline align-[-1px]" />
            </Link>
          </>
        }
      />

      <AdminChatThread userId={person.id} initial={messages} keepDays={CHAT_KEEP_DAYS} />
    </div>
  );
}
