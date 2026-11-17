"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";

import { checkSavedTruck, removeSavedTruck, renameSavedTruck } from "./actions";
import { directionLabel } from "@/components/Timeline";
import { buttonClass, cx } from "@/components/ui";
import type { SavedTruck } from "@/lib/saved-trucks";

/**
 * The saved list itself. Every action answers in place - a check spins on its
 * own row and the row updates, a removal disappears at once - so working
 * through ten trucks in the morning never reloads the page.
 */

function ago(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

type RowState = { busy?: boolean; note?: { ok: boolean; text: string } };

export function SavedList({
  initial,
  searchCost,
  limit,
}: {
  initial: SavedTruck[];
  searchCost: number;
  limit: number;
}) {
  const [rows, setRows] = useState(initial);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const patch = (truck: string, next: RowState) =>
    setState((current) => ({ ...current, [truck]: { ...current[truck], ...next } }));

  async function check(truck: string): Promise<void> {
    patch(truck, { busy: true, note: undefined });
    const result = await checkSavedTruck(truck);
    if (result.ok && "row" in result && result.row) {
      const updated = result.row;
      setRows((current) => current.map((row) => (row.truck_number === truck ? updated : row)));
    }
    patch(truck, {
      busy: false,
      note: result.ok ? { ok: true, text: result.message ?? "Checked." } : { ok: false, text: result.error },
    });
  }

  async function checkAll() {
    const cost = rows.length * searchCost;
    if (!window.confirm(`Check all ${rows.length} trucks now? This uses up to ${cost} credit${cost === 1 ? "" : "s"} (failed checks are refunded).`)) return;
    setRunning({ done: 0, total: rows.length });
    for (const [index, row] of rows.entries()) {
      await check(row.truck_number);
      setRunning({ done: index + 1, total: rows.length });
    }
    setRunning(null);
    startTransition(() => router.refresh());
  }

  function remove(truck: string) {
    setRows((current) => current.filter((row) => row.truck_number !== truck));
    startTransition(async () => {
      const result = await removeSavedTruck(truck);
      if (!result.ok) router.refresh();
    });
  }

  function rename(truck: string, current: string | null) {
    const next = window.prompt("Name this truck (optional, e.g. driver or route)", current ?? "");
    if (next === null) return;
    setRows((list) => list.map((row) => (row.truck_number === truck ? { ...row, label: next.trim() || null } : row)));
    startTransition(async () => {
      await renameSavedTruck(truck, next);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-500">
          <Star size={26} />
        </span>
        <h2 className="text-base font-semibold text-strong">No saved trucks yet</h2>
        <p className="max-w-sm text-sm text-muted">
          Tap the ★ on any search result to keep a truck here. Then check it again with one tap,
          whenever you like.
        </p>
        <Link href="/portal/search" className={buttonClass("primary", "md")}>
          Search a truck
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          <span className="font-semibold text-strong">{rows.length}</span> of {limit} saved
          {rows.length >= limit ? " — full, remove one to save another" : ""}
        </p>
        <button
          type="button"
          onClick={checkAll}
          disabled={running !== null}
          className={buttonClass("primary", "sm")}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {running ? `Checking ${running.done}/${running.total}…` : `Check all · ${rows.length * searchCost} credit${rows.length * searchCost === 1 ? "" : "s"}`}
        </button>
      </div>

      <ul className="space-y-2.5">
        {rows.map((row) => {
          const s = state[row.truck_number] ?? {};
          const failed = row.last_ok === false;
          return (
            <li key={row.truck_number} className="panel p-3.5">
              <div className="flex items-start gap-3">
                <Link
                  href={`/portal/search/${encodeURIComponent(row.truck_number)}`}
                  className="group min-w-0 flex-1"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-base font-semibold tracking-wide text-strong group-hover:text-brand-500">
                      {row.truck_number}
                    </span>
                    {row.label ? <span className="truncate text-xs text-muted">{row.label}</span> : null}
                  </span>
                  <span className="mt-1 flex items-start gap-1.5 text-sm text-ink">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-brand-500" />
                    {row.last_plaza ? (
                      <span className="min-w-0">
                        <span className="font-medium">{row.last_plaza}</span>
                        <span className="text-muted"> · {ago(row.last_event_at)}{directionLabel(row.last_direction) ? ` · ${directionLabel(row.last_direction)}` : ""}</span>
                      </span>
                    ) : (
                      <span className="text-muted">{row.last_checked_at ? "No crossings on record" : "Not checked yet"}</span>
                    )}
                  </span>
                  <span className={cx("mt-1 flex items-center gap-1.5 text-xs", failed ? "text-bad-500" : "text-muted")}>
                    {row.last_checked_at ? (
                      <>
                        {failed ? <XCircle size={12} /> : <CheckCircle2 size={12} className="text-good-500" />}
                        Checked {ago(row.last_checked_at)} ({when(row.last_checked_at)})
                        {failed ? " — failed, credit returned" : row.last_new ? ` · ${row.last_new} new` : ""}
                      </>
                    ) : (
                      "Tap Check now to look it up"
                    )}
                  </span>
                </Link>
                <ChevronRight size={16} className="mt-1 shrink-0 text-muted" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-divider pt-3">
                <button
                  type="button"
                  onClick={() => check(row.truck_number)}
                  disabled={s.busy || running !== null}
                  className={buttonClass("primary", "sm")}
                >
                  {s.busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {s.busy ? "Checking…" : `Check now · ${searchCost}`}
                </button>
                <button type="button" onClick={() => rename(row.truck_number, row.label)} className={buttonClass("secondary", "sm")}>
                  <Pencil size={13} />
                  Name
                </button>
                <button
                  type="button"
                  onClick={() => remove(row.truck_number)}
                  disabled={s.busy}
                  className={cx(buttonClass("secondary", "sm"), "ml-auto text-bad-500")}
                  aria-label={`Remove ${row.truck_number}`}
                >
                  <Trash2 size={13} />
                  Remove
                </button>
              </div>
              {s.note ? (
                <p className={cx("mt-2 text-xs", s.note.ok ? "text-good-500" : "text-bad-500")}>{s.note.text}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
