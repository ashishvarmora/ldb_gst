import Link from "next/link";
import {
  Bell,
  CreditCard,
  LogIn,
  MessageCircle,
  MonitorSmartphone,
  Search,
  Truck,
  Wallet,
} from "lucide-react";

import { Badge, EmptyState, Panel, cx } from "@/components/ui";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtRelative, fmtRupees, istDaysAgo } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

/**
 * Everything this customer has done, in one place - the support desk's first
 * question ("when did they last use it, and what happened?") answered without
 * opening four other pages.
 *
 * Top: the separate "last" moments, because they mean different things - a
 * customer who opens the app daily to read alerts but never searches is
 * engaged, not dead (0065 split last_seen from last_search for exactly that).
 * Middle: which of the last 30 days they came. Bottom: one merged timeline
 * from the tables that already record each kind of event.
 */

type Event = {
  at: string;
  kind: "search" | "payment" | "credits" | "chat" | "alert" | "action";
  title: string;
  detail?: string;
  tone?: "good" | "bad" | "warn" | "neutral" | "brand";
  href?: string;
};

const KIND_ICON = {
  search: Search,
  payment: CreditCard,
  credits: Wallet,
  chat: MessageCircle,
  alert: Bell,
  action: Truck,
} as const;

const PER_SOURCE = 25;
const SHOWN = 60;

export async function ActivityTab({ id, overview }: { id: string; overview: OfficerOverview }) {
  const admin = getSupabaseAdmin();
  const since = istDaysAgo(29);

  const [auth, visits, searches, payments, credits, chats, alerts, actions] = await Promise.all([
    admin.auth.admin.getUserById(id).catch(() => null),
    admin
      .from("customer_visits")
      .select("day, hits, via")
      .eq("user_id", id)
      .gte("day", since)
      .order("day", { ascending: true }),
    admin
      .from("search_logs")
      .select("created_at, truck_number, ok, events_found, error, source")
      .eq("user_id", id)
      .eq("source", "manual")
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("payments")
      .select("created_at, paid_at, status, kind, amount_inr, method, failure_reason, razorpay_order_id")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("credit_transactions")
      .select("created_at, delta, reason, note, balance_after")
      .eq("user_id", id)
      .not("reason", "in", "(manual_search,auto_check)")
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("chat_messages")
      .select("created_at, sender_role, body")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("alert_logs")
      .select("created_at, title, truck_number, delivered")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    admin
      .from("audit_logs")
      .select("created_at, action, entity_label")
      .eq("actor_id", id)
      .not("action", "eq", "search.manual")
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
  ]);

  const lastSignIn = auth?.data?.user?.last_sign_in_at ?? null;
  const paymentRows = (payments.data ?? []) as {
    created_at: string;
    paid_at: string | null;
    status: string;
    kind: string;
    amount_inr: number;
    method: string;
    failure_reason: string | null;
    razorpay_order_id: string;
  }[];
  const lastPaid = paymentRows.find((row) => row.status === "paid");
  const visitRows = (visits.data ?? []) as { day: string; hits: number; via: string | null }[];
  const visitDays = new Map(visitRows.map((row) => [row.day, row]));

  /* ------------------------------------------------------------ timeline */
  const events: Event[] = [];
  for (const row of (searches.data ?? []) as {
    created_at: string;
    truck_number: string;
    ok: boolean;
    events_found: number;
    error: string | null;
  }[]) {
    events.push({
      at: row.created_at,
      kind: "search",
      title: `Searched ${row.truck_number}`,
      detail: row.ok ? `${row.events_found} crossing${row.events_found === 1 ? "" : "s"} found` : `Failed — ${row.error ?? "error"}`,
      tone: row.ok ? "neutral" : "bad",
    });
  }
  for (const row of paymentRows) {
    events.push({
      at: row.paid_at ?? row.created_at,
      kind: "payment",
      title: `${row.status === "paid" ? "Paid" : row.status === "failed" ? "Payment failed" : "Checkout opened"} ${fmtRupees(Number(row.amount_inr))} · ${row.kind}`,
      detail: row.status === "failed" ? (row.failure_reason ?? undefined) : row.method === "razorpay" ? row.razorpay_order_id : `Recorded by hand (${row.method})`,
      tone: row.status === "paid" ? "good" : row.status === "failed" ? "bad" : "warn",
      href: `/admin/officers/${id}?tab=payments`,
    });
  }
  for (const row of (credits.data ?? []) as {
    created_at: string;
    delta: number;
    reason: string;
    note: string | null;
    balance_after: number;
  }[]) {
    const delta = Number(row.delta);
    events.push({
      at: row.created_at,
      kind: "credits",
      title: `${delta > 0 ? "+" : ""}${formatCredits(delta)} credits · ${CREDIT_REASON_LABEL[row.reason] ?? row.reason}`,
      detail: `${row.note ? `${row.note} · ` : ""}balance ${formatCredits(Number(row.balance_after))}`,
      tone: delta > 0 ? "good" : "neutral",
      href: `/admin/officers/${id}?tab=credits`,
    });
  }
  for (const row of (chats.data ?? []) as { created_at: string; sender_role: string; body: string }[]) {
    events.push({
      at: row.created_at,
      kind: "chat",
      title: row.sender_role === "customer" ? "Sent a support message" : "Support replied",
      detail: row.body.length > 120 ? `${row.body.slice(0, 120)}…` : row.body,
      tone: row.sender_role === "customer" ? "brand" : "neutral",
      href: `/admin/chat/${id}`,
    });
  }
  for (const row of (alerts.data ?? []) as {
    created_at: string;
    title: string;
    truck_number: string | null;
    delivered: boolean;
  }[]) {
    events.push({
      at: row.created_at,
      kind: "alert",
      title: `Alert: ${row.title}`,
      detail: `${row.truck_number ? `${row.truck_number} · ` : ""}${row.delivered ? "delivered" : "not delivered"}`,
      tone: row.delivered ? "neutral" : "warn",
    });
  }
  for (const row of (actions.data ?? []) as { created_at: string; action: string; entity_label: string | null }[]) {
    events.push({
      at: row.created_at,
      kind: "action",
      title: row.action.replace(/[._]/g, " "),
      detail: row.entity_label ?? undefined,
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  const shown = events.slice(0, SHOWN);

  /* --------------------------------------------------------------- render */
  const moments: { label: string; icon: typeof Search; value: string; sub: string }[] = [
    {
      label: "Last seen",
      icon: MonitorSmartphone,
      value: overview.last_seen_at ? fmtRelative(overview.last_seen_at) : "Not recorded yet",
      sub: overview.last_seen_at
        ? `${fmtDateTime(overview.last_seen_at)} · ${overview.last_seen_via === "app" ? "Android app" : "website"}`
        : "Recorded from 17 Nov 2026 onwards",
    },
    {
      label: "Last search",
      icon: Search,
      value: overview.last_search_at ? fmtRelative(overview.last_search_at) : "Never",
      sub: overview.last_search_at ? fmtDateTime(overview.last_search_at) : "No manual search yet",
    },
    {
      label: "Last sign-in",
      icon: LogIn,
      value: lastSignIn ? fmtRelative(lastSignIn) : "Unknown",
      sub: lastSignIn ? `${fmtDateTime(lastSignIn)} · a password sign-in, not every visit` : "",
    },
    {
      label: "Last payment",
      icon: CreditCard,
      value: lastPaid ? fmtRupees(Number(lastPaid.amount_inr)) : "None yet",
      sub: lastPaid ? `${fmtRelative(lastPaid.paid_at ?? lastPaid.created_at)} · ${lastPaid.kind}` : "",
    },
  ];

  const days: { day: string; label: string }[] = [];
  for (let back = 29; back >= 0; back -= 1) {
    const day = istDaysAgo(back);
    days.push({ day, label: fmtDate(day) });
  }
  const activeDays = days.filter((d) => visitDays.has(d.day)).length;

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {moments.map(({ label, icon: Icon, value, sub }) => (
          <div key={label} className="panel p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <Icon size={13} className="text-brand-500" />
              {label}
            </p>
            <p className="mt-1.5 text-base font-semibold text-strong">{value}</p>
            {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
          </div>
        ))}
      </div>

      <Panel
        title={`Days active · ${activeDays} of the last 30`}
        description="A filled square is a day they opened the app or the site. Counting started on 17 Nov 2026."
      >
        <div className="flex flex-wrap gap-1.5">
          {days.map(({ day, label }) => {
            const visit = visitDays.get(day);
            return (
              <span
                key={day}
                title={visit ? `${label} · ${visit.via === "app" ? "app" : "web"}` : `${label} · not seen`}
                className={cx(
                  "size-5 rounded-[5px] border",
                  visit
                    ? visit.via === "app"
                      ? "border-good-500/50 bg-good-500/70"
                      : "border-brand-500/50 bg-brand-500/70"
                    : "border-line bg-sunken",
                )}
              />
            );
          })}
        </div>
        <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-good-500/70" /> Android app
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-brand-500/70" /> Website
          </span>
        </p>
      </Panel>

      <Panel
        title="Timeline"
        description={`The latest ${shown.length} things this customer did or received — searches, payments, credits, support messages, alerts and account changes.`}
      >
        {shown.length === 0 ? (
          <EmptyState title="Nothing yet" description="This customer has not done anything that is recorded." />
        ) : (
          <ol className="divide-y divide-divider">
            {shown.map((event, index) => {
              const Icon = KIND_ICON[event.kind];
              const body = (
                <div className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted">
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="font-medium">{event.title}</span>
                      {event.tone && event.tone !== "neutral" ? (
                        <Badge tone={event.tone}>{event.kind}</Badge>
                      ) : null}
                    </p>
                    {event.detail ? (
                      <p className="mt-0.5 truncate text-xs text-muted">{event.detail}</p>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-right text-xs text-muted" dateTime={event.at}>
                    {fmtRelative(event.at)}
                    <span className="block text-[11px]">{fmtDateTime(event.at)}</span>
                  </time>
                </div>
              );
              return (
                <li key={`${event.at}-${index}`}>
                  {event.href ? (
                    <Link href={event.href} className="block rounded-lg transition hover:bg-sunken/60">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
