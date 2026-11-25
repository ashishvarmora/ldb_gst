# Live tracking v5 - plan (migration 0084)

Builds on `docs/LIVE-PLAN-v4.md`. Only what changes is written here. Each decision has a one-line "why".

## 1. Trip status (bug fix)

- The segmented Planned/Active/Done/Cancelled bar is gone. The trip header shows the **current status chip** and a small **Change status** control
  (status select + optional note + Save) in a popover card. It posts to `setTripState`; errors show right under it; every change is logged.
  *Why:* four look-alike buttons read as a display, not a control, and a refused change (driver busy on another trip) showed its error far below.
- `setTripState` re-reads the trip when the conditional update loses and reports the real reason (already changed / driver or truck busy / save failed).
- Planned trips keep one primary **Start trip** button (most common move).

## 2. Delay text

- "Moving slowly (about 0 km/h)" is impossible now. Speed below 3 km/h = **standing**. The page passes `stoppedMinutes` + `stoppedAt` (from the trail),
  the rule text says "standing for 1 h 10 min (since 14:05)", and the AI prompt + validator reject "0 km/h" wording.

## 3. Times: planned vs actual/live

| Time | Kind | Set by |
|---|---|---|
| Planned start (`planned_dispatch_at`) | static | trip form |
| Planned arrival (`promised_delivery_at`) | static | trip form |
| **Actual start** (`started_at`, existing column) | static once set | first move to Active (Start, driver, leaving From). Editable on the trip page **with a reason** (logged) |
| **Live ETA** (`eta_at`) | dynamic | every position: distance left ÷ recent speed, from actual progress |
| Arrived / Done (`arrived_at`, `delivered_at`) | static | geofence / driver / owner |

Trip page "Times" card: Planned | Actual/Live side by side with variance chips ("+45 min late", "1 h early").
Start variance = actual start − planned start. Arrival variance = live ETA (or actual arrival) − planned arrival.
*Why:* `started_at` already is the actual start; a second column would drift. No new column is needed.

## 4. Driver links

| | Own (master) driver | Temporary driver |
|---|---|---|
| Link | one **permanent personal link** reused on every trip | one link **per trip** |
| Positions go to | his Active trip, else his oldest Planned trip | that trip only |
| Regenerate | yes (old link stops at once) | yes (same rule) |
| Ends | when he taps Stop or you switch it off | 1 h after Done/Cancelled (profile setting), then removed |

One component `DriverLinkActions` (icon buttons: WhatsApp from your own phone, copy, regenerate, on/off) is used on the trip page and the driver page.
*Why:* drivers keep one bookmark; a temp driver from a supplier must not keep tracking access after the trip.

## 5. Pages

| URL | Content |
|---|---|
| `/live/trips/[id]` | status chip + Change status, issues, map, Times card, accordions: Driver & links, Details, Alerts, Activity, More |
| `/live/drivers/[id]` | driver info + live status + current trip + link actions only; small links to History and Activity (pre-filtered) |
| `/live/masters/drivers` · `/live/masters/trucks` · `/live/places` | compact rows, icon actions (edit, archive, delete); Add/Edit opens a **sheet** (`?add=1` / `?edit=<id>`) |
| `/live/history` | past trips: search, time chips (7 d / 30 d / 90 d / all), icon filters for driver / truck / warehouse |
| `/live/activity` | event log **grouped per trip**; same filters; `view=day` only when a driver is picked (his day-by-day log) |
| `/live/profile` | Live profile: account card, Live menu (business settings, alerts, masters, history, activity, switch app), account items (profile details, sign out) |
| `/live/profile/settings` | business + trip defaults + customer link options (moved from `/portal/profile/live`, which redirects) |
| `/live/profile/alerts` | default trip alerts: on/off + thresholds |
| `/portal/profile` | toll-only menu; the Live block is removed |
| `/track/<token>` | customer page (section 8) |

Shared profile pieces (`ProfileIdentity`, `ProfileMenu`) live in `src/components/ProfileView.tsx`; each app passes its own menu.
*Why:* one account, two apps; a toll user should not see trip settings and vice versa.

## 6. Masters fields

- **Warehouse**: Warehouse name, Contact person, Contact phone, Location (pick on map / Maps link / address), Type (Factory, Warehouse, Depot,
  Branch office, Customer site, Other… custom text), geofence (under (i)), custom fields. `site_type` (0084) holds the label; `kind` stays the
  coarse bucket for automation (Depot → warehouse, Customer site → customer, Other → other). Short Maps links are kept as `maps_url`.
- **Truck**: Registration no., Vehicle type (preset + custom; `vehicle_type`), Ownership Own/Hired (+ transporter), Capacity in tonnes (optional; `capacity_kg`), custom fields.
- **Driver**: Full name, Mobile, custom fields.

## 7. Activity vs History

- **History** = trips (what happened). **Activity** = events (how it happened), one block per trip. Per trip is the natural unit for driver,
  truck and warehouse questions; a day view is offered only for a driver (his working day across trips).
- Both take `q`, `range`, `driver`, `truck`, `place` in the URL, so driver/truck/warehouse rows link in pre-filtered.

## 8. Customer page `/track/<token>`

Trip no + name, sender business name, From → To, status, map + last update, planned arrival and live ETA, distance left, driver first name
(call button only if the owner switched "Show driver call button" on), truck number, goods (material, quantity, weight), delivered time + POD note.
Never: invoice value, freight, e-way bill, driver mobile (unless opted in), notes, activity.

## 9. Alerts (app only: in-app bell + push)

Defaults (Live profile → Alerts, `live_profiles.alert_settings` jsonb), applied to every trip:

| Key | Default | Threshold |
|---|---|---|
| started | on | - |
| late | on | 30 min past planned arrival |
| stopped | on | 30 min |
| no_signal | on | 30 min |
| eway | on | 6 h before expiry (+ expired) |
| arrived | on | - |
| done | on | - |
| driver_changed | on | - |

Per trip (`live_trips.alert_overrides` jsonb): switch any default off/on, and a custom late threshold. Dedupe stays on `live_trip_events (trip_id, dedupe_key)`.
Delivery: an alert writes an `alert_logs` row (`kind = live_<key>`, `url` to the trip) for the Live bell, and push (`sendPushToUser`) when the
change was not made by you. Telegram and WhatsApp are not used for Live alerts yet. The toll bell hides `live_*` rows; the Live bell shows only them.

## 10. UI rules

Mobile first at 375 px; icon buttons (28-32 px) with aria-labels; one accordion open at a time (`details name`); (i) for explanations; sheets for forms.

## 11. Migration 0084 (additive)

`live_trips.alert_overrides jsonb`; `live_profiles.alert_settings jsonb`, `track_show_driver boolean default true`, `track_call_driver boolean default false`;
`live_places.site_type text`, `live_places.maps_url text`; `live_vehicles.vehicle_type/capacity_kg` (if not exists); `alert_logs.url text` + index on (user_id, kind).
