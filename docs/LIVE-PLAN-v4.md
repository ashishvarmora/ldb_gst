# Live tracking v4 - business logic plan (migration 0083)

Rule of thumb: **masters hold things, trips hold work, activity hangs off trips.**
Nothing about who drove what is ever written into a master row.

## 1. Entities

| Entity | Table | Kept fields (UI) | Custom fields | Delete |
|---|---|---|---|---|
| Driver (master) | `live_drivers` kind `own` | name, mobile | yes (`custom_fields` jsonb) | archive, or hard delete |
| Truck (master) | `live_vehicles` | number, owner (own / hired), transporter (hired only) | yes | archive, or hard delete |
| Warehouse (master) | `live_places` kinds factory / warehouse / branch | name, type, address, exact location, geofence radius | yes | archive, or hard delete |
| Trip | `live_trips` | direction, name, driver, truck, from, to, goods/docs (optional) | - | archive (hidden), or hard delete when not Active |
| Temporary driver | `live_drivers` kind `one_time`, `inline_driver` on the trip | name, mobile, typed on the trip | - | destroyed by the sweep 1 h after the trip ends |
| Temporary truck | `live_trips.vehicle_no`, `vehicle_id` null, `temp_truck` | number, typed on the trip | - | lives on the trip only |
| Custom place | `live_trips.from_*` / `to_*` (name, address, lat/lng, `*_maps_url`) | typed on the trip | - | lives on the trip only, never saved as a master |
| Activity | `live_trip_events` (+ `phase`, `reason`) | - | - | goes with its trip |
| Positions | `live_locations` (driver + trip) | - | - | 30-day retention |

Old customer places (kind customer/other) stay readable and pickable as "Other saved places". Nothing new is saved as one.
`live_assignments` (driver <-> truck) is no longer read or written. The table stays for history.

**Hard delete.** A master can be deleted for good, from the app or straight from the database. A `BEFORE DELETE` trigger (0083) first copies
the name, number, mobile, place and location onto every trip that used it. Then the existing `on delete set null` FKs clear the link.
Old trips stay readable. A master on an **Active** trip cannot be deleted or archived from the app. Change the trip first.

## 2. Trip status

User-facing state, derived from the internal `status` column, which is unchanged so existing links and rules keep working:

| State | Internal statuses | Set by |
|---|---|---|
| **Planned** | planned, loading | every new trip; "Back to planned" |
| **Active** | in_transit, arrived | **Start** button (owner), the driver's Started button, or auto when the truck leaves the From geofence |
| **Done** | delivered | owner, the driver's Delivered button |
| **Cancelled** | cancelled | owner |

The owner can change the state at any time, in any direction, from the state segmented control on the trip page. Each change is logged with an optional note.
Reopening checks that the driver and truck are not on another Active trip. "Arrived" stays as an Active sub-step (driver taps Reached, or the destination geofence).
The origin geofence no longer moves a trip. It only logs "At loading point". `phase` (0083) is a generated column with the same mapping, for SQL use.

## 3. Where things are shown, added, changed and deleted

| Thing | Shown | Added | Changed | Deleted / archived |
|---|---|---|---|---|
| Driver master | Masters > Drivers (list + page with link, live status) | Masters > Drivers (+), or "+ New" beside a trip picker | driver page | driver page: Archive / Delete (confirm) |
| Truck master | Masters > Trucks | same pattern | Masters > Trucks (edit) | Archive / Delete (confirm) |
| Warehouse | Masters > Warehouses | same pattern | Masters > Warehouses (edit) | Archive / Delete (confirm) |
| Trip | Home (Sending / Receiving) | header "+" (one entry point) -> `/live/trips/new` | Planned: edit page, everything. Active: edit page, only driver / truck / destination (reason required) + arrival, e-way bill, contact, notes. Done / Cancelled: locked (reopen first) | trip page: Archive (any) / Delete (not Active) (confirm) |
| Assignment (driver, truck, from, to) | trip page | **only inside a trip** (create / edit) | Active: reason required | - |
| Trip activity | trip page, sectioned Planned / Active / Done | automatic | - | with the trip |
| Driver / truck / warehouse / trip activity | Profile > Live tracking > **Activity** | derived | - | - |

The driver page has **no** truck assignment. Its tracking link is made when the driver is created and reused on every trip.

## 4. Trip creation and edit (one form, `TripForm`)

1. **Direction**: Sending / Receiving (segmented).
2. **Trip name** (required; T-number auto; both fixed).
3. **Driver**: Masters | Custom (segmented). Masters = select (shows "on T-0007" when Active elsewhere, which is then blocked). Custom = name + mobile -> temporary driver with its own link.
4. **Truck**: Masters | Custom | None (segmented). Custom = number only.
5. **From** and **To**: Warehouse | Custom location (segmented). Custom = name, optional address, then one of: Google Maps link (short links kept as a link) or **pick on map**. Defaults: Sending -> From = default warehouse; Receiving -> To = default warehouse.
6. **More** (accordion, closed): purpose, goods, documents (invoice, e-way bill and validity, LR), times (planned start, expected arrival with a rules estimate), contact, notes, AI paste-to-fill.

Created as **Planned**. Its page shows **Start** and the driver link (WhatsApp / copy).

**Active changes** (driver, truck, destination) need a **reason**. The server refuses without one. Each is logged as an event with field, old -> new and reason.
- Driver change: the trip points at the new driver. His link is the live one now (callout to send it). The old driver's positions no longer go to this trip. An old **temporary** driver's link stops at once (`expired`).
- Truck change: the truck must not be on another Active trip.

**One Active trip per driver** (was: one open trip). A driver can have Planned trips queued. His link reports into his Active trip, else his oldest Planned one.

## 5. Driver links

| | Master driver | Temporary driver |
|---|---|---|
| Link made | when the driver is created (`share_token`) | when the trip is saved with a custom driver |
| Reused | on every trip he is assigned | never (one per trip) |
| Ends | when he taps Stop, or you switch it off | trip Done/Cancelled + 1 h (`one_time_expire_hours`, default 1). Reopening within the hour cancels it. After expiry the sweep **deletes** the row; the trip keeps name and mobile. |

Existing `/d/<token>` links keep resolving: driver token -> old trip token -> 0079 trip -> 0078 truck link (unchanged).

## 6. Activity model

**Stored once, per trip.** `live_trip_events` rows with `trip_id`, `driver_id`, `vehicle_id`, `kind`, `field/old/new`, **`reason`** and **`phase`**
(planned / active / done / cancelled at the time of the event; backfilled from the trip's timestamps). Driver-only rows (sharing on/off, no trip) stay as they are.
Master edits are not logged as activity.

**Derived views** (server queries in `src/lib/live/activity.ts`, paginated with "View more" and linked to the trip):

| Area | Grouping | Source |
|---|---|---|
| Trips | one section per trip, events Planned / Active / Done inside | events by trip |
| Drivers | per driver, **per IST day** (a 3-day trip = 3 sections) | events by `driver_id` + day; km/points that day from `live_locations` |
| Warehouses | per warehouse, **per IST day** | events of trips whose From/To is that place, + geofence events |
| Trucks | per truck, **per trip** | trips by `vehicle_id` (+ temporary truck numbers by `vehicle_no`) |

Trip page: activity in three accordions (Planned / Active / Done), newest first inside each. This fixes the "Dharmik" endless list: the driver page no longer
shows a feed. Profile > Activity > Drivers shows his days.

## 7. ETA and the road ahead

- **ETA** = now + distance left / speed. Distance left = straight line x 1.25 (road factor). Speed = average over the last 2 h of points, kept within 25-55 km/h, else 40 km/h.
  An (i) on the trip page lists these factors with their current values.
- **Road ahead** (`routeWaypoints(from, to, current)` in `live-ai.ts`): the major cities on the way from the current position to the destination.
  AI if a key is set (validated: names only, at most 8), else a rule fallback from a built-in list of ~60 Indian highway hubs near the straight line, in order.
  Marked "approximate". Cached on the trip (`route_waypoints`, `route_at`, `route_lat/lng`). Refreshed only when the truck moved > 25 km from the cached point.

## 8. UI rules (mobile first, `/portal` style)

- **Bottom bar: Home · Masters · Profile** (3 tabs). Home = trips. Trips and New trip are no longer tabs. A Trips tab duplicated Home, and a New trip tab sat idle 95% of the time.
  **One compact "+" button** in the Home header (desktop sidebar: "New trip" link). The notch maths is re-set for 3 tabs.
- **Home**: "We are sending" | "We are receiving". Side by side on desktop, two tabs on mobile. Each side: icon row (status, date, search) that opens **one panel at a time**,
  status = Planned / Active / Done / Cancelled / All, date = Today / 7 days / Custom (from-to), search = trip name/no, driver, truck, place, invoice, e-way bill. Sort fixed: newest created first.
- **Accordion everywhere**: `<details name="...">` groups, so opening one closes the others (trip page, forms, profile, activity). (i) buttons explain fields. Small, consistent text and buttons; icons on buttons.

| Field | Control |
|---|---|
| Direction, driver source, truck source, from/to source, owner type, place type | segmented (radio) |
| Trip state | segmented |
| Driver / truck / warehouse from masters | select |
| Notifications on/off, "keep sharing" style switches | toggle |
| Purpose, party type | select (5 options, rarely changed) |
| Status / date filters | chips (radio links) |
| Custom fields | key/value rows + "Add field" |
| Dates | `datetime-local` / `date` |

## 9. Alerts plan (not built in v4)

Free channels only: app push (owner/manager), Telegram (owner group), email (digest), in-app list. WhatsApp only when a paid/approved template exists (`wa.me` manual share stays free).

| Trigger | Owner / manager | Driver | Consignee / dealer | Supplier | Dedupe |
|---|---|---|---|---|---|
| Trip started | push + Telegram (only if not started by owner) | - | email/in-app (if a track link exists) | - (receiving: in-app to owner) | once per trip (`status:active`) |
| Likely late (ETA > promised + 30 min) | push + Telegram | - | email with new ETA (opt-in) | - | per promised time; again only if ETA slips 60+ min more |
| Stoppage 30+ min outside a known place | push | on-page banner | - | - | per stop start (minute) |
| Route deviation (> 15 km off the corridor) | push + Telegram | - | - | - | per 50 km grid cell |
| E-way bill < 6 h / expired | push + Telegram | on-page banner | - | email (receiving trips, they own the bill) | per validity time, per level |
| Arrival (destination geofence) | push | - | email/in-app "arriving" | in-app | once per trip |
| Done | in-app (push only if done by driver/auto) | - | email "delivered" | email (receiving) | once per trip |
| No signal 30+ min | push + Telegram | on-page "reconnect" | - | - | per last-seen minute; max 1 per 2 h |
| Driver changed | in-app | new driver: link via `wa.me` (manual); old driver: page says ended | - | - | per change event |

Quiet hours 22:00-06:00 IST: only expired e-way bills and no signal on an Active trip go out. Others wait for the morning digest.

## 10. Migration 0083 (additive)

`custom_fields jsonb` on drivers/trucks/places; trips: `temp_truck`, `from_maps_url`, `to_maps_url`, `archived_at`, route cache, generated `phase`;
events: `reason`, `phase` (backfilled); masters phone unique index limited to own drivers (temporary drivers may share a mobile);
one-open-trip index relaxed to one **Active** trip per driver; `BEFORE DELETE` snapshot triggers on places, drivers and trucks.
Old status values are untouched and mapped in code. All existing tokens, trips, positions and events stay as they are.
