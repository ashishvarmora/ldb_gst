import { Search } from "lucide-react";

import { manualSearch } from "@/app/portal/search/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/form";
import { cx } from "@/components/ui";

/**
 * The one control an officer uses most. Uppercasing is done with CSS and
 * normalised again on the server, so no client JS is needed for it.
 */
export function SearchBox({
  autoFocus = false,
  className,
  hint = "Uses one manual search credit. Spaces and dashes are ignored.",
}: {
  autoFocus?: boolean;
  className?: string;
  hint?: string | null;
}) {
  return (
    <ActionForm action={manualSearch} closeOnSuccess={false} className={cx("truck-search-form", className)}>
      <label htmlFor="truck-search-number" className="search-input-label">Truck registration number</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
          />
          <Input
            id="truck-search-number"
            name="truck_number"
            aria-label="Truck registration number"
            required
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. GJ02AT8546"
            className={cx(
              "py-3 pl-10 font-mono text-base",
              "placeholder:font-sans placeholder:tracking-normal placeholder:normal-case",
            )}
          />
        </div>
        <SubmitButton className="justify-center py-3 sm:w-40" pendingLabel="Searching...">
          <Search size={18}/>Search truck
        </SubmitButton>
      </div>
      {hint ? <p className="mt-2 text-xs text-faint">{hint}</p> : null}
    </ActionForm>
  );
}
