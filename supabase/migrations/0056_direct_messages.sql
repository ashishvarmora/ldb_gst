-- ===========================================================================
-- A customer and the admin can talk to each other inside the app.
--
-- Until now the only channel between the two was email, which is slow, lands in
-- a promotions tab, and gives neither side any idea whether the other has read
-- anything. This is the direct one: a single conversation per customer, the
-- shape of a messaging app rather than a ticket system, kept for seven days and
-- then gone.
--
-- ---------------------------------------------------------------------------
-- 1 · WHY THERE IS NO THREADS TABLE
--
-- Every conversation here has exactly two sides - one customer, and whoever is
-- on the admin desk - so the customer IS the thread. A threads table would add
-- a row that carries no information the customer's own id does not already
-- carry, and a second place for "who is this conversation with" to drift out of
-- step with the first.
--
-- So user_id on a message means "whose conversation this belongs to", never
-- "who wrote it". Who wrote it is sender_role, plus sender_id for the audit
-- trail. An admin's message in Ravi's conversation therefore has Ravi's user_id
-- and the admin's sender_id, which reads oddly for a second and is the only
-- arrangement that lets one index serve the whole thread.
--
-- ---------------------------------------------------------------------------
-- 2 · SEVEN DAYS, ENFORCED IN TWO PLACES ON PURPOSE
--
-- purge_chat_messages() below does the deleting, called from the same sweep
-- that already runs the backup and purge. But a promise about privacy must not
-- depend on a scheduler that can be paused, misconfigured or simply late - the
-- cron on this deployment is external, and it has been quiet before.
--
-- So every read in src/lib/chat.ts also filters on the same window. Messages
-- become invisible at seven days whether or not anything has deleted them, and
-- the purge is then only about keeping the table small. One of those two is
-- allowed to fail without the guarantee failing with it.
--
-- ---------------------------------------------------------------------------
-- 3 · WHY read_at RATHER THAN A COUNTER
--
-- An unread badge could be a number on a threads table, kept in step by every
-- writer. Per-message read_at instead: a counter is a cache, caches drift, and
-- a support inbox that says "3 unread" over an empty conversation is the kind
-- of thing nobody can explain afterwards. Counting unread rows is a cheap index
-- scan at this size, and it cannot disagree with the messages themselves.
-- ===========================================================================

create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),

  -- WHOSE conversation. Always the customer, never the admin - see note 1.
  -- Cascades: a deleted account takes its conversation with it, which is the
  -- correct reading of a deletion request.
  user_id      uuid not null references public.profiles(id) on delete cascade,

  -- WHO WROTE IT. Two values only; there is no bot and no system sender, and
  -- adding one later should be a deliberate migration rather than a string
  -- somebody passed in.
  sender_role  text not null check (sender_role in ('customer', 'admin')),

  /*
   * Which admin wrote it, for the record. Nullable and ON DELETE SET NULL
   * rather than cascade: an admin leaving must not silently delete their side
   * of a conversation the customer can still see. The message stays and stops
   * naming anybody.
   */
  sender_id    uuid references public.profiles(id) on delete set null,

  -- Trimmed and bounded at the database, not only in the form. 2000 characters
  -- is a long support message and a short abuse vector.
  body         text not null check (length(btrim(body)) between 1 and 2000),

  created_at   timestamptz not null default now(),

  -- Null until the OTHER side opens the conversation. Never set by the sender.
  read_at      timestamptz
);

-- The thread read: one customer's messages, newest last. Covers the seven-day
-- window filter too, since it leads with user_id and orders on created_at.
create index if not exists chat_messages_thread_idx
  on public.chat_messages (user_id, created_at);

/*
 * The badge read: "how many unread, and for whom". Partial, because a read
 * message is never counted and there is no reason to carry it in the index -
 * which keeps this index roughly the size of the unread backlog rather than of
 * the whole week.
 */
create index if not exists chat_messages_unread_idx
  on public.chat_messages (user_id, sender_role)
  where read_at is null;

comment on table public.chat_messages is
  'Direct messages between one customer and the admin desk. user_id is whose conversation it is, not who wrote it. Kept 7 days - see purge_chat_messages() and the matching window in src/lib/chat.ts.';

-- ---------------------------------------------------------------------------
-- 4 · The purge
--
-- Takes the window as an argument with the same default the application uses,
-- so a one-off manual clear-out is possible without editing the function, and
-- so the number appears in exactly one place per side.
--
-- Returns the count because the sweep logs it: "chat: 0 deleted" every tick for
-- a week and then a number is how you notice it is working at all.
-- ---------------------------------------------------------------------------
create or replace function public.purge_chat_messages(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'purge_chat_messages: p_days must be at least 1, got %', p_days;
  end if;

  delete from public.chat_messages
   where created_at < now() - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_chat_messages(integer) is
  'Deletes chat messages older than p_days (default 7). Called from the tracking sweep. Reads are independently windowed, so a missed run hides nothing it should not.';

-- ---------------------------------------------------------------------------
-- 5 · Nothing reaches this table with a browser key
--
-- Same posture as push_subscriptions in 0054. Every read and write goes through
-- a server action that has already established who is asking and whose
-- conversation they are entitled to - see src/lib/chat.ts - so the anon and
-- authenticated roles need no access at all, and RLS with no policy is the
-- clearest way to say so. A private conversation is exactly the wrong table to
-- leave one forgotten policy away from being public.
-- ---------------------------------------------------------------------------
alter table public.chat_messages enable row level security;

revoke all on public.chat_messages from public;
revoke all on public.chat_messages from anon, authenticated;
grant select, insert, update, delete on public.chat_messages to service_role;

-- SECURITY DEFINER runs as the owner, so the execute grant is the whole of the
-- access control on it. Only the server ever calls this.
revoke all on function public.purge_chat_messages(integer) from public;
revoke all on function public.purge_chat_messages(integer) from anon, authenticated;
grant execute on function public.purge_chat_messages(integer) to service_role;
