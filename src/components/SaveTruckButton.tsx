"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star } from "lucide-react";

import { toggleSavedTruck } from "@/app/portal/saved/actions";
import { buttonClass, cx } from "@/components/ui";

/**
 * The ★ that puts a number on Saved trucks, or takes it off (0066).
 *
 * Optimistic: the star fills the moment it is tapped and only goes back if the
 * server refuses (for example when the list is full), with the reason shown
 * underneath. `compact` is the bare icon used inside list rows; the default is
 * a labelled button for page headers.
 */
export function SaveTruckButton({
  truckNumber,
  saved: initiallySaved,
  compact = false,
  className,
}: {
  truckNumber: string;
  saved: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    setError(null);
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      const result = await toggleSavedTruck(truckNumber);
      if (!result.ok) {
        setSaved(!next);
        setError(result.error);
        return;
      }
      setSaved(Boolean(result.saved));
      router.refresh();
    });
  }

  const label = saved ? `Remove ${truckNumber} from Saved trucks` : `Save ${truckNumber}`;

  return (
    <span className={cx("inline-flex flex-col items-start", className)}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        aria-label={label}
        title={label}
        className={
          compact
            ? cx(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition",
                saved ? "text-amber-500 hover:bg-amber-500/10" : "text-muted hover:bg-sunken hover:text-ink",
              )
            : buttonClass(saved ? "secondary" : "secondary", "sm", saved ? "border-amber-500/50 text-amber-600" : undefined)
        }
      >
        {pending && compact ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Star size={compact ? 19 : 14} className={saved ? "fill-amber-400 text-amber-500" : undefined} />
        )}
        {compact ? null : saved ? "Saved" : "Save"}
      </button>
      {error ? <span className="mt-1 max-w-64 text-xs text-bad-500">{error}</span> : null}
    </span>
  );
}
