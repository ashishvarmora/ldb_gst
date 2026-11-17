-- 0066: Saved trucks - a customer's own short list of numbers to check by hand.
--
-- Owner's ask (17 Nov 2026): "aaj ke 10 truck mujhe manually kabhi bhi check
-- karne hote hai" - a list to come back to and check with one tap, without
-- automatic tracking. Different from tracked_trucks on purpose:
--
--   saved_trucks    checked only when the customer taps Check; no alerts; no
--                   plan or truck slot needed; costs a manual search each time
--   tracked_trucks  checked automatically on an interval; alerts; needs a plan
--
-- The last result is kept on the row (written by every manual lookup of that
-- number, from anywhere) so the list can say "15h ago at Chabri Toll Plaza"
-- without a query per row. At most 25 per customer - small enough to stay a
-- list someone actually reads, and enforced here as well as in the app.

create table if not exists public.saved_trucks (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  truck_number     text not null check (truck_number ~ '^[A-Z0-9]{4,15}$'),
  label            text check (label is null or length(label) <= 40),
  created_at       timestamptz not null default now(),
  -- The last manual lookup of this number by this customer.
  last_checked_at  timestamptz,
  last_ok          boolean,
  last_found       integer,
  last_new         integer,
  last_error       text,
  -- The newest crossing on record at that moment.
  last_plaza       text,
  last_event_at    timestamptz,
  last_direction   text,
  primary key (user_id, truck_number)
);

comment on table public.saved_trucks is
  'A customer''s own list of up to 25 truck numbers to check by hand (0066). Not tracking: no automatic checks, no alerts, no plan needed.';

create index if not exists saved_trucks_user_idx on public.saved_trucks (user_id, created_at desc);

create or replace function public.saved_trucks_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.saved_trucks where user_id = new.user_id) >= 25 then
    raise exception 'saved_trucks_full' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists saved_trucks_cap on public.saved_trucks;
create trigger saved_trucks_cap before insert on public.saved_trucks
  for each row execute function public.saved_trucks_cap();

-- Service role only, like every other table the app writes (0063).
alter table public.saved_trucks enable row level security;
revoke all on public.saved_trucks from public, anon, authenticated;
grant select, insert, update, delete on public.saved_trucks to service_role;
