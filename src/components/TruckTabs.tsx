"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { cx } from "@/components/ui";

/**
 * The truck page's four sections, one at a time (owner, 20 Nov 2026).
 *
 * Every panel is rendered on the server and handed in as a node; this only
 * decides which one is visible, so switching tabs fetches nothing. The URL hash
 * follows the tab (#alerts, #route, #activity, #settings) so a link can land
 * on one, and the older anchors still work: #tracking opens Settings and
 * #alert-<id> opens Alerts and scrolls to that row.
 */
export type TruckTabId = "alerts" | "route" | "activity" | "settings";

export type TruckTab = {
  id: TruckTabId;
  label: string;
  content: ReactNode;
};

const ALIASES: Record<string, TruckTabId> = { tracking: "settings" };

function tabForHash(hash: string, ids: TruckTabId[]): TruckTabId | null {
  const key = decodeURIComponent(hash.replace(/^#/, ""));
  if (!key) return null;
  if ((ids as string[]).includes(key)) return key as TruckTabId;
  if (ALIASES[key]) return ALIASES[key];
  if (key.startsWith("alert-")) return "alerts";
  return null;
}

export function TruckTabs({
  tabs,
  defaultTab = "alerts",
}: {
  tabs: TruckTab[];
  defaultTab?: TruckTabId;
}) {
  const [active, setActive] = useState<TruckTabId>(defaultTab);
  const ids = tabs.map((tab) => tab.id);
  const idsKey = ids.join(",");

  /* Follow the hash on arrival and whenever an in-page link changes it. A hash
     that names something inside a tab (not the tab itself) is scrolled to once
     that tab is showing. */
  const followHash = useCallback(() => {
    const hash = window.location.hash;
    const tab = tabForHash(hash, idsKey.split(",") as TruckTabId[]);
    if (!tab) return;
    setActive(tab);
    const key = decodeURIComponent(hash.replace(/^#/, ""));
    if (key !== tab) {
      requestAnimationFrame(() => {
        document.getElementById(key)?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    }
  }, [idsKey]);

  useEffect(() => {
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [followHash]);

  function choose(id: TruckTabId) {
    setActive(id);
    /* replaceState, not location.hash: no history entry per tap, and no jump
       to an element that happens to share the id. */
    try {
      window.history.replaceState(window.history.state, "", `#${id}`);
    } catch {
      /* a sandboxed frame can refuse; the tab still switches */
    }
  }

  return (
    <div className="truck-tabs">
      <div role="tablist" aria-label="Truck sections" className="truck-tabs-bar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`truck-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`truck-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => choose(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const index = ids.indexOf(tab.id);
              const next =
                ids[(index + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
              choose(next);
              document.getElementById(`truck-tab-${next}`)?.focus();
            }}
            className={cx("truck-tab", active === tab.id && "is-active")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`truck-panel-${tab.id}`}
          aria-labelledby={`truck-tab-${tab.id}`}
          hidden={active !== tab.id}
          className="truck-tab-panel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
