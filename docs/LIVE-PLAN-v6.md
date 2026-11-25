# Live tracking v6 - plan (migration 0085)

Builds on `docs/LIVE-PLAN-v5.md`. Only what changes. Each decision has a one-line "why".

## 1. Header

`/live/*` uses the toll app's header strip as is: brand on phones, quiet "Live tracking" text on desktop, then **App switcher, Help chat, Bell, Profile**
(same `hdr-btn` 40 px buttons, same padding). The orange "Live" pill is gone. *Why:* one product, two apps; the app name belongs in the switcher, not a badge.

## 2. Trucks master = our trucks only

Ownership (Own / Hired) and Transporter are removed from the truck form and list; a regularly hired truck is simply one of ours. `owner_type`,
`ownership`, `transporter` stay in `live_vehicles` but are no longer written (new rows take the DB default). A one-off truck is still a temporary truck on the trip.
*Why:* the master is "trucks we dispatch", not a vendor register.

## 3. Logbook (replaces History + Activity)

**Name: Logbook.** Every truck and driver in India already keeps a "log book"; it says "the record of what happened" without being a report, and it covers both trips (what)
and events (how). "Records" is vague, "Fleet log" leaves out warehouses, "History" read as only finished trips.

| URL | Shows |
|---|---|
| `/live/logbook/trips` | every trip (compact rows), search + time + driver/truck/warehouse icon filters; tap = trip summary + full activity (by phase) |
| `/live/logbook/trucks` | per truck: trips · days · hours, on-trip badge, last trip; tap = its trips (when → when, duration, why/purpose, driver, route) with activity inside |
| `/live/logbook/drivers` | per own driver: trips · days · hours; tap = his trips, or **By day** (his working days) |
| `/live/logbook/warehouses` | per warehouse: out (dispatches) · in (arrivals) · days; tap = its trips, or **By day** |

Hours = actual start → arrived/done/cancelled (now while Active). Days = IST calendar days touched. Time chips: 7 d / 30 d / 90 d / All (default 30 d).
`/live/history`, `/live/activity`, `/portal/profile/live/activity` redirect here keeping filters (`?driver=X` alone opens that driver, etc.).
Driver page, Trucks / Warehouses masters, Masters menu, Profile and the trip page link straight in.

## 4. Trips list

One compact row, three short lines, no chevron: (1) trip no + name, issue icons, status chip; (2) driver (body font) · plate (small mono chip) · GPS signal when Active;
(3) From → To, right side "120 km · ETA 18:40" / "Arrived 14:05" / "Done 24 Nov 2:05 pm" / "Starts …". Direction is a 6 px dot (orange out, green in).
Page h1 1.25 rem; trip page h1 1.15 rem. *Why:* the list is for scanning; goods, documents, links and the timeline belong to the opened trip.

## 5. Where is my truck (trip page + customer page)

**Planning.** The form asks **Planned start** + **Journey hours** (incl. the driver's halts). Planned arrival = start + hours, shown read-only and stored in
`promised_delivery_at` (so the late alert keeps working). "Use 14 h" fills the hint from distance at 40 km/h. Old trips: hours derived from planned arrival − start.

**Route (built once).** `ensureRoutePlan()` (src/lib/live/route.ts): AI (`routePlanAI`, src/lib/live-ai.ts) lists 4–10 main stops / junctions with road km from the origin;
validated (India bbox, within the From→To corridor, in order, km increasing and 1.0–1.9× straight line, else straight × 1.25). Fallback: rule-based highway hubs.
Cached in `live_trips.route_plan`; rebuilt only when From or To moves > 1 km. Before 0085 it uses the free rules (no AI per view).

**Times per stop** (src/lib/live/timeline.ts, pure):
- Scheduled = (actual start, else planned start) + journey hours × stop km / total km.
- Actual = first GPS position within 5 km of the stop; if none, the moment the truck's route progress first crossed the stop (interpolated, shown "≈").
  Progress = projection of each position on the stop polyline, kept monotonic, far-off fixes (> 40 km) ignored.
- Expected (remaining stops) = now + (stop km − progress) / (total − progress) × (live ETA − now) → the last stop lands exactly on the trip's live ETA.
  No ETA: recent average speed (last 2 h, 25–55 km/h), else the schedule pace.
- Badge = time − scheduled: "Delay 13 min" (red), "Before 12 min" (green), within 5 min "On time".
- Truck marker between the last passed and the next stop ("38 km to Palanpur"); day line "Day 2 · Thu, 26 Nov" when the scheduled date changes.

The v5 Times card and Road ahead are gone; their facts sit in the timeline footer (start planned vs actual, arrival planned vs live/actual, "Correct actual start").
The map stats keep last position, speed, distance left, ETA. Customer page shows the same timeline read-only (no speed basis, no internal data).

## 6. UI rules

375 px first; 12–13.5 px body in lists; one accordion open at a time (`details name`); icon buttons with labels; (i) explains every computed number.

## 7. Migration 0085 (additive)

`live_trips.journey_hours numeric(6,2)` (0 < h ≤ 240), `live_trips.route_plan jsonb` (object, ≤ 8 KB). The app works before it is applied.
