"use client";

import { useState } from "react";

import { createAlertRule, updateAlertRule } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, FormGrid, Input, Select } from "@/components/form";
import { ALERT_KIND_HINT, ALERT_KIND_LABEL, keywordList } from "@/lib/alerts";
import { CITY_APPROACH_PRESETS, STATE_NAMES } from "@/lib/geo";
import type { AlertRule, AlertRuleKind, AppSettings } from "@/lib/types";

const KINDS: AlertRuleKind[] = [
  "approaching_city",
  "watchlist_move",
  "state_entry",
  "state_exit",
  "no_movement",
  "excessive_movement",
  "night_travel",
  "route_prediction",
];

function cfgString(config: Record<string, unknown> | undefined, key: string, fallback = ""): string {
  const value = config?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function cfgNumber(
  config: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const value = config?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

/**
 * One form for all eight rule types. The fields swap as the officer picks a
 * trigger, so they never see a box that does not apply to their choice.
 */
export function AlertRuleForm({
  mode,
  rule,
  settings,
}: {
  mode: "create" | "edit";
  rule?: AlertRule;
  settings: AppSettings;
}) {
  const [kind, setKind] = useState<AlertRuleKind>(rule?.kind ?? "approaching_city");
  const config = rule?.config as Record<string, unknown> | undefined;

  const [city, setCity] = useState(cfgString(config, "city"));
  const [tolls, setTolls] = useState(
    rule ? keywordList(config ?? {}, "tolls").join(", ") : "",
  );

  function applyPreset(value: string) {
    const preset = CITY_APPROACH_PRESETS.find((item) => item.city === value);
    if (!preset) return;
    setCity(preset.city);
    setTolls(preset.tolls.join(", "));
  }

  return (
    <ActionForm
      action={mode === "create" ? createAlertRule : updateAlertRule}
      closeOnSuccess={mode === "create"}
      resetOnSuccess={mode === "create"}
    >
      {rule ? <input type="hidden" name="rule_id" value={rule.id} /> : null}
      {mode === "edit" ? <input type="hidden" name="kind" value={kind} /> : null}

      <div className="space-y-4">
        {mode === "create" ? (
          <Field
            label="What should trigger it"
            name="kind"
            hint={ALERT_KIND_HINT[kind]}
          >
            <Select
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as AlertRuleKind)}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {ALERT_KIND_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="rounded-lg border border-ink-700/70 bg-ink-900/50 px-3 py-2.5 text-sm text-ink-200">
            {ALERT_KIND_LABEL[kind]}
            <span className="mt-0.5 block text-xs text-ink-400">{ALERT_KIND_HINT[kind]}</span>
          </p>
        )}

        <Field label="Rule name" name="name" hint="Shown on the alert and in your rule list.">
          <Input
            name="name"
            required
            defaultValue={rule?.name}
            placeholder={
              kind === "approaching_city"
                ? "Ahmedabad entry watch"
                : kind === "no_movement"
                  ? "Silent for 6 hours"
                  : "My rule"
            }
          />
        </Field>

        {/* ---------------------------------------------------------------- */}
        {kind === "approaching_city" ? (
          <>
            <Field
              label="Start from a preset"
              name="preset"
              hint="Optional shortcut. You can edit the plazas afterwards."
            >
              <Select
                name="preset"
                defaultValue=""
                onChange={(event) => applyPreset(event.target.value)}
              >
                <option value="">Choose a city…</option>
                {CITY_APPROACH_PRESETS.map((preset) => (
                  <option key={preset.city} value={preset.city}>
                    {preset.city}
                  </option>
                ))}
              </Select>
            </Field>

            <FormGrid cols={2}>
              <Field label="City name" name="city">
                <Input
                  name="city"
                  required
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="Ahmedabad"
                />
              </Field>
              <Field
                label="Cooldown (minutes)"
                name="cooldown_minutes"
                hint="Do not repeat this alert within this many minutes."
              >
                <Input
                  name="cooldown_minutes"
                  type="number"
                  min={0}
                  max={10080}
                  defaultValue={cfgNumber(config, "cooldown_minutes", 120)}
                />
              </Field>
            </FormGrid>

            <Field
              label="Toll plaza keywords"
              name="tolls"
              hint="Comma separated. A crossing matches if its plaza name contains any of these."
            >
              <Input
                name="tolls"
                required
                value={tolls}
                onChange={(event) => setTolls(event.target.value)}
                placeholder="ahmedabad, sanand, bavla, kheda, nadiad"
              />
            </Field>
          </>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {kind === "state_entry" || kind === "state_exit" ? (
          <FormGrid cols={2}>
            <Field
              label="State"
              name="state"
              hint={
                kind === "state_entry"
                  ? "Leave blank to be told about any state change."
                  : "You are alerted when the truck leaves this state."
              }
            >
              <Select name="state" defaultValue={cfgString(config, "state")}>
                <option value="">{kind === "state_entry" ? "Any state" : "Choose a state…"}</option>
                {STATE_NAMES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cooldown (minutes)" name="cooldown_minutes">
              <Input
                name="cooldown_minutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={cfgNumber(config, "cooldown_minutes", 180)}
              />
            </Field>
          </FormGrid>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {kind === "no_movement" ? (
          <FormGrid cols={2}>
            <Field
              label="Silent for how many hours"
              name="hours"
              hint={`Platform default is ${settings.noActivityHours}h.`}
            >
              <Input
                name="hours"
                type="number"
                min={1}
                max={168}
                required
                defaultValue={cfgNumber(config, "hours", settings.noActivityHours)}
              />
            </Field>
            <Field
              label="Cooldown (minutes)"
              name="cooldown_minutes"
              hint="Stops the same silence being reported over and over."
            >
              <Input
                name="cooldown_minutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={cfgNumber(config, "cooldown_minutes", settings.noActivityHours * 60)}
              />
            </Field>
          </FormGrid>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {kind === "excessive_movement" ? (
          <FormGrid cols={3}>
            <Field label="Plazas crossed" name="toll_count">
              <Input
                name="toll_count"
                type="number"
                min={2}
                max={50}
                required
                defaultValue={cfgNumber(config, "tolls", settings.excessiveTolls)}
              />
            </Field>
            <Field label="Within hours" name="hours">
              <Input
                name="hours"
                type="number"
                min={1}
                max={48}
                required
                defaultValue={cfgNumber(config, "hours", settings.excessiveWindowHours)}
              />
            </Field>
            <Field label="Cooldown (minutes)" name="cooldown_minutes">
              <Input
                name="cooldown_minutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={cfgNumber(
                  config,
                  "cooldown_minutes",
                  settings.excessiveWindowHours * 60,
                )}
              />
            </Field>
          </FormGrid>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {kind === "night_travel" ? (
          <FormGrid cols={3}>
            <Field label="From" name="from">
              <Input
                name="from"
                type="time"
                required
                defaultValue={cfgString(config, "from", settings.nightFrom)}
              />
            </Field>
            <Field label="To" name="to">
              <Input
                name="to"
                type="time"
                required
                defaultValue={cfgString(config, "to", settings.nightTo)}
              />
            </Field>
            <Field label="Cooldown (minutes)" name="cooldown_minutes">
              <Input
                name="cooldown_minutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={cfgNumber(config, "cooldown_minutes", 120)}
              />
            </Field>
          </FormGrid>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {kind === "route_prediction" ? (
          <>
            <Field
              label="Corridor, in order"
              name="sequence"
              hint="Comma separated plaza keywords. When a truck moves along them, you get the next expected stop."
            >
              <Input
                name="sequence"
                required
                defaultValue={rule ? keywordList(config ?? {}, "sequence").join(", ") : ""}
                placeholder="dahod, godhra, vadodara, nadiad, ahmedabad"
              />
            </Field>
            <FormGrid cols={2}>
              <Field label="Likely destination" name="destination" hint="Used in the alert text.">
                <Input
                  name="destination"
                  defaultValue={cfgString(config, "destination")}
                  placeholder="Ahmedabad"
                />
              </Field>
              <Field label="Cooldown (minutes)" name="cooldown_minutes">
                <Input
                  name="cooldown_minutes"
                  type="number"
                  min={0}
                  max={10080}
                  defaultValue={cfgNumber(config, "cooldown_minutes", 120)}
                />
              </Field>
            </FormGrid>
          </>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {kind === "watchlist_move" ? (
          <Field
            label="Cooldown (minutes)"
            name="cooldown_minutes"
            hint="0 means every single crossing is reported."
          >
            <Input
              name="cooldown_minutes"
              type="number"
              min={0}
              max={10080}
              defaultValue={cfgNumber(config, "cooldown_minutes", 0)}
              className="max-w-40"
            />
          </Field>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Checkbox
            name="notify_telegram"
            label="Send on Telegram"
            defaultChecked={rule?.notify_telegram ?? true}
          />
          <Checkbox
            name="notify_sheet"
            label="Write to my Google Sheet"
            defaultChecked={rule?.notify_sheet ?? true}
          />
        </div>
      </div>

      <FormActions>
        <SubmitButton pendingLabel="Saving...">
          {mode === "create" ? "Create rule" : "Save rule"}
        </SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
