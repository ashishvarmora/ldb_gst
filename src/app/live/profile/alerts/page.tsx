import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { liveSchema84, loadLiveProfile, requireLiveSession } from "@/lib/live/server";
import { ALERT_KEYS, ALERT_META, alertDefaults } from "@/lib/live/shared";

import { saveAlertSettings } from "../../actions";
import { BackLink } from "../../BackLink";
import { InfoTip } from "../../parts";

export const metadata = { title: "Live tracking - Alerts" };
export const dynamic = "force-dynamic";

/**
 * Live profile > Alerts (v5 §9): the default alerts applied to every trip.
 * Each trip can switch any of them off/on and set its own late threshold.
 * App only for now: the in-app bell and phone push.
 */
export default async function AlertsPage() {
  const live = await requireLiveSession();
  const [profile, has84] = await Promise.all([loadLiveProfile(live.ownerId), liveSchema84()]);
  const cfg = alertDefaults(profile.alert_settings);

  return (
    <div className="live-page mx-auto max-w-xl space-y-3">
      <BackLink href="/live/profile" label="Profile" />
      <header className="live-mhead">
        <h1>Alerts</h1>
        <InfoTip label="How alerts work">
          These apply to every trip. On a trip, open Alerts to switch one off for that trip or set its own late time. Each alert comes once per event (no repeats).
          You get it in the bell here and as a phone notification when the change was not made by you.
        </InfoTip>
      </header>
      {!has84 ? <p className="live-warn">Alert settings need database update 0084. Until then all alerts are on with 30 min / 6 h.</p> : null}
      <ActionForm action={saveAlertSettings} closeOnSuccess={false} className="panel p-3">
        <ul className="live-toggles">
          {ALERT_KEYS.map((k) => {
            const meta = ALERT_META[k];
            return (
              <li key={k}>
                <label>
                  <input type="checkbox" name={`a_${k}`} defaultChecked={cfg[k].on} className="live-switch" disabled={!has84} />
                  <span>
                    {meta.label}
                    <small className="block">{meta.help}</small>
                  </span>
                </label>
                {meta.min ? (
                  <select name={`m_${k}`} defaultValue={String(cfg[k].min)} className="field live-field-xs" aria-label={`${meta.label} threshold`} disabled={!has84}>
                    {[...new Set([...meta.min.options, cfg[k].min])].sort((a, b) => a - b).map((n) => (
                      <option key={n} value={n}>
                        {n} {meta.min!.unit}
                      </option>
                    ))}
                  </select>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-faint">App only: bell + push. WhatsApp comes later.</p>
          {has84 ? <SubmitButton size="sm">Save</SubmitButton> : null}
        </div>
      </ActionForm>
    </div>
  );
}
