import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Coins,
  CreditCard,
  Eye,
  Gift,
  LayoutGrid,
  MessageCircle,
  MessageSquare,
  Search,
  Settings,
  Truck,
  User,
  Wallet,
} from "lucide-react";

import { FilterSubmitButton } from "@/components/NavPending";
import { safeTerm } from "../pager";
import { Avatar, Badge, EmptyState, Mono, PageHeader, Panel, buttonClass, cx } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtNumber, fmtRelative, fmtRupees, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, TruckDirectoryRow } from "@/lib/types";

export const metadata = { title: "Explore — Rahdari admin" };

/**
 * ONE SEARCH BOX FOR THE WHOLE CONSOLE (17 Nov 2026).
 *
 * The admin is the owner, the support desk and the analyst at once, and the
 * question usually arrives as one fact - a name on a call, a number plate, a
 * Razorpay id from a bank SMS, a coupon code - with no idea which page owns it.
 * So whatever is typed is tried against everything at once, each kind of match
 * is shown as a card with the facts that answer the usual question, and every
 * card links straight to the page that can act on it.
 *
 * The order of the sections follows the shape of the input: a payment id puts
 * payments first, a number plate puts trucks first, anything else starts with
 * customers.
 */

const MATCH_LIMIT = 12;
const PER_TRUCK = 8;

type SearchSummary = {
  truck_number: string;
  user_id: string;
  searches: number;
  manual: number;
  automatic: number;
  failed: number;
  last_at: string;
};

type PaymentHit = {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  amount_inr: number;
  method: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
};

type CouponHit = {
  code: string;
  kind: string;
  value: number;
  is_active: boolean;
  applies_to: string;
  expires_at: string | null;
  max_claims: number | null;
};

type PlanHit = { id: string; name: string; price_inr: number; is_active: boolean; is_trial: boolean };

type ChatHit = { user_id: string; sender_role: string; body: string; created_at: string };

/** Console pages, found by the words an admin would type when lost. */
const SHORTCUTS: { href: string; title: string; description: string; words: string[] }[] = [
  { href: "/admin/officers", title: "Customers", description: "Every account, with filters for plan, expiry and last seen.", words: ["customer", "user", "account", "officer", "suspend", "password"] },
  { href: "/admin/chat", title: "Messages", description: "Support chat with customers.", words: ["chat", "message", "support", "reply", "inbox"] },
  { href: "/admin/announcements", title: "Announcements", description: "Banners, popups and phone pushes to customers.", words: ["announcement", "banner", "popup", "broadcast", "push"] },
  { href: "/admin/finance", title: "Finance", description: "Payments, revenue, recheck with Razorpay, record a cash payment.", words: ["finance", "payment", "revenue", "money", "invoice", "refund", "cash", "recheck", "razorpay order"] },
  { href: "/admin/plans", title: "Plans & credits", description: "Plans, prices, credit packs and rates.", words: ["plan", "price", "pricing", "pack", "topup", "top-up", "rate", "credit"] },
  { href: "/admin/rewards", title: "Rewards", description: "Coupons and referrals.", words: ["coupon", "code", "discount", "referral", "refer", "reward", "bonus"] },
  { href: "/admin/users", title: "Growth", description: "Sign-ups, the funnel and every account's numbers over a range.", words: ["growth", "signup", "sign-up", "funnel", "analytics", "report"] },
  { href: "/admin/usage", title: "Usage", description: "Searches and automatic checks over time.", words: ["usage", "search count", "checks", "graph"] },
  { href: "/admin/trucks", title: "Trucks", description: "Every tracked truck on the platform.", words: ["truck", "lorry", "vehicle", "tracked", "paused"] },
  { href: "/admin/logs", title: "Logs", description: "Every lookup, alert and admin action.", words: ["log", "lookup", "history", "alert sent", "failed search"] },
  { href: "/admin/alerts", title: "Alert rules", description: "The alert templates customers choose from.", words: ["alert", "rule", "interval", "template"] },
  { href: "/admin/storage", title: "Storage", description: "How long each table is kept.", words: ["storage", "retention", "purge", "delete old"] },
  { href: "/admin/audit", title: "Audit log", description: "Who changed what in the console.", words: ["audit", "who changed", "history of changes"] },
  { href: "/admin/settings?section=site", title: "Settings · Brand & site", description: "Name, sign-up switch, support email and phone.", words: ["brand", "support email", "signup", "site", "terms", "privacy"] },
  { href: "/admin/settings?section=notify", title: "Settings · Notify admin", description: "Admin emails, daily summary, chat emails, phone alerts.", words: ["notify", "notification", "email", "daily summary", "summary"] },
  { href: "/admin/settings?section=payments", title: "Settings · Payments", description: "Razorpay on/off and keys.", words: ["razorpay", "payment gateway", "key", "upi"] },
  { href: "/admin/settings?section=tracking", title: "Settings · Tracking", description: "The tracking engine and running it by hand.", words: ["tracking", "engine", "sweep", "run now", "pause after"] },
  { href: "/admin/settings?section=app", title: "Settings · Mobile app", description: "The Android APK and iPhone shortcut.", words: ["apk", "android", "app", "iphone", "download"] },
  { href: "/admin/settings?section=data", title: "Settings · Data & exports", description: "Google Sheets export and backups.", words: ["backup", "sheet", "export", "google"] },
  { href: "/admin/settings?section=health", title: "Settings · Health", description: "Whether every service is wired up; the cron URL.", words: ["health", "cron", "env", "status", "webhook", "resend", "vapid"] },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const raw = (await searchParams).q ?? "";
  const term = safeTerm(raw).slice(0, 80);
  const lower = term.toLowerCase();
  const plate = term.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const digits = term.replace(/\D/g, "");
  /* A phone typed with +91, spaces or a leading 0 still finds the account. */
  const phoneDigits = digits.length >= 6 && !/[a-z]/i.test(term) ? digits.slice(-10) : "";
  const isPaymentId = /^(order|pay)_/i.test(term);
  const looksLikePlate = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(plate) && /[A-Z]/.test(plate) && /\d/.test(plate);
  const isUuidish = /^[0-9a-f]{8}(-[0-9a-f]{4}){0,4}/i.test(term) && !looksLikePlate;

  const none = Promise.resolve({ data: [] as unknown[] });

  const [searchHits, directoryHits, accountHits, paymentHits, couponHits, planHits, chatHits] = term
    ? await Promise.all([
        plate.length >= 3 && !isPaymentId
          ? admin
              .from("truck_search_summary")
              .select("*")
              .ilike("truck_number", `%${plate}%`)
              .order("last_at", { ascending: false })
              .limit(200)
          : none,
        plate.length >= 3 && !isPaymentId
          ? admin.from("truck_directory").select("*").ilike("truck_number", `%${plate}%`).limit(200)
          : none,
        isPaymentId
          ? none
          : admin
              .from("officer_overview")
              .select("*")
              .or(
                [
                  `full_name.ilike.%${term}%`,
                  `email.ilike.%${term}%`,
                  `office.ilike.%${term}%`,
                  `district.ilike.%${term}%`,
                  ...(phoneDigits ? [`phone.ilike.%${phoneDigits}%`] : [`phone.ilike.%${term}%`]),
                ].join(","),
              )
              .order("full_name")
              .limit(MATCH_LIMIT),
        term.length >= 5
          ? admin
              .from("payments")
              .select("id, user_id, kind, status, amount_inr, method, razorpay_order_id, razorpay_payment_id, failure_reason, created_at, paid_at")
              .or(`razorpay_order_id.ilike.%${term}%,razorpay_payment_id.ilike.%${term}%`)
              .order("created_at", { ascending: false })
              .limit(MATCH_LIMIT)
          : none,
        term.length >= 3 && !isPaymentId
          ? admin
              .from("coupons")
              .select("code, kind, value, is_active, applies_to, expires_at, max_claims")
              .ilike("code", `%${term}%`)
              .limit(MATCH_LIMIT)
          : none,
        term.length >= 3 && !isPaymentId
          ? admin.from("plans").select("id, name, price_inr, is_active, is_trial").ilike("name", `%${term}%`).limit(MATCH_LIMIT)
          : none,
        term.length >= 4 && !isPaymentId && !looksLikePlate
          ? admin
              .from("chat_messages")
              .select("user_id, sender_role, body, created_at")
              .ilike("body", `%${term}%`)
              .order("created_at", { ascending: false })
              .limit(MATCH_LIMIT)
          : none,
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  /* Referral code and account id: exact matches the .or() above cannot express. */
  let extraAccounts: OfficerOverview[] = [];
  if (term && !isPaymentId && (isUuidish || /^[A-Z0-9]{5,12}$/i.test(term))) {
    const { data: byCode } = await admin
      .from("profiles")
      .select("id")
      .or(
        [`referral_code.ilike.${term}`, ...(isUuidish && term.length >= 8 ? [`id.eq.${term.length === 36 ? term : "00000000-0000-0000-0000-000000000000"}`] : [])].join(","),
      )
      .limit(5);
    const ids = ((byCode ?? []) as { id: string }[]).map((row) => row.id);
    if (ids.length) {
      const { data } = await admin.from("officer_overview").select("*").in("id", ids);
      extraAccounts = (data ?? []) as OfficerOverview[];
    }
  }

  const summaries = (searchHits.data ?? []) as SearchSummary[];
  const tracking = (directoryHits.data ?? []) as TruckDirectoryRow[];
  const accountMap = new Map<string, OfficerOverview>();
  for (const row of [...extraAccounts, ...((accountHits.data ?? []) as OfficerOverview[])]) accountMap.set(row.id, row);
  const accounts = [...accountMap.values()];
  const payments = (paymentHits.data ?? []) as PaymentHit[];
  const coupons = (couponHits.data ?? []) as CouponHit[];
  const plans = (planHits.data ?? []) as PlanHit[];
  const chats = (chatHits.data ?? []) as ChatHit[];

  const shortcuts = term.length >= 2
    ? SHORTCUTS.filter(
        (s) => s.title.toLowerCase().includes(lower) || s.words.some((w) => w.includes(lower) || lower.includes(w)),
      ).slice(0, 6)
    : [];

  /* Names for every row that points at an account, in one read. */
  const ids = new Set<string>([
    ...summaries.map((r) => r.user_id),
    ...tracking.map((r) => r.officer_id),
    ...payments.map((r) => r.user_id),
    ...chats.map((r) => r.user_id),
  ]);
  const { data: people } = ids.size
    ? await admin.from("profiles").select("id, full_name, email").in("id", [...ids])
    : { data: [] };
  const nameOf = new Map(
    ((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [
      p.id,
      p.full_name?.trim() || p.email,
    ]),
  );

  const byNumber = new Map<string, { searchers: SearchSummary[]; trackers: TruckDirectoryRow[] }>();
  for (const row of summaries) {
    const entry = byNumber.get(row.truck_number) ?? { searchers: [], trackers: [] };
    entry.searchers.push(row);
    byNumber.set(row.truck_number, entry);
  }
  for (const row of tracking) {
    const entry = byNumber.get(row.truck_number) ?? { searchers: [], trackers: [] };
    entry.trackers.push(row);
    byNumber.set(row.truck_number, entry);
  }
  const trucks = [...byNumber.entries()]
    .sort((a, b) => b[1].searchers.length - a[1].searchers.length || a[0].localeCompare(b[0]))
    .slice(0, MATCH_LIMIT);

  const counts = {
    customers: accounts.length,
    trucks: trucks.length,
    payments: payments.length,
    messages: chats.length,
    coupons: coupons.length,
    plans: plans.length,
    pages: shortcuts.length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  /* ---------------------------------------------------------------- sections */
  const sections: { key: keyof typeof counts; label: string; node: ReactNode }[] = [
    { key: "customers", label: "Customers", node: <CustomersSection accounts={accounts} /> },
    { key: "trucks", label: "Trucks", node: <TrucksSection trucks={trucks} nameOf={nameOf} /> },
    { key: "payments", label: "Payments", node: <PaymentsSection payments={payments} nameOf={nameOf} /> },
    { key: "messages", label: "Support messages", node: <ChatSection chats={chats} nameOf={nameOf} term={term} /> },
    { key: "coupons", label: "Coupons", node: <CouponsSection coupons={coupons} /> },
    { key: "plans", label: "Plans", node: <PlansSection plans={plans} /> },
    { key: "pages", label: "Console pages", node: <ShortcutsSection shortcuts={shortcuts} /> },
  ];
  const priority: (keyof typeof counts)[] = isPaymentId
    ? ["payments", "customers"]
    : looksLikePlate
      ? ["trucks", "customers"]
      : ["customers", "trucks", "payments"];
  sections.sort((a, b) => {
    const pa = priority.indexOf(a.key);
    const pb = priority.indexOf(b.key);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });
  const shown = sections.filter((s) => counts[s.key] > 0);

  return (
    <>
      <PageHeader
        title="Explore"
        subtitle="One search for the whole console. Type whatever you have — a name, phone, email, number plate, Razorpay id, coupon code or a word like “razorpay” — and jump straight to the right page."
      />

      <Panel className="mb-4">
        <form method="get" action="/admin/explore" className="flex gap-2">
          <input
            name="q"
            defaultValue={raw}
            autoFocus
            placeholder="Name, phone, email, GJ27TD6880, order_…, coupon code…"
            aria-label="Search the whole console"
            className="field min-w-0 flex-1"
          />
          <FilterSubmitButton icon={<Search size={15} />} variant="primary" size="md" iconSize={15}>
            Search
          </FilterSubmitButton>
        </form>

        {!term ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {["9876543210", "GJ02ZZ8799", "order_", "QUELLFLOW", "razorpay", "backup"].map((example) => (
              <Link
                key={example}
                href={`/admin/explore?q=${encodeURIComponent(example)}`}
                className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs text-muted transition hover:border-brand-500/50 hover:text-brand-500"
              >
                {example}
              </Link>
            ))}
          </div>
        ) : null}
      </Panel>

      {!term ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: User, title: "A customer", text: "Name, phone (with or without +91), email, company, referral code or account id → their profile, activity, payments, trucks and chat." },
            { icon: Truck, title: "A number plate", text: "Who has searched it, how often, and who is tracking it → their accounts and every lookup." },
            { icon: CreditCard, title: "A payment", text: "A Razorpay order_… or pay_… id from a bank SMS → the payment, its customer and the recheck button." },
            { icon: Gift, title: "A coupon or plan", text: "A code or plan name → its terms and where to change them." },
            { icon: MessageSquare, title: "Something a customer wrote", text: "Any words from a support chat → the conversation." },
            { icon: Settings, title: "A setting", text: "A word like razorpay, backup, cron, notify or apk → the settings page that holds it." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="panel p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-strong">
                <Icon size={15} className="text-brand-500" />
                {title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>
      ) : null}

      {term && total === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title={`Nothing matches “${term}”`}
            description="No customer, truck, payment, coupon, plan, message or console page matches. Try fewer letters, the last digits of a phone, or part of a number plate. Logs older than the retention window are deleted, so an old lookup may leave no trace."
          />
        </Panel>
      ) : null}

      {term && total > 0 ? (
        <>
          <nav aria-label="Result types" className="mb-4 flex flex-wrap gap-2">
            {shown.map((s) => (
              <a
                key={s.key}
                href={`#${s.key}`}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-raised px-3 text-xs font-medium text-ink transition hover:border-brand-500/50"
              >
                {s.label}
                <span className="rounded-full bg-sunken px-1.5 text-[11px] tabular-nums text-muted">{counts[s.key]}</span>
              </a>
            ))}
          </nav>
          <div className="space-y-6">
            {shown.map((s) => (
              <section key={s.key} id={s.key} className="scroll-mt-20">
                <h2 className="mb-2.5 text-sm font-semibold text-strong">
                  {s.label} <span className="font-normal text-muted">· {counts[s.key]}</span>
                </h2>
                {s.node}
              </section>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function QuickLinks({ links }: { links: { href: string; label: string; icon: typeof User }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-divider px-3 py-2.5">
      {links.map(({ href, label, icon: Icon }) => (
        <Link key={href + label} href={href} className={buttonClass("secondary", "sm")}>
          <Icon size={13} />
          {label}
        </Link>
      ))}
    </div>
  );
}

function CustomersSection({ accounts }: { accounts: OfficerOverview[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {accounts.map((a) => {
        const base = `/admin/officers/${a.id}`;
        return (
          <Panel key={a.id} bodyClassName="p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <Link href={base} className="group flex min-w-0 items-center gap-2.5">
                <Avatar size="sm" text={initials(a.full_name, a.email)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink group-hover:text-brand-500">
                    {a.full_name?.trim() || a.email}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {a.email}
                    {a.phone ? ` · ${a.phone}` : ""}
                  </span>
                </span>
              </Link>
              <span className="flex flex-wrap items-center gap-1.5">
                {a.role !== "officer" ? <Badge tone="brand">{a.role}</Badge> : null}
                <Badge tone={a.status === "active" ? "good" : "bad"}>{a.status}</Badge>
                <Badge tone={a.plan_active ? "brand" : "warn"}>
                  {a.plan_name ?? "no plan"}
                  {a.plan_expires_on ? ` · ends ${a.plan_expires_on}` : ""}
                </Badge>
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-px border-t border-divider bg-divider sm:grid-cols-4">
              {[
                { label: "Credits", value: formatCredits(Number(a.credits)), bad: Number(a.credits) <= 0 },
                { label: "Trucks live", value: `${fmtNumber(a.active_trucks)} / ${a.truck_limit === -1 ? "∞" : fmtNumber(a.truck_limit)}` },
                {
                  label: "Last seen",
                  value: a.last_seen_at ? `${fmtRelative(a.last_seen_at)} · ${a.last_seen_via === "app" ? "app" : "web"}` : "not yet",
                },
                { label: "Last search", value: a.last_search_at ? fmtRelative(a.last_search_at) : "never" },
              ].map(({ label, value, bad }) => (
                <div key={label} className="bg-panel px-4 py-2.5">
                  <dt className="text-[11px] font-medium text-muted">{label}</dt>
                  <dd className={cx("mt-0.5 text-sm font-semibold tabular-nums", bad ? "text-bad-500" : "text-strong")}>{value}</dd>
                </div>
              ))}
            </dl>
            <QuickLinks
              links={[
                { href: base, label: "Profile", icon: User },
                { href: `${base}?tab=activity`, label: "Activity", icon: Activity },
                { href: `${base}?tab=payments`, label: "Payments", icon: CreditCard },
                { href: `${base}?tab=credits`, label: "Credits", icon: Wallet },
                { href: `${base}?tab=trucks`, label: "Trucks", icon: Truck },
                { href: `/admin/chat/${a.id}`, label: "Chat", icon: MessageCircle },
                { href: `${base}?tab=settings`, label: "Edit", icon: Settings },
              ]}
            />
          </Panel>
        );
      })}
    </div>
  );
}

function TrucksSection({
  trucks,
  nameOf,
}: {
  trucks: [string, { searchers: SearchSummary[]; trackers: TruckDirectoryRow[] }][];
  nameOf: Map<string, string>;
}) {
  return (
    <div className="space-y-3">
      {trucks.map(([number, { searchers, trackers }]) => {
        const total = searchers.reduce((sum, r) => sum + Number(r.searches), 0);
        const manual = searchers.reduce((sum, r) => sum + Number(r.manual), 0);
        const top = [...searchers].sort((a, b) => Number(b.searches) - Number(a.searches)).slice(0, PER_TRUCK);
        return (
          <Panel key={number} bodyClassName="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <Truck size={15} className="shrink-0 text-muted" />
                <Mono className="text-base font-semibold text-strong">{number}</Mono>
                {trackers.length > 0 ? (
                  <Badge tone="brand">tracked by {trackers.length === 1 ? "1 account" : `${trackers.length} accounts`}</Badge>
                ) : (
                  <Badge>not tracked</Badge>
                )}
                {searchers.length > 1 ? <Badge tone="warn">{searchers.length} accounts searched it</Badge> : null}
              </span>
              <Link href={`/admin/logs?type=searches&truck=${encodeURIComponent(number)}`} className={buttonClass("secondary", "sm")}>
                <Eye size={13} />
                Every lookup
              </Link>
            </div>

            {trackers.length > 0 ? (
              <p className="border-b border-divider px-4 py-2 text-xs text-muted">
                Tracked by{" "}
                {trackers.map((t, i) => (
                  <span key={t.tracked_truck_id}>
                    {i ? ", " : ""}
                    <Link href={`/admin/officers/${t.officer_id}?tab=trucks`} className="font-medium text-brand-500 hover:underline">
                      {t.officer_name?.trim() || nameOf.get(t.officer_id) || t.officer_email}
                    </Link>{" "}
                    ({t.is_active ? "live" : `paused${t.paused_reason ? `: ${t.paused_reason.replace(/_/g, " ")}` : ""}`})
                  </span>
                ))}
              </p>
            ) : null}

            {top.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted">Nobody has searched this number inside the retention window.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {top.map((row) => (
                  <li key={row.user_id} className="flex items-center gap-3 px-4 py-2.5">
                    <Link href={`/admin/officers/${row.user_id}?tab=activity`} className="group min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink group-hover:text-brand-500">
                        {nameOf.get(row.user_id) ?? "Unknown account"}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {fmtNumber(row.manual)} manual · {fmtNumber(row.automatic)} automatic
                        {Number(row.failed) > 0 ? ` · ${fmtNumber(row.failed)} failed` : ""} · last {fmtRelative(row.last_at)}
                      </span>
                    </Link>
                    <Link
                      href={`/admin/logs?type=searches&truck=${encodeURIComponent(number)}&officer=${row.user_id}`}
                      className="-mr-2 inline-flex min-h-10 shrink-0 items-center rounded-lg px-2 text-xs font-medium text-brand-500 transition hover:bg-brand-500/8"
                    >
                      {fmtNumber(row.searches)} lookups
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-divider bg-raised/40 px-4 py-2 text-xs text-muted tabular-nums">
              {fmtNumber(total)} lookups — {fmtNumber(manual)} by hand, {fmtNumber(total - manual)} automatic
              {searchers.length > top.length ? ` · ${searchers.length - top.length} more accounts in Every lookup` : ""}
            </p>
          </Panel>
        );
      })}
    </div>
  );
}

function PaymentsSection({ payments, nameOf }: { payments: PaymentHit[]; nameOf: Map<string, string> }) {
  return (
    <Panel bodyClassName="p-0">
      <ul className="divide-y divide-divider">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-strong">{fmtRupees(Number(p.amount_inr))}</span>
                <Badge tone={p.status === "paid" ? "good" : p.status === "failed" ? "bad" : "warn"}>{p.status}</Badge>
                <span className="text-muted">{p.kind}</span>
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                <Link href={`/admin/officers/${p.user_id}?tab=payments`} className="font-medium text-brand-500 hover:underline">
                  {nameOf.get(p.user_id) ?? "Customer"}
                </Link>{" "}
                · <Mono className="text-[11px]">{p.razorpay_order_id}</Mono>
                {p.razorpay_payment_id ? <> · <Mono className="text-[11px]">{p.razorpay_payment_id}</Mono></> : null} ·{" "}
                {fmtDateTime(p.paid_at ?? p.created_at)}
              </p>
              {p.failure_reason ? <p className="mt-0.5 text-xs text-bad-500">{p.failure_reason}</p> : null}
            </div>
            <span className="flex gap-1.5">
              <Link href={`/admin/officers/${p.user_id}?tab=payments`} className={buttonClass("secondary", "sm")}>
                <User size={13} />
                Customer
              </Link>
              <Link href={`/admin/finance?status=${p.status}`} className={buttonClass("secondary", "sm")}>
                <CreditCard size={13} />
                Finance
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ChatSection({ chats, nameOf, term }: { chats: ChatHit[]; nameOf: Map<string, string>; term: string }) {
  return (
    <Panel bodyClassName="p-0">
      <ul className="divide-y divide-divider">
        {chats.map((c, i) => {
          const at = c.body.toLowerCase().indexOf(term.toLowerCase());
          const start = Math.max(0, at - 40);
          const snippet = `${start > 0 ? "…" : ""}${c.body.slice(start, start + 140)}${c.body.length > start + 140 ? "…" : ""}`;
          return (
            <li key={`${c.user_id}-${c.created_at}-${i}`}>
              <Link href={`/admin/chat/${c.user_id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-sunken/60">
                <MessageCircle size={15} className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">
                    {nameOf.get(c.user_id) ?? "Customer"}{" "}
                    <span className="font-normal text-muted">· {c.sender_role === "customer" ? "customer wrote" : "support wrote"} · {fmtRelative(c.created_at)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{snippet}</span>
                </span>
                <ArrowRight size={14} className="mt-1 shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CouponsSection({ coupons }: { coupons: CouponHit[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {coupons.map((c) => (
        <Link key={c.code} href="/admin/rewards" className="panel flex items-start gap-3 p-4 transition hover:border-brand-500/50">
          <Gift size={16} className="mt-0.5 shrink-0 text-brand-500" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <Mono className="text-sm font-semibold text-strong">{c.code}</Mono>
              <Badge tone={c.is_active ? "good" : "neutral"}>{c.is_active ? "active" : "off"}</Badge>
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {c.kind === "percent" ? `${Number(c.value)}% off` : c.kind === "credit_bonus" ? `+${formatCredits(Number(c.value))} credits` : `${c.kind} ${c.value}`} · {c.applies_to}
              {c.max_claims ? ` · max ${c.max_claims}` : ""} · {c.expires_at ? `ends ${c.expires_at.slice(0, 10)}` : "no expiry"}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function PlansSection({ plans }: { plans: PlanHit[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {plans.map((p) => (
        <Link key={p.id} href="/admin/plans" className="panel flex items-center gap-3 p-4 transition hover:border-brand-500/50">
          <Coins size={16} className="shrink-0 text-brand-500" />
          <span className="min-w-0 flex-1 text-sm font-semibold text-strong">{p.name}</span>
          <span className="text-xs text-muted">{p.is_trial ? "free trial" : fmtRupees(Number(p.price_inr))}</span>
          <Badge tone={p.is_active ? "good" : "neutral"}>{p.is_active ? "on sale" : "off sale"}</Badge>
        </Link>
      ))}
    </div>
  );
}

function ShortcutsSection({ shortcuts }: { shortcuts: typeof SHORTCUTS }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {shortcuts.map((s) => (
        <Link key={s.href} href={s.href} className="panel flex items-start gap-3 p-4 transition hover:border-brand-500/50">
          <LayoutGrid size={16} className="mt-0.5 shrink-0 text-brand-500" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-strong">{s.title}</span>
            <span className="mt-0.5 block text-xs text-muted">{s.description}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
