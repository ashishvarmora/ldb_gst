# Rahdari Live tracking module (0079)

Rahdari = **Toll tracking** (FASTag crossings, `/portal`) + **Live tracking** (GPS from the driver's phone, `/live`).
Same login, separate space, separate data. Switch apps from the grid button in either header, the `/apps` launcher, or the tile on the portal home.

## Access and workspace
- `profiles.modules text[] default '{toll}'`. "Switch on Live tracking" (free) appends `live`.
- Every `live_*` row has `owner_id` = workspace = owner's user id today. Teams later: add
  `live_members(owner_id, user_id, role owner|manager|dispatcher)` and change `liveWorkspaceFor()` in
  `src/lib/live/server.ts` (the only place that maps a user to a workspace). No table changes needed.

## Data (migration 0079, additive, service-role only)
`live_places` (factory/warehouse/branch/customer/other, lat/lng, geofence radius) ·
`live_vehicles` (number, own/market, transporter) · `live_drivers` (name, +91 mobile, consent) ·
`live_trips` (T-0001 per account via trigger; route, vehicle, driver, material/qty/weight, invoice, e-way bill + validity,
LR, freight, planned/promised times, status planned→loading→in_transit→arrived→delivered/cancelled, driver token,
customer track token, cached last position/ETA) · `live_trip_events` (timeline + notification dedupe key) ·
`live_locations` (points per trip, 30-day retention via `purge_live_locations()`).

## Routes
`/apps` · `/live` (-> Trips, 0082) · `/live/trips` (+ filters/search) · `/live/trips/new` · `/live/trips/[id]` · `/live/trips/[id]/edit` ·
`/live/places` · `/live/fleet` · public `/d/[token]` (driver) · public `/track/[token]` (customer) ·
`POST /api/driver/[token]/location` · `POST /api/driver/[token]/status`.

## Automation (rule-based; `src/lib/live/automation.ts`)
Runs after each driver report (`after()`), plus time rules on the cron tick (`runLiveSweep()` in `/api/cron/track`).
- Truck inside origin geofence → `loading`; leaves it (radius+200 m) after being inside → `in_transit`.
- Inside destination geofence → `arrived`.
- Distance left = haversine × 1.25; ETA from recent path speed (clamped 25–55 km/h, fallback 40).
- Stoppage: within 300 m for 30+ min, not at any saved place.
- Likely late: ETA > promised + 30 min.
- E-way bill: < 6 h left, or expired, while loading/in transit.
- No signal: in transit, sharing on, nothing for 30+ min.
Each produces one `live_trip_events` row (unique `(trip_id, dedupe_key)`); only a new row notifies.
Notifications: app push (`sendPushToUser`) + Telegram if set. Never WhatsApp (paid).
Driver-made and automatic in-transit/arrived/delivered also notify; owner's own clicks do not.

## AI (optional, free tier; `src/lib/live-ai.ts`)
Paste-to-fill (e-way bill/invoice/LR text → form; regex fallback), dashboard "Today in short"
(`summarizeOperations` ?? rule summary, cached 10 min), "why late" note on a delayed trip (`explainDelay` ?? rule text).
Everything else is rules.

## Sharing (no API cost)
Driver link and customer link go out through `wa.me` on the owner's own WhatsApp. Driver link stops on revoke,
delivery or cancel. Customer page never shows driver number, invoice value, freight or e-way bill.

## Compat with 0078 links
0079 copies each open `truck_drivers` link into a trip **with the same token** (+ vehicle, driver, last 7 days of points)
and switches Live on for those accounts. `/d/<token>` and its report API look up `live_trips` first and fall back to
the 0078 code path for any token not found (or if 0079 is not applied yet). 0078 tables are untouched.

## 0081 - driver-first (25 Nov 2026)

Tracking follows the **driver's phone**. The driver owns the link (`live_drivers.share_token`, `/d/<token>`); a trip is optional.

- **Driver kinds**: `own` (shares until he taps Stop, no expiry) and `one_time` (dealer/supplier; `share_expires_at` = trip delivered/cancelled + `live_profiles.one_time_expire_hours`, default 1 h; sweep marks `expired`, `/d` answers 410).
- **Masters**: drivers, trucks (`owner_type` own/dealer/supplier/transporter), warehouses & places. Soft delete (`archived_at`); history stays.
- **Truck assignment**: `live_assignments`, one open row per driver and per truck (unique partial indexes). Moving a held truck needs an explicit "move it" tick; logged on both drivers and the trip.
- **Trips**: `trip_seq` + `trip_name` fixed (DB trigger). `purpose` + from or to required when trip details are on. Edit rules in `shared.ts` (`TRIP_FIELDS_DYNAMIC` after start; everything before start; nothing when closed). One open trip per driver (server + unique index).
- **Activity**: `live_trip_events` now carries `driver_id`, `vehicle_id`, `field`, `old_value`, `new_value`, `actor_user_id`; `trip_id` may be null (driver-only rows: sharing, gaps, truck changes).
- **Positions**: `live_locations.driver_id` (+ `trip_id` when on a trip). Driver row caches last position.
- **Token resolution** (`src/lib/live/driver.ts`): driver token -> old trip token -> its driver -> 0079 trip-only -> 0078 truck link.
- **Pages**: `/live` Drivers (Live / Last seen / Idle), `/live/new` one-screen create (driver required; Truck and Trip toggles), `/live/drivers/[id]`, `/live/trips` (+ `/live/today` summary), `/live/masters` (+ drivers, trucks, `/live/places`), `/live/profile`.

## 0082 - trips-first (25 Nov 2026)

Everything is managed through **trips**. No "Track a driver" screen, no floating button.

- **Direction** (`live_trips.direction`, default `outgoing`; old trips = outgoing):
  - **Sending** (outgoing): driver + truck picked from Masters. From = our warehouse (default warehouse preselected), To = saved customer place, or name + exact location (address search, map pick, Google Maps link, or GPS) + address; `party_type` customer/dealer/internal/other.
  - **Receiving** (incoming): supplier does not use the app. Driver name + mobile, truck number and supplier name/place/location are typed on the trip (`driver_name/driver_phone/vehicle_no`, `party_name`, `from_name/from_address/from_lat/from_lng`); To = our warehouse. The driver row is kind `one_time` (shown as "Trip-only"), hidden from masters, link expires after the trip. The typed origin is used as a 500 m geofence by automation. If the supplier uses Rahdari he can send his own `/track/<token>` link instead.
- **Create** = `/live/trips/new`: direction + trip name (required; T-number auto, both fixed). Then `/live/trips/[id]/edit?setup=1`: Driver (required to start tracking), Truck (toggle), Trip details (toggle; inside required: purpose, From, To; times with a rules ETA estimate = straight line x 1.25 at 40 km/h; "More details" = goods, documents, contact, notes; AI paste-to-fill).
- **Masters** = the only place to add/edit/archive own drivers (kind `own` only), trucks, warehouses. "Add new" beside a picker goes to the master with `?add=1&return=<path>`; on save it redirects back with `picked_driver|picked_vehicle|picked_place=<id>` (return paths limited to `/live/...`, `safeReturn()` in server.ts).
- **Nav**: Trips (home; `/live` redirects) · New trip · Masters · Profile (`/portal/profile`, the common profile). Live business settings moved to `/portal/profile/live` (section "Live tracking" on the profile only when the account has the module). `/live/profile` and `/live/new` redirect.
- **Map picker**: `src/app/live/MapPicker.tsx`, plain OSM tiles (img-src `tile.openstreetmap.org` added to the report-only CSP).
- **Before 0082 is applied**: sending trips work (new columns are stripped by `strip82()`), receiving trips are refused with a clear message, direction filter is ignored.

## 0083 - v4 (25 Nov 2026)

Full plan: `docs/LIVE-PLAN-v4.md`. In short:
- **States** Planned / Active / Done / Cancelled over the six stored statuses (`STATE_OF` in shared.ts; generated `live_trips.phase`). New trips are Planned; **Start** makes them Active. Any state change is allowed and logged.
- **Assignment only inside trips**: no driver-truck assignment anywhere else (`live_assignments` no longer read or written). One **Active** trip per driver (Planned trips can queue); the link reports into the Active trip, else the oldest Planned.
- **Trip form** (`src/app/live/trips/TripForm.tsx`) for create and edit: driver Masters | Custom (temporary), truck Masters | Custom | None, From/To Warehouse | Custom location. Active trips: driver/truck/destination changes need a **reason** (`live_trip_events.reason`).
- **Temporary drivers**: kind `one_time`, one per trip, link ends 1 h after Done/Cancelled (reopen within the hour keeps it), then the sweep deletes the row; the trip keeps name + mobile.
- **Masters**: custom fields (`custom_fields` jsonb), archive and hard delete (BEFORE DELETE triggers copy names onto trips).
- **Activity**: per trip, sectioned by `phase`; Profile > Live tracking > Activity (`/portal/profile/live/activity`, `src/lib/live/activity.ts`): trips, drivers per day, trucks per trip, warehouses per day.
- **Road ahead**: `routeWaypoints()` (AI) / `routeWaypointsBasic()` (hub list) in live-ai.ts, cached on the trip (`src/lib/live/route.ts`), refreshed after 25 km.
- **Nav**: Home · Masters · Profile; one "+" New trip on Home.

## 0084 - v5 (25 Nov 2026)

Full plan: `docs/LIVE-PLAN-v5.md`. Status control (chip + Change), planned vs actual/live times, one `DriverLinkActions`, compact masters with sheets,
`/live/history` + `/live/activity` (filters in the URL), Live profile at `/live/profile` (settings, alerts), richer `/track/<token>`, app-only alerts
(`alert_logs` kind `live_*` + push; defaults in `live_profiles.alert_settings`, per trip `live_trips.alert_overrides`).
