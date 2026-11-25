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
`/apps` · `/live` (Today) · `/live/trips` (+ filters/search) · `/live/trips/new` · `/live/trips/[id]` · `/live/trips/[id]/edit` ·
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
