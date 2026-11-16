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
      {/*
        The field is drawn as an Indian number plate - the blue IND strip, the
        black rim, bold plate lettering - so it says what to type before the
        placeholder does. The orange button sits on the same row, plate-high.
      */}
      <div className="plate-row">
        <div className="plate-field">
          <span className="plate-ind" aria-hidden>
            <span className="plate-ind-flag" />
            IND
          </span>
          <Input
            id="truck-search-number"
            name="truck_number"
            aria-label="Truck registration number"
            required
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="GJ 02 AT 8546"
            className="plate-input"
          />
        </div>
        <SubmitButton className="plate-go" pendingLabel="">
          <Search size={18} strokeWidth={2.4} />
          <span>Search</span>
        </SubmitButton>
      </div>
      {hint ? <p className="mt-2 text-xs text-faint">{hint}</p> : null}
    </ActionForm>
  );
}
