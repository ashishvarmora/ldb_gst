import { cache } from "react";
import { ALERT_BOT_START_URL, ALERT_BOT_USERNAME, ID_BOT_START_URL, ID_BOT_USERNAME } from "@/lib/telegram-bot";
import type { ReactNode } from "react";
import {
  BellRing,
  ChevronRight,
  MapPin,
  Timer,
  Truck as TruckIcon,
  Wallet,
} from "lucide-react";

import { publicSettings } from "@/components/SiteFooter";
import {
  Badge,
  DescRow,
  Mono,
  Panel,
  QuotaBar,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  cx,
} from "@/components/ui";
import { ALERT_KIND_EXAMPLE, ALERT_KIND_HINT, ALERT_KIND_LABEL } from "@/lib/alerts";
import {
  CREDIT_ACTIONS,
  describeOpenTier,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
  planChargeInr,
  planTermLabel,
} from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import { intervalLabel } from "@/lib/intervals";
import { PAUSE_COPY } from "@/lib/pause";
import { loadReferralTerms, referralPercent } from "@/lib/referrals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertRuleTemplate, CreditPack, CreditRate, Plan } from "@/lib/types";

import { Inline } from "./Inline";
import type { FigureName } from "./content/types";

/**
 * The pictures in the manual.
 *
 * WHY THEY ARE NOT PNGs, written down because it is the decision a reader of
 * this file will most want to argue with. The owner asked for screenshots with
 * marking and highlighting, and this is the version of that which stays true.
 *
 * A screenshot is a photograph of a build. It is wrong the first time a button
 * moves, it cannot reflow on a 390px phone, it is another asset to 404 when
 * somebody tidies public/, and it is a picture of last week's prices. So each
 * figure here is BUILT FROM THE APP'S OWN COMPONENTS - Panel, StatCard, Badge,
 * QuotaBar, DescRow, the real table primitives - filled with sample data. The
 * picture in the manual is therefore the actual interface: it is restyled when
 * the interface is restyled, it wraps on a phone the way the real screen does,
 * and the figures that quote money read it from the same tables the checkout
 * reads.
 *
 * WHAT IS SAMPLE AND WHAT IS LIVE. Registration numbers, names, plazas, dates
 * and balances are invented and always will be. Prices, credit rates, plan
 * terms, alert kinds, referral percentages and the no-movement window are read
 * at request time - a manual that disagrees with the till is worse than no
 * manual, because the reader trusts the manual and budgets against it.
 *
 * WHY NOTHING IN A FIGURE WORKS. Every figure sits inside a frame labelled
 * "Example", is `pointer-events-none`, carries `tabIndex={-1}` and is
 * `aria-hidden` with its meaning moved to the caption. There is no anchor, no
 * input and no form anywhere inside one. That is deliberate to the point of
 * being awkward - it is why the truck row below is rebuilt from TruckCard's
 * markup rather than being TruckCard, which embeds TrackingToggle, a live
 * form wired to a Server Action. A reader must never tab into a picture, and a
 * public page must never carry an auth-only mutation.
 */

/* -------------------------------------------------------------------------- */
/* live figures                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Everything the pictures quote a number from, in one round of queries per
 * request.
 *
 * cache() rather than a prop drilled through Blocks: a figure three levels
 * down an article should be able to ask for the current price list without
 * every renderer above it having to know that it might. Several figures on one
 * page share the single promise, and an article with no live figure makes no
 * query at all.
 *
 * Empty lists on failure, exactly as the pricing page does it. Every figure
 * below has something sensible to show when the catalogue is empty, so a
 * database having a bad morning costs the reader a table, not the page.
 */
const catalogue = cache(
  async (): Promise<{
    plans: Plan[];
    packs: CreditPack[];
    rates: CreditRate[];
    alertRules: AlertRuleTemplate[];
  }> => {
    try {
      const admin = getSupabaseAdmin();
      const [planResult, packs, rates, alertResult] = await Promise.all([
        admin
          .from("plans")
          .select("*")
          .eq("is_active", true)
          .order("sort_order")
          .order("price_inr"),
        loadCreditPacks(admin),
        loadCreditRates(admin),
        admin.from("alert_rule_templates").select("*").eq("is_active", true).order("sort_order"),
      ]);
      return {
        plans: (planResult.data ?? []) as Plan[],
        packs,
        rates,
        alertRules: (alertResult.data ?? []) as AlertRuleTemplate[],
      };
    } catch (error) {
      reportError("Guide figures: catalogue", error);
      return { plans: [], packs: [], rates: [], alertRules: [] };
    }
  },
);

/* -------------------------------------------------------------------------- */
/* the frame                                                                   */
/* -------------------------------------------------------------------------- */

/** Sample data, in one place, so two figures never disagree about a lorry. */
const SAMPLE = {
  truck: "GJ 05 AB 1234",
  truck2: "MH 12 CD 5678",
  truck3: "RJ 14 EF 9012",
  label: "Ramesh Patel — cotton run",
  plaza: "Kherki Daula",
  plaza2: "Vadodara Bypass",
  plaza3: "Sanand",
  code: "RAHD-4821",
} as const;

/**
 * A numbered marker pinned to the thing it names.
 *
 * WRAPPED AROUND THE ELEMENT, never positioned by percentages of the figure.
 * A marker placed at "62% across, 18% down" is correct on the laptop it was
 * measured on and lands in the wrong place on a 390px phone the moment
 * anything wraps - which is the failure mode of every annotated screenshot
 * ever pasted into a manual. This one is a child of its target, so it cannot
 * come off it.
 *
 * IN A LEFT GUTTER rather than on top of the content, which is why the picture
 * carries `pl-6`. Sat over the corner it covered the first characters of the
 * label it was pointing at - "TELEGRAM CHAT ID" read "LEGRAM CHAT ID" - and a
 * callout that hides the thing it names is worse than no callout. In the
 * gutter they also line up in a column, which matches the numbered list under
 * the figure.
 */
function Mark({
  n,
  children,
  className,
}: {
  n: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      {children}
      <span className="absolute -top-1 -left-6 z-10 inline-flex size-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold text-on-brand shadow-[0_0_0_2px_var(--c-raised)]">
        {n}
      </span>
    </div>
  );
}

type FigureSpec = {
  /** Said instead of the picture, since the picture is aria-hidden. */
  alt: string;
  /** What the numbered markers point at, when the caption does not say. */
  notes: string[];
  /** One unnumbered line after the notes, for a caveat or a link out. */
  after?: string;
  body: ReactNode;
};

/**
 * A figure, its frame, and the numbered points underneath it.
 *
 * The frame is not decoration. Without a border and the word "Example" a
 * reader on a phone scrolls into a figure and believes they have arrived at
 * the app - then taps something that does nothing and concludes the product is
 * broken. The label costs one line and prevents that.
 *
 * Numbered points come from the caption when the author wrote them there, and
 * from the figure otherwise: the figure knows what its own marker 3 is sitting
 * on, and an author writing prose in another file should not have to.
 */
export function Figure({ name, caption }: { name: FigureName; caption: string }) {
  const spec = SPECS[name];
  const { lead, points } = splitCaption(caption);
  const numbered = points.length > 0 ? points : spec.notes;

  return (
    <figure className="my-5">
      <div className="rounded-xl border border-line-strong bg-raised/50 p-3 sm:p-4">
        <p className="mb-2.5 flex items-center gap-2">
          <span className="rounded border border-line-strong bg-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-faint uppercase">
            Example
          </span>
          <span className="min-w-0 truncate text-[11px] text-faint">{spec.alt}</span>
        </p>

        {/*
          A picture, and only a picture. aria-hidden because the caption below
          says what it means in words - a screen reader walked through a
          decorative StatCard hears "Credits left 1,240" as fact about the
          reader's own account. pointer-events-none and tabIndex -1 so no thumb
          and no Tab key can get into it.
        */}
        {/* pl-6 is the markers' gutter - see Mark. */}
        <div aria-hidden tabIndex={-1} className="pointer-events-none pl-6 select-none">
          {spec.body}
        </div>
      </div>

      <figcaption className="mt-2.5 text-xs leading-relaxed text-faint">
        {lead ? (
          <p>
            <Inline text={lead} />
          </p>
        ) : null}
        {numbered.length > 0 ? (
          <ol className={cx("space-y-1", lead && "mt-2")}>
            {numbered.map((note, index) => (
              <li key={index} className="flex gap-2">
                <span className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[9px] font-bold text-brand-500">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <Inline text={note} />
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {spec.after ? (
          <p className="mt-2">
            <Inline text={spec.after} />
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * A caption written as "…lead. 1) first 2) second" split into its parts.
 *
 * Authors write captions in another file and were given the contract, not this
 * convention, so this has to be certain rather than clever: it fires only when
 * there are at least two markers AND the first one is 1, which no amount of
 * "Rs 1,200" or "every 15 min." can produce by accident. Anything else is one
 * plain caption and the figure's own notes carry the numbers.
 */
function splitCaption(caption: string): { lead: string; points: string[] } {
  const parts = caption
    .split(/(?:^|\s)(?=[1-9][.)]\s)/)
    .map((part) => part.trim())
    .filter(Boolean);

  const points: string[] = [];
  const lead: string[] = [];
  for (const part of parts) {
    if (/^[1-9][.)]\s/.test(part)) points.push(part.replace(/^[1-9][.)]\s*/, ""));
    else lead.push(part);
  }

  if (points.length < 2 || !/^1[.)]\s/.test(parts.find((p) => /^[1-9][.)]\s/.test(p)) ?? "")) {
    return { lead: caption, points: [] };
  }
  return { lead: lead.join(" "), points };
}

/* -------------------------------------------------------------------------- */
/* stills of things that are normally links or controls                        */
/* -------------------------------------------------------------------------- */

/**
 * LinkCard's look with no anchor in it. Used wherever a figure shows a row
 * that is a link on the real screen, which is most of them.
 */
function StillCard({
  icon,
  title,
  description,
  value,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  value?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3">
      {icon ? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-500">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>
        ) : null}
      </span>
      {value ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-strong">{value}</span>
      ) : null}
      <ChevronRight size={16} className="shrink-0 text-faint" />
    </div>
  );
}

/** The tracking switch as it looks, with nothing behind it. */
function StillSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5",
        on ? "justify-end border-brand-500 bg-brand-500" : "justify-start border-line-strong bg-sunken",
      )}
    >
      <span className={cx("size-5 rounded-full", on ? "bg-on-brand" : "bg-faint")} />
    </span>
  );
}

/** A field as the form draws it, with no input inside it. */
function StillField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <p className="field text-ink">{value}</p>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function StillButton({ label, tone = "primary" }: { label: string; tone?: "primary" | "secondary" }) {
  return (
    <span
      className={cx(
        "inline-flex min-h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium",
        tone === "primary"
          ? "border-transparent bg-brand-500 text-on-brand"
          : "border-line bg-panel text-ink",
      )}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* the figures                                                                 */
/* -------------------------------------------------------------------------- */

/** The portal's own first screen: what you have, and what it is doing. */
function PortalHome() {
  return (
    <div className="space-y-2.5">
      <Mark n={1}>
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="Credits left"
            value="1,240"
            sub="about 62 checks"
            tone="brand"
            icon={<Wallet size={14} />}
          />
          <StatCard label="Lorries live" value="4" sub="2 paused" tone="good" />
        </div>
      </Mark>

      <Mark n={2}>
        <Panel title="Your plan" description="Standard — ends 14 Oct 2026" bodyClassName="px-4 py-3">
          <QuotaBar used={4} limit={10} label="Lorries watched at once" />
        </Panel>
      </Mark>

      <Mark n={3}>
        <StillCard
          icon={<TruckIcon size={16} />}
          title="My trucks"
          description="4 live, 2 paused · 1 with no alert"
          value="6"
        />
      </Mark>

      <Mark n={4}>
        <StillCard
          icon={<BellRing size={16} />}
          title="Alerts sent"
          description="Last one 12 minutes ago"
          value="1,204"
        />
      </Mark>
    </div>
  );
}

/** Adding a lorry: three fields, and the one that decides the bill. */
function AddTruck() {
  return (
    <Panel title="Add a lorry" bodyClassName="space-y-3 px-4 py-4">
      <Mark n={1}>
        <StillField
          label="Registration number"
          value={SAMPLE.truck}
          hint="Spaces do not matter. A typo is the commonest cause of failed checks."
        />
      </Mark>
      <Mark n={2}>
        <StillField label="Your own note (optional)" value={SAMPLE.label} />
      </Mark>
      <Mark n={3}>
        <StillField
          label="Stop checking after"
          value="6 hours"
          hint="Leave it and this lorry runs until something stops it."
        />
      </Mark>
      <div className="flex gap-2 pt-1">
        <StillButton label="Add lorry" />
        <StillButton label="Cancel" tone="secondary" />
      </div>
    </Panel>
  );
}

/**
 * One row of My trucks.
 *
 * Rebuilt from TruckCard's markup rather than rendered from it: the real card
 * embeds TrackingToggle, which is a live <form> posting a Server Action that
 * pauses a lorry. That belongs on a signed-in screen, not in a picture on a
 * public page - see the header of this file.
 */
function TruckRow() {
  return (
    <div className="space-y-2.5">
      <Mark n={1}>
        <div className="panel relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1 bg-good-500" />
          <div className="flex items-start gap-3 py-2.5 pr-3 pl-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Mono className="text-sm font-semibold tracking-wide text-strong">
                  {SAMPLE.truck}
                </Mono>
                <span className="truncate text-xs text-muted">{SAMPLE.label}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-medium text-good-500">Moving</span>
                <span className="min-w-0 truncate text-muted">{SAMPLE.plaza} · 3 h ago</span>
                <span className="inline-flex items-center gap-1 text-faint">
                  <Timer size={11} /> stops in 4 h
                </span>
              </div>
            </div>
            <StillSwitch on />
            <ChevronRight size={15} className="mt-1 shrink-0 text-faint" />
          </div>
        </div>
      </Mark>

      <Mark n={2}>
        <div className="panel relative overflow-hidden opacity-80">
          <span className="absolute inset-y-0 left-0 w-1 bg-warn-500" />
          <div className="flex items-start gap-3 py-2.5 pr-3 pl-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Mono className="text-sm font-semibold tracking-wide text-strong">
                  {SAMPLE.truck2}
                </Mono>
                <Badge tone="warn">No movement detected</Badge>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="min-w-0 truncate text-muted">{SAMPLE.plaza2} · 2 days ago</span>
              </div>
            </div>
            <StillSwitch on={false} />
            <ChevronRight size={15} className="mt-1 shrink-0 text-faint" />
          </div>
        </div>
      </Mark>

      <Mark n={3}>
        <div className="panel relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1 bg-line-strong" />
          <div className="flex items-start gap-3 py-2.5 pr-3 pl-4">
            <div className="min-w-0 flex-1">
              <Mono className="text-sm font-semibold tracking-wide text-strong">
                {SAMPLE.truck3}
              </Mono>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="text-faint">Never checked — it has no alert yet</span>
                <span className="inline-flex items-center gap-1 text-warn-500">
                  <BellRing size={11} /> no alert
                </span>
              </div>
            </div>
            <StillSwitch on />
            <ChevronRight size={15} className="mt-1 shrink-0 text-faint" />
          </div>
        </div>
      </Mark>
    </div>
  );
}

/** One lorry's own page: the facts, then the journey. */
function TruckDetail() {
  return (
    <div className="space-y-2.5">
      <Mark n={1}>
        <Panel bodyClassName="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-base font-semibold tracking-wide text-strong">
              {SAMPLE.truck}
            </Mono>
            <Badge tone="good">Moving</Badge>
          </div>
          <dl className="mt-2">
            <DescRow label="Last crossing">
              {SAMPLE.plaza} · 3 h ago
            </DescRow>
            <DescRow label="Checked every">15 minutes</DescRow>
            <DescRow label="Spent on this lorry">96 credits today</DescRow>
          </dl>
        </Panel>
      </Mark>

      <Mark n={2}>
        <Panel title="Crossings" description="Newest first" bodyClassName="divide-y divide-divider">
          {[
            { plaza: SAMPLE.plaza, when: "Today 14:20", way: "Delhi → Jaipur" },
            { plaza: SAMPLE.plaza3, when: "Yesterday 22:05", way: "Ahmedabad → Rajkot" },
            { plaza: SAMPLE.plaza2, when: "Yesterday 09:40", way: "Surat → Vadodara" },
          ].map((crossing) => (
            <div key={crossing.when} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
              <MapPin size={14} className="mt-0.5 shrink-0 text-brand-500" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{crossing.plaza}</p>
                <p className="text-xs text-muted">
                  {crossing.when} · {crossing.way}
                </p>
              </div>
            </div>
          ))}
        </Panel>
      </Mark>
    </div>
  );
}

/** The alert kinds, from whatever this deployment actually publishes. */
async function AlertRules() {
  const { alertRules } = await catalogue();

  if (alertRules.length === 0) {
    return (
      <Panel bodyClassName="px-4 py-3.5">
        <p className="text-sm text-muted">
          No alert kinds are published on this deployment at the moment.
        </p>
      </Panel>
    );
  }

  /* The first kind annotated line by line, the rest listed plainly. Markers
     on the PARTS of one row rather than one per row, for the reason written
     out in PlanCards: a marker per row means the legend and the picture
     disagree the moment an admin publishes a different number of kinds. */
  const [first, ...rest] = alertRules;

  return (
    <div className="space-y-2.5">
      <Panel bodyClassName="px-4 py-3">
        {/* Three markers on three stacked lines, never one on a badge at the
            right-hand end of a row: the marker sits in a left gutter, so a
            badge marker would land in the middle of the row on top of the
            title beside it. */}
        <Mark n={1}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-strong">
              {ALERT_KIND_LABEL[first.kind] ?? first.name}
            </p>
            <Badge tone="brand">every {intervalLabel(first.default_interval_minutes)}</Badge>
          </div>
        </Mark>
        <Mark n={2}>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {ALERT_KIND_HINT[first.kind] ?? first.description}
          </p>
        </Mark>
        <Mark n={3}>
          <p className="mt-1.5 text-xs text-faint">
            You would get: <Mono className="text-[11px]">{ALERT_KIND_EXAMPLE[first.kind]}</Mono>
          </p>
        </Mark>
      </Panel>

      {rest.slice(0, 2).map((rule) => (
        <Panel key={rule.id} bodyClassName="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-strong">
              {ALERT_KIND_LABEL[rule.kind] ?? rule.name}
            </p>
            <Badge tone="brand">every {intervalLabel(rule.default_interval_minutes)}</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {ALERT_KIND_HINT[rule.kind] ?? rule.description}
          </p>
        </Panel>
      ))}
    </div>
  );
}

/** The ledger, with this deployment's own rate on the charge line. */
async function CreditLedger() {
  const { rates } = await catalogue();
  const check = rates.find((rate) => rate.action === CREDIT_ACTIONS.autoCheck);
  const search = rates.find((rate) => rate.action === CREDIT_ACTIONS.manualSearch);

  return (
    <div className="space-y-2.5">
      <Mark n={1}>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Balance" value="1,240" tone="brand" />
          <StatCard label="Spent this month" value="2,880" sub="1 lorry, every 15 min" />
        </div>
      </Mark>

      <Mark n={2}>
        <div className="panel overflow-hidden">
          <TableWrap>
            <Thead>
              <th className="th whitespace-nowrap">When</th>
              <th className="th">What</th>
              <th className="th whitespace-nowrap">Credits</th>
              <th className="th whitespace-nowrap">Left</th>
            </Thead>
            <Tbody>
              <Tr>
                <td className="td whitespace-nowrap">14:20</td>
                <td className="td">
                  Check · <Mono className="text-[12px]">{SAMPLE.truck}</Mono>
                </td>
                <td className="td whitespace-nowrap text-bad-500">−1</td>
                <td className="td tabular-nums">1,240</td>
              </Tr>
              <Tr>
                <td className="td whitespace-nowrap">14:05</td>
                <td className="td">
                  Check · <Mono className="text-[12px]">{SAMPLE.truck}</Mono>{" "}
                  <span className="text-faint">— nothing new</span>
                </td>
                <td className="td whitespace-nowrap text-bad-500">−1</td>
                <td className="td tabular-nums">1,241</td>
              </Tr>
              <Tr>
                <td className="td whitespace-nowrap">11:32</td>
                <td className="td">Top-up · 2,000 credits</td>
                <td className="td whitespace-nowrap text-good-500">+2,000</td>
                <td className="td tabular-nums">1,242</td>
              </Tr>
            </Tbody>
          </TableWrap>
        </div>
      </Mark>

      {check || search ? (
        <p className="flex flex-wrap gap-1.5">
          {check ? <Badge tone="brand">Each check: {describeRate(check)}</Badge> : null}
          {search ? <Badge tone="neutral">Each search: {describeRate(search)}</Badge> : null}
        </p>
      ) : null}
    </div>
  );
}

/** The plans on sale here, at today's prices. */
async function PlanCards() {
  const { plans } = await catalogue();

  if (plans.length === 0) {
    return (
      <Panel bodyClassName="px-4 py-3.5">
        <p className="text-sm text-muted">No plans are on sale on this deployment right now.</p>
      </Panel>
    );
  }

  /*
   * TWO CARDS, AND ONLY THE FIRST IS ANNOTATED.
   *
   * Four stacked cards made this figure 996px tall at 390px - two and a half
   * screens of picture inside a three-minute article, which is the wall this
   * rebuild exists to remove. The full list is the pricing page's job.
   *
   * And the markers went on the four LINES of one card rather than one per
   * card, because "1: the first plan, 2: the second plan" annotates nothing.
   * It also keeps the count of markers fixed: a marker per plan means a
   * deployment selling two plans has two markers under a legend of four, and
   * the reader hunts for a circle that was never drawn.
   */
  const [first, second] = plans;

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <Panel bodyClassName="px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-strong">{first.name}</p>
          {first.is_trial ? <Badge tone="good">free</Badge> : null}
        </div>
        <Mark n={1}>
          <p className="mt-1.5 text-xl font-semibold tabular-nums text-ink">
            {fmtRupees(planChargeInr(first))}
          </p>
        </Mark>
        <Mark n={2}>
          <p className="text-xs text-faint">{planTermLabel(first)}, charged once</p>
        </Mark>
        <dl className="mt-2">
          <Mark n={3}>
            <DescRow label="Credits">{formatCredits(first.included_credits)}</DescRow>
          </Mark>
          <Mark n={4}>
            <DescRow label="Lorries">
              {first.truck_limit === -1 ? "unlimited" : first.truck_limit}
            </DescRow>
          </Mark>
        </dl>
      </Panel>

      {second ? (
        <Panel bodyClassName="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-strong">{second.name}</p>
            {second.is_trial ? <Badge tone="good">free</Badge> : null}
          </div>
          <p className="mt-1.5 text-xl font-semibold tabular-nums text-ink">
            {fmtRupees(planChargeInr(second))}
          </p>
          <p className="text-xs text-faint">{planTermLabel(second)}, charged once</p>
          <dl className="mt-2">
            <DescRow label="Credits">{formatCredits(second.included_credits)}</DescRow>
            <DescRow label="Lorries">
              {second.truck_limit === -1 ? "unlimited" : second.truck_limit}
            </DescRow>
          </dl>
        </Panel>
      ) : null}
    </div>
  );
}

/** Buying credits: the rungs, and what the payment page adds up. */
async function Checkout() {
  const [{ packs }, settings] = await Promise.all([catalogue(), publicSettings()]);
  const pack = packs.find((candidate) => !candidate.is_open_ended) ?? packs[0];

  return (
    <div className="space-y-2.5">
      <Mark n={1}>
        <Panel title="Top up credits" bodyClassName="space-y-2 px-4 py-3.5">
          {packs.length === 0 ? (
            <p className="text-sm text-muted">
              No credit packs are on sale on this deployment right now.
            </p>
          ) : (
            packs.slice(0, 3).map((candidate, index) => (
              <div
                key={candidate.id}
                className={cx(
                  "flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5",
                  index === 1
                    ? "border-brand-500 bg-brand-500/8"
                    : "border-line bg-panel",
                )}
              >
                <span className="text-sm font-medium tabular-nums text-strong">
                  {fmtRupees(candidate.price_inr)}
                  {candidate.is_open_ended ? (
                    <span className="font-normal text-muted"> or more</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted">
                  {candidate.is_open_ended
                    ? describeOpenTier(candidate, settings.creditsPerRupee)
                    : `${formatCredits(candidate.credits)} credits`}
                </span>
              </div>
            ))
          )}
        </Panel>
      </Mark>

      <Mark n={2}>
        <Panel title="What you are paying" bodyClassName="px-4 py-3">
          <dl>
            <DescRow label="Credits">
              {pack ? formatCredits(pack.credits) : formatCredits(2000)}
            </DescRow>
            <DescRow label="To pay">
              {pack ? fmtRupees(pack.price_inr) : fmtRupees(2000)}
            </DescRow>
            <DescRow label="Plan">Unchanged — a top-up moves no dates</DescRow>
          </dl>
          <div className="mt-3">
            <StillButton label="Pay securely" />
          </div>
        </Panel>
      </Mark>
    </div>
  );
}

/** The invite link, and today's actual percentages. */
async function ReferralShare() {
  let terms;
  try {
    terms = await loadReferralTerms(getSupabaseAdmin());
  } catch (error) {
    reportError("Guide figures: referral terms", error);
    terms = null;
  }

  return (
    <div className="space-y-2.5">
      <Mark n={1}>
        <Panel title="Your invite link" bodyClassName="px-4 py-3.5">
          <p className="rounded-lg border border-line bg-sunken px-3 py-2">
            <Mono className="text-[12px] break-all text-ink">
              rahdari.in/signup?ref={SAMPLE.code}
            </Mono>
          </p>
          <div className="mt-2.5 flex gap-2">
            <StillButton label="Copy link" tone="secondary" />
            <StillButton label="Share" tone="secondary" />
          </div>
        </Panel>
      </Mark>

      <Mark n={2}>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Invited" value="7" sub="3 have paid" />
          <StatCard label="Credits earned" value="1,850" tone="good" />
        </div>
      </Mark>

      {terms ? (
        <p className="flex flex-wrap gap-1.5">
          <Badge tone="brand">
            Their first plan: you {referralPercent(terms.planReferrerPercent)}, them{" "}
            {referralPercent(terms.planInviteePercent)}
          </Badge>
          <Badge tone="good">
            Their first top-up: you {referralPercent(terms.topupReferrerPercent)}, them{" "}
            {referralPercent(terms.topupInviteePercent)}
          </Badge>
        </p>
      ) : null}
    </div>
  );
}

/** What a payment looks like afterwards, including the two that did not work. */
function PaymentHistory() {
  return (
    <Mark n={1}>
      <div className="panel overflow-hidden">
        <TableWrap>
          <Thead>
            <th className="th whitespace-nowrap">Date</th>
            <th className="th">For</th>
            <th className="th whitespace-nowrap">Amount</th>
            <th className="th">State</th>
          </Thead>
          <Tbody>
            <Tr>
              <td className="td whitespace-nowrap">12 Sep</td>
              <td className="td">Top-up · 2,000 credits</td>
              <td className="td tabular-nums whitespace-nowrap">{fmtRupees(2000)}</td>
              <td className="td">
                <Badge tone="good">Paid</Badge>
              </td>
            </Tr>
            <Tr>
              <td className="td whitespace-nowrap">12 Sep</td>
              <td className="td">Top-up · 2,000 credits</td>
              <td className="td tabular-nums whitespace-nowrap">{fmtRupees(2000)}</td>
              <td className="td">
                <Badge tone="bad">Failed</Badge>
              </td>
            </Tr>
            <Tr>
              <td className="td whitespace-nowrap">14 Aug</td>
              <td className="td">Standard plan · 3 months</td>
              <td className="td tabular-nums whitespace-nowrap">{fmtRupees(999)}</td>
              <td className="td">
                <Badge tone="good">Paid</Badge>
              </td>
            </Tr>
          </Tbody>
        </TableWrap>
      </div>
    </Mark>
  );
}

/** Every badge a stopped lorry can wear, with this deployment's own window. */
async function PauseBadges() {
  const { inactivePauseHours } = await publicSettings();

  const shown: { reason: keyof typeof PAUSE_COPY; extra?: string }[] = [
    { reason: "manual" },
    { reason: "schedule" },
    { reason: "inactive", extra: `after ${intervalLabel(inactivePauseHours * 60)} with no crossing` },
    { reason: "repeated_failures", extra: "usually a typo in the number" },
    { reason: "no_credits", extra: "every lorry at once" },
    { reason: "plan_expired", extra: "every lorry at once" },
  ];

  return (
    <div className="space-y-2">
      {shown.map(({ reason, extra }, index) => {
        const copy = PAUSE_COPY[reason];
        return (
          <Mark key={reason} n={index + 1}>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-2.5">
              <Badge tone={copy.tone}>{copy.badge}</Badge>
              <span className="min-w-0 text-xs text-muted">{extra ?? copy.line}</span>
            </div>
          </Mark>
        );
      })}
    </div>
  );
}

/**
 * The three fields in Settings that decide whether a phone ever buzzes.
 *
 * NOT a drawing of Telegram. Telegram's own screens - the bot conversation,
 * the /start button, the utility bot that reports an id - belong to somebody
 * else's app and cannot be drawn honestly: a sketch of them either looks like
 * a screenshot and is wrong within a release, or looks like a sketch and helps
 * nobody. Those two steps are written as words in the article and linked out
 * to under the figure. What IS drawn is our own panel, which is what the
 * caption asks about and what the officer gets wrong.
 */
function TelegramSettings() {
  return (
    <Panel title="Telegram alerts" bodyClassName="space-y-3 px-4 py-4">
      <Mark n={1}>
        <StillField
          label="Telegram chat id"
          value="512340987"
          hint="A plain number. The id bot inside Telegram tells you yours."
        />
      </Mark>

      <Mark n={2}>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
          <span className="text-sm text-ink">Send me alerts on Telegram</span>
          <StillSwitch on />
        </div>
      </Mark>

      <Mark n={3}>
        <div className="flex flex-wrap items-center gap-2">
          <StillButton label="Send test" tone="secondary" />
          <Badge tone="good">Test message delivered</Badge>
        </div>
      </Mark>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* the map                                                                     */
/* -------------------------------------------------------------------------- */

/*
 * Every FigureName, drawn.
 *
 * A Record rather than a switch, so TypeScript refuses the commit that adds a
 * name to the union without drawing it - the failure this replaces is a figure
 * block that renders nothing at all and is only noticed by a reader.
 */
const SPECS: Record<FigureName, FigureSpec> = {
  "portal-home": {
    alt: "The portal's first screen",
    notes: [
      "What is left in the wallet, and roughly how many checks that buys.",
      "The plan: how many lorries may be watched at once, and until when.",
      "Every lorry you have added. The count is live, paused and silent together.",
      "Everything that has been sent to you, newest first.",
    ],
    body: <PortalHome />,
  },
  "add-truck": {
    alt: "Adding a lorry",
    notes: [
      "The registration number. Spaces and case do not matter; a wrong character does.",
      "Your own note — a driver, a consignment, a case number. Only you see it.",
      "When to stop by itself. This is the field that stops a forgotten lorry spending for a fortnight.",
    ],
    body: <AddTruck />,
  },
  "truck-row": {
    alt: "Three rows of My trucks",
    notes: [
      "A live lorry: green rail, where it was last recorded, and when it stops by itself.",
      "One the platform stopped: the badge says why, and the switch is off.",
      "One with no alert yet. It is switched on, it is never checked, and nothing will reach you.",
    ],
    body: <TruckRow />,
  },
  "truck-detail": {
    alt: "One lorry's own page",
    notes: [
      "The facts: where it was last recorded, how often it is checked, what it has cost.",
      "The journey — every crossing kept, newest first.",
    ],
    body: <TruckDetail />,
  },
  "alert-rules": {
    alt: "The kinds of alert",
    notes: [
      "The kind, with its suggested beat beside it. The kind decides when you are messaged; the beat decides what it costs.",
      "What that kind actually watches for.",
      "The message you would receive, word for word.",
    ],
    after:
      "Every kind is looked up just as often, so a quieter phone is not a cheaper lorry. Only a slower beat is cheaper.",
    body: <AlertRules />,
  },
  "credit-ledger": {
    alt: "The credit ledger",
    notes: [
      "The balance, and what this month has gone on.",
      "Every line, including the check that found nothing — it costs the same as the one that did.",
    ],
    body: <CreditLedger />,
  },
  "plan-cards": {
    alt: "A plan card, line by line",
    notes: [
      "The price. For the whole term and charged once — not a monthly figure, and there is nothing to multiply it by.",
      "The term. Automatic checking stops at the end of it unless the plan is renewed.",
      "Credits included. They arrive when the plan starts, and topping up is expected.",
      "Lorries: how many may be watched at the same time, not how many you may add to the list.",
    ],
    after: "Every plan on sale, with today's prices, is on [the pricing page](/pricing).",
    body: <PlanCards />,
  },
  checkout: {
    alt: "Topping up credits",
    notes: [
      "The rungs. Bigger ones are better value per credit.",
      "A top-up changes the balance and nothing else — not the plan, not its end date.",
    ],
    body: <Checkout />,
  },
  "telegram-setup": {
    alt: "The Telegram section of Settings",
    notes: [
      "The chat id. One number, and it is the only field that decides whether anything reaches your phone.",
      "The switch under it. A saved id with this off sends nothing at all.",
      "Send test. The only proof that both halves are done — if the test arrives, alerts will arrive.",
    ],
    after:
      `The two steps before this one happen inside Telegram itself, not here: get your id from [@${ID_BOT_USERNAME}](${ID_BOT_START_URL}), and send [@${ALERT_BOT_USERNAME}](${ALERT_BOT_START_URL}) a \`/start\`. [Get Telegram](https://telegram.org/apps)`,
    body: <TelegramSettings />,
  },
  "referral-share": {
    alt: "Your invite link",
    notes: [
      "Your own link. Anyone who registers on it is attached to you.",
      "What has come of it so far. Nothing is paid until they pay.",
    ],
    body: <ReferralShare />,
  },
  "payment-history": {
    alt: "Payments",
    notes: [
      "Every attempt is listed, including the ones that failed — a failed payment takes no money and adds no credits, so a duplicate line is normal.",
    ],
    body: <PaymentHistory />,
  },
  "pause-badges": {
    alt: "Why a lorry stopped",
    notes: [
      "You paused it. Nothing to fix.",
      "The end time you set arrived.",
      "No crossing for long enough that checking again was paying for yesterday's answer.",
      "The portal would not answer for this number often enough to stop trying.",
      "The balance could not pay for a check, so everything stopped at once.",
      "The plan ended and the days to renew ran out.",
    ],
    body: <PauseBadges />,
  },
};
