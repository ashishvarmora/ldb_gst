import Link from "next/link";
import { ArrowLeft, Search, UserRound } from "lucide-react";

import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { loadThreads } from "@/lib/chat";
import { fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Pick somebody to write to first.
 *
 * The conversation list only shows accounts that have said something, which is
 * right for a queue and useless for starting one - so this is the other door.
 * A customer chosen here goes straight to their (empty) thread; nothing is
 * written until a message is actually sent, so browsing this page leaves no
 * trace and creates no half-open conversations.
 *
 * The search is a plain GET form against ?q=, like every other filter in this
 * console: no JavaScript, linkable, and the back button steps out of it.
 */
export const dynamic = "force-dynamic";

export default async function NewConversationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperAdmin();
  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const admin = getSupabaseAdmin();

  let query = admin
    .from("profiles")
    .select("id, full_name, email, status, last_active_at")
    .eq("role", "officer")
    .eq("status", "active")
    .order("full_name", { nullsFirst: false })
    .limit(100);

  /*
   * Name OR email. The comma form is Supabase's OR, and the term is stripped
   * of the characters that would otherwise end the filter early and change its
   * meaning - a customer called O'Brien must be searchable, not a syntax error.
   */
  if (term) {
    const safe = term.replace(/[,()*]/g, " ").trim();
    if (safe) query = query.or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const [{ data: people }, threads] = await Promise.all([query, loadThreads(admin)]);

  // Who already has a conversation, so the page says "open" rather than
  // pretending every row is a fresh start.
  const existing = new Map(threads.map((thread) => [thread.userId, thread]));
  const rows = people ?? [];

  return (
    <>
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
        title="New message"
        subtitle="Choose a customer to write to. Nothing is sent until you type a message on the next screen."
      />

      {/* GET, so the term lands in the URL and the result can be linked. */}
      <form method="get" className="mb-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Search by name or email"
            aria-label="Search customers"
            className="field pl-9"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-on-brand transition hover:bg-brand-600"
        >
          Search
        </button>
      </form>

      <Panel bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState
            title={term ? "Nobody matches that" : "No active customers"}
            description={
              term
                ? "Try part of a name or an email address."
                : "Once an account is active it can be messaged from here."
            }
            action={term ? <Link href="/admin/chat/new">Show everyone</Link> : undefined}
          />
        ) : (
          <ul className="divide-y divide-divider">
            {rows.map((person) => {
              const thread = existing.get(person.id as string);
              const name = (person.full_name as string | null)?.trim() || (person.email as string);

              return (
                <li key={person.id as string}>
                  <Link
                    href={`/admin/chat/${person.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-raised/50 sm:px-5"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken text-muted">
                      <UserRound size={16} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{name}</span>
                      <span className="block truncate text-xs text-muted">
                        {person.email as string}
                      </span>
                    </span>

                    {/* Says which door this is: a new conversation, or one that
                        is already running and would be continued. */}
                    {thread ? (
                      <Badge tone="neutral">
                        {`talked ${fmtRelative(thread.lastMessageAt)}`}
                      </Badge>
                    ) : (
                      <Badge tone="brand">new</Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
