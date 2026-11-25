import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logLive, requireLiveSession } from "@/lib/live/server";
import { formatIndianMobile } from "@/lib/phone";
import type { LiveDriver } from "@/lib/live/shared";

import { saveDriver } from "../../actions";
import { BackLink } from "../../BackLink";
import { DriverSignalPill, KindChip } from "../../parts";

export const metadata = { title: "Live tracking - Drivers master" };
export const dynamic = "force-dynamic";

export default async function DriversMaster({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const showArchived = sp.archived === "1";
  let q = getSupabaseAdmin().from("live_drivers").select("*").eq("owner_id", ownerId).order("name").limit(500);
  q = showArchived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data, error } = await q;
  if (error) logLive("drivers master", error);
  const drivers = (data ?? []) as LiveDriver[];
  const now = Date.now();

  return (
    <div className="live-page mx-auto max-w-3xl space-y-4">
      <BackLink href="/live/masters" label="Masters" />
      <header className="live-page-head">
        <div>
          <h1>Drivers</h1>
          <p>One mobile number = one driver. Archived drivers keep their history.</p>
        </div>
      </header>

      <details className="panel live-form-block" open={drivers.length === 0 && !showArchived}>
        <summary className="live-h2 cursor-pointer">+ Add a driver</summary>
        <ActionForm action={saveDriver} closeOnSuccess={false} resetOnSuccess refresh={false} className="mt-3">
          <div className="live-form-grid">
            <Field label="Name" name="name" required>
              <Input name="name" required />
            </Field>
            <Field label="Mobile" name="phone" required>
              <Input name="phone" required inputMode="tel" placeholder="98765 43210" />
            </Field>
            <Field label="Type" name="kind">
              <Select name="kind" defaultValue="own">
                <option value="own">Own driver</option>
                <option value="one_time">One-time (dealer / supplier)</option>
              </Select>
            </Field>
            <Field label="Dealer / supplier" name="company" hint="For one-time drivers.">
              <Input name="company" />
            </Field>
          </div>
          <div className="mt-3">
            <SubmitButton size="sm">Save driver</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <nav className="live-tabs" aria-label="Filter">
        <Link href="/live/masters/drivers" aria-current={!showArchived ? "page" : undefined}>
          Active
        </Link>
        <Link href="/live/masters/drivers?archived=1" aria-current={showArchived ? "page" : undefined}>
          Archived
        </Link>
      </nav>

      <div className="live-menu">
        {drivers.map((d) => (
          <Link key={d.id} href={`/live/drivers/${d.id}`}>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <strong>{d.name}</strong>
                <KindChip driver={d} />
              </span>
              <small>
                {d.phone ? formatIndianMobile(d.phone) : "No mobile"}
                {showArchived ? "" : " · "}
                {showArchived ? null : <DriverSignalPill driver={d} now={now} />}
              </small>
            </span>
            <ChevronRight size={16} className="text-faint" />
          </Link>
        ))}
        {drivers.length === 0 ? <p className="live-empty">{showArchived ? "No archived drivers." : "No drivers yet."}</p> : null}
      </div>
    </div>
  );
}
