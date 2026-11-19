"use client";

import { useActionPending } from "@/components/ActionForm";

/**
 * What the search box shows while a lookup runs (often a few seconds, since
 * the toll records come from upstream): the plate gets a camera-style scan
 * sweep, and a small road appears under it - the truck sets off slowly and
 * picks up speed, toll gantries come by and turn green as it passes - with
 * the step in words.
 *
 * Renders nothing until the form is submitting, so it costs nothing on load.
 * CSS only (transform/opacity), drawn in screens-polish.css; still under
 * prefers-reduced-motion.
 */
export function SearchScan() {
  const pending = useActionPending();
  if (!pending) return null;
  return (
    <div className="search-scan" role="status" aria-live="polite">
      <div className="scan-road" aria-hidden>
        <div className="scan-track">
          <i className="scan-gantry" style={{ left: "30%" }} />
          <i className="scan-gantry" style={{ left: "80%" }} />
        </div>
        {/* the same road again, clipped to behind the truck's nose: its lights are green */}
        <div className="scan-pass">
          <div className="scan-track">
            <i className="scan-gantry" style={{ left: "30%" }} />
            <i className="scan-gantry" style={{ left: "80%" }} />
          </div>
        </div>
        <i className="scan-truck" />
      </div>
      <p className="scan-steps">
        <span>Reading toll crossings…</span>
        <span>Matching toll plazas…</span>
        <span>Putting the route together…</span>
      </p>
    </div>
  );
}
