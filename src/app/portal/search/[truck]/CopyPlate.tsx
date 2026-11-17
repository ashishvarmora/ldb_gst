"use client";

import { Check, Copy } from "lucide-react";

import { useCopy } from "@/components/useCopy";
import { cx } from "@/components/ui";

/** The plate, big and monospace, with a tap-to-copy beside it. */
export function CopyPlate({ truckNumber }: { truckNumber: string }) {
  const { copied, problem, copy } = useCopy();
  const done = copied !== null;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <h1 className="min-w-0 font-mono text-2xl font-bold tracking-wider break-all text-strong sm:text-3xl">
          {truckNumber}
        </h1>
        <button
          type="button"
          onClick={() => copy(truckNumber)}
          aria-label={done ? "Copied" : `Copy ${truckNumber}`}
          title={done ? "Copied" : "Copy number"}
          className={cx(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition",
            done ? "text-good-500" : "text-muted hover:bg-sunken hover:text-ink",
          )}
        >
          {done ? <Check size={17} /> : <Copy size={16} />}
        </button>
      </div>
      {problem ? <p className="mt-1 text-xs text-muted">{problem}</p> : null}
    </div>
  );
}
