# Live v7 — compact, icon-first, research-backed (26 Nov 2026)

What changed from v6, and the numbers behind it. Sources are the fleet-tracking
research done for this release (Samsara, Motive, Geotab, Azuga, Onfleet,
Shipwell, Google Fleet Engine, Android location docs, IIM-A km/day study).

## Sending and Receiving are separate pages

- `/live/sending` and `/live/receiving` (`src/app/live/TripBoard.tsx`). The
  data was already separate (`live_trips.direction`, 0082); v6 drew both lists
  on one page and hid one on phones with a utility class that a stylesheet
  rule overrode, so phones showed both.
- `/live/trips` redirects to the right page and maps the old `o*`/`i*`
  filter params, so old links and bookmarks keep working.
- The switch at the top shows each side's open-trip count; status chips show
  counts per state (`tripCounts()` in `src/lib/live/server.ts`).

## First impression = status + what matters

Trip card (`TripCard`, `src/app/live/parts.tsx`):

1. Trip name (never the T-number; route if unnamed) · issue icons · status chip
2. Truck plate · driver · GPS freshness dot
3. Route (only when the title is the trip's own name) · km left · ETA coloured
4. Thin progress bar while on the road

Everything else is one tap away on the trip page.

## Tones (same on every page) — `src/lib/live/insight.ts`

| Fact | Green | Blue | Amber | Red |
|---|---|---|---|---|
| ETA | on time | (no promise set) | late by ≤ 30 min | late > 30 min, or ETA passed with no new GPS |
| GPS | ≤ 2.5 min ("Live") | ≤ 10 min | 10–30 min | > 30 min ("No GPS") |
| Speed | – | moving | standing ≥ 30 min, or > 80 km/h | – |

- Speed under 4 km/h is "Stopped" (a parked phone's GPS wanders a few km/h).
- No speed is shown once the GPS is more than 30 min old.

## ETA (`etaFrom`, `recentAvgKmph` in `src/lib/live/shared.ts`)

- Distance = straight line × 1.25 (no routing API yet).
- Speed = path length over the last 2 h, ignoring steps shorter than the fixes'
  accuracy (min 40 m) so jitter is not counted as travel; clamped 25–55 km/h;
  40 km/h when there is too little data.
- Halts: after 12 h of driving, each further driving hour adds 1 h of halt
  (≈ 12 h driving per day), in line with the 300–400 km/day Indian average.
  Short and medium trips (< ~540 km at 45 km/h) are unchanged.
- Recomputed on every location report from the driver's phone (~30 s).

## Refresh rates (polling, no websockets — same as the vendors researched)

- Driver phone reports every 30 s (`REPORT_EVERY_MS`), at most every 8 s.
- Owner trip page refreshes every 30 s; lists and Today every 45 s.
- Customer page refreshes every 45 s (was 60 s).
- A browser link pauses when the phone locks; the Android app keeps sharing
  in the background. The driver page says so.

## Pages

- **Trip page**: hero (name as h1, direction tag, status, route bar with the
  truck's position), four tiles (Speed, Km left, ETA, GPS), icon action bar
  (Start, Status, Call, Driver link, Customer link, Navigate, Edit/Repeat),
  map, route timeline, then single-open sections with icons.
- **Customer page** `/track/<token>`: one big status line, route bar, three
  tiles, map, timeline, truck/driver/goods; explanation behind (i).
- **Driver page** `/d/<token>`: Hinglish + short English (no Devanagari),
  status banner, one big Start/Stop button, small stat tiles, help behind (?).
- **Drivers master**: one dense row each (10+ on a phone), call + edit icons,
  archive/delete in a ⋯ menu.
- **Today**: problems first (late, no GPS, standing, e-way), the day's flow,
  four CSS charts (on-time % over 7 days with average lateness and trip time,
  GPS health, today by hour, sending vs receiving), then single-open lists.

## Not done / next

- Road distance from a routing API instead of × 1.25.
- A customer-facing ETA window ("4–6 pm") instead of a single time.
- km driven per day on Today (needs a daily roll-up of positions).
