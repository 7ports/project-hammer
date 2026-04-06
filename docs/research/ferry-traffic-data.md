# Research: Toronto Ferry Traffic / Busyness Data

**Researched:** 2026-04-06
**Researcher:** Claude Code (deep research specialist)
**Purpose:** Determine what data sources exist to power a "busyness" or "traffic" indicator on dock popups in ferries.yyz.live

---

## Summary

A real, official, near-real-time data source exists: the City of Toronto publishes **Toronto Island Ferry Ticket Counts** via their Open Data CKAN API, updated hourly in 15-minute intervals. The dataset is active, covers data back to May 2015, was last refreshed on 2026-04-06, and is freely accessible with no authentication required. The data captures total ticket redemptions and sales aggregated across all three routes (Centre Island, Hanlan's Point, Ward's Island) — it does not break down by route or direction. No other official real-time source (Toronto Port Authority, Ontario 511, City 311, Parks) publishes vessel load, queue length, or island crowd levels. The recommendation is to use the ticket-counts API as a live busyness signal, augmented with time-of-day/day-of-week heuristics derived from the same historical dataset.

---

## Findings

### Toronto Open Data

**Dataset: Toronto Island Ferry Ticket Counts**

This is the single most valuable official data source found.

- **Portal URL:** https://open.toronto.ca/dataset/toronto-island-ferry-ticket-counts/
- **CKAN package ID:** `toronto-island-ferry-ticket-counts`
- **Package metadata API:** `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=toronto-island-ferry-ticket-counts`
- **Dataset ID (package UUID):** `000ec8ae-1231-49ca-b6f8-6eb35b74a7ee`
- **Datastore resource ID:** `0da005de-270d-49d1-b45b-32e2e777a381`
- **Datastore query API:** `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?resource_id=0da005de-270d-49d1-b45b-32e2e777a381`
- **Direct CSV download:** `https://ckan0.cf.opendata.inter.prod-toronto.ca/datastore/dump/0da005de-270d-49d1-b45b-32e2e777a381`
- **Status:** Active (`is_retired: false`, `state: active`)
- **Last refreshed:** 2026-04-06T04:18:08 UTC
- **Contact:** FleetBI@toronto.ca / FerryServices@toronto.ca
- **Licence:** Open Government Licence — Toronto (free to use, attribution required)

**What the data contains:**

| Field | Type | Description |
|---|---|---|
| `_id` | int | Auto-increment record ID |
| `Timestamp` | timestamp | End time of each 15-minute interval (ISO 8601) |
| `Redemption Count` | int | Tickets redeemed (i.e., passengers who boarded) in the interval |
| `Sales Count` | int | Tickets sold (online + POS kiosk) in the interval |

**Sample records (most recent as of 2026-04-05):**

| Timestamp | Redemption Count | Sales Count |
|---|---|---|
| 2026-04-05T23:30:00 | 7 | 7 |
| 2026-04-05T23:15:00 | 1 | 1 |
| 2026-04-05T21:30:00 | 21 | 9 |
| 2026-04-05T21:15:00 | 17 | 13 |

**Key characteristics:**
- **Temporal coverage:** May 1, 2015 to present (268,195+ records, growing continuously)
- **Update frequency:** Hourly refresh, data in 15-minute intervals
- **Freshness lag:** Approximately 4–12 hours behind real time (most recent record is from last night at 23:30 when checked at ~04:18 UTC the next day)
- **Aggregation:** All three routes (Centre Island, Hanlan's Point, Ward's Island) combined — no per-route breakdown
- **Includes:** Both inbound and outbound passengers; both online and POS-kiosk ticket types
- **Does NOT include:** Route-level breakdown, vessel identity, direction of travel, queue length, wait time, or island headcount

**API usage example (fetch last 4 records sorted by recency):**
```
GET https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search
  ?resource_id=0da005de-270d-49d1-b45b-32e2e777a381
  &limit=4
  &sort=Timestamp+desc
```

No API key is required. The response is JSON and follows the standard CKAN Datastore API.

**Portal page note:** The open.toronto.ca portal UI renders the dataset as "Retired" due to a stale portal cache or a pending change request, but the underlying CKAN API confirms `is_retired: false` and `state: active`, with today's refresh timestamp. The CKAN API is authoritative.

**Other Toronto Open Data ferry datasets:** No other ferry-related datasets were found on open.toronto.ca. Searches for "ferry", "ridership", "passenger", and "occupancy" returned only TTC transit datasets unrelated to island ferry services.

---

### Toronto Port Authority

The Toronto Port Authority (PortsToronto, torontoport.com / torontoportauthority.com) does **not** operate the Toronto Island Ferry. The ferry is operated by the City of Toronto's Fleet Services division (previously Parks, Forestry & Recreation). PortsToronto manages Billy Bishop Toronto City Airport, Port of Toronto cargo/cruise operations, and the Outer Harbour Marina.

- **Developer API:** None found. No open data portal, no developer resources.
- **Live data:** None. The website publishes news, community notices, and general facility information only.
- **Ferry-relevant data:** PortsToronto does publish community notices about ferry service disruptions at Billy Bishop Airport's pedestrian tunnel ferry (a separate, small airport shuttle vessel), but this is not a public API.

---

### Other Official Sources

**City of Toronto — Parks / Ferry Info Page (toronto.ca)**
- URL: https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/toronto-island-park/
- Contains: Static guidance about busy hours ("busiest on weekends and holidays, 10 a.m.–2 p.m."), wait time estimates, and a live service alert widget showing open/closed/alert status.
- The alert widget is a live status indicator (service up vs. down), not a queue or capacity feed. No documented public API for it.
- No crowd capacity data, no queue data.

**Ontario 511 Developer API (511on.ca)**
- URL: https://511on.ca/developers/doc
- Has a `Ferries` endpoint: "Returns all ferry terminals."
- This covers Ministry of Transportation Ontario ferry routes (e.g., Wolfe Island, Glenora-Adolphustown), NOT the Toronto Island ferry which is a municipal service. Confirmed irrelevant.

**Government of Ontario Open Data — Ferry Services**
- URL: https://data.ontario.ca/dataset/ferry-services
- Static KML dataset of MTO ferry terminal locations, last validated 2012. Not relevant, not real-time.

**City of Toronto 311 / Open311 API**
- Toronto's 311 service has an Open311 API for service requests, but it does not expose island capacity, crowd levels, or ferry queue data. No relevant dataset found.

**GTFS Transit Feeds**
- Toronto Island Ferry does not have its own published GTFS feed. The TTC GTFS feeds cover surface bus/subway. The ferry is not a TTC service (it is a Parks/Fleet Services operation) and no GTFS schedule data was found for the island ferry in Transitland, MobilityDB, or the transitland-atlas repository.

**Webcams**
- No dedicated public webcam API for the Jack Layton Ferry Terminal was found. General Toronto harbourfront webcams exist (webcamtaxi.com) but do not expose machine-readable crowd data or an embed API.

---

### Unofficial / Proxy Signals

In the absence of per-route or queue-level data, the following proxy signals can be layered to build a meaningful busyness indicator:

**1. Live Redemption Count from the Ticket Counts API (BEST SIGNAL)**
The `Redemption Count` field in the official dataset directly measures passengers who have boarded in a 15-minute window. With a ~4–12 hour lag, this is not truly live, but the historical patterns are rich enough to power a robust heuristic. The 11-year dataset (2015–present, 268k records) supports statistical normalization to compute "how does today compare to a typical day at this time."

**2. Time-of-Day and Day-of-Week Pattern (DERIVED FROM DATASET)**
From official guidance and media reports:
- Outbound peak: 10 a.m.–2 p.m. (heaviest 11:30 a.m.–2:30 p.m.)
- Return peak: 5:30 p.m.–9 p.m.
- Weekend ridership significantly higher than weekday
- Summer (June–early September) is peak season; ~18,000 passengers/day on busy summer days vs. ~500/day in winter
- Long weekends (Victoria Day, Canada Day, Labour Day) are the absolute busiest days with 2–3 hour waits reported

**3. Schedule Density (DERIVED FROM PUBLISHED SCHEDULE)**
The city's published schedule (https://www.toronto.ca/...all-ferry-schedules/) encodes demand assumptions: summer sees departures every 15–30 minutes to Centre Island; winter is Ward's Island only on 45+ minute intervals. Counting scheduled departures per hour (denser = city expects more demand) is a useful proxy.

**4. Weather (ECCC GeoMet-OGC-API)**
Warm, sunny days drive massive ferry demand; rain dramatically suppresses it. Environment Canada's GeoMet API (https://api.weather.gc.ca/) provides free, no-auth-required weather data including current conditions and 7-day hourly forecasts for Toronto Island (coords: 43.627,-79.394). This is already used in the app for the WeatherStrip component and can be cross-referenced with busyness.

**5. Season**
May–September accounts for the vast majority of ridership. The dataset shows near-zero redemptions in winter months outside of Ward's Island resident commuter traffic.

**6. Transit App Crowding Data (NOT PUBLIC)**
The Transit app (transitapp.com) claims to provide real-time crowding predictions for Toronto Island Ferry. Their crowding data is proprietary and sourced from a combination of agency feeds and crowdsourced user contributions. There is no public API for this data. Their partner/API program (transitapp.com/partners/apis) is aimed at transit agencies, not third-party developers.

**7. Social Media / Community Sources**
- @FerryFinder on X: a third-party account that publishes ferry schedule info but not real-time crowd data.
- City of Toronto and PortsToronto post service disruption alerts on X but not queue or crowd metrics.
- No machine-readable social media API source was found that reliably surfaces crowd data.

---

## Recommendation

**Use the Toronto Open Data Ticket Counts API as the primary data source, augmented by a time-of-day/day-of-week heuristic.**

Proposed two-tier approach:

**Tier 1 — Live signal (hourly cadence):**
Poll the CKAN datastore API once per hour in the app's backend. Fetch the most recent 4–8 records (last 1–2 hours of 15-minute intervals). Sum `Redemption Count` over the most recent complete hour. Compare against the historical median for that same hour-of-day + day-of-week combination (computable from the same dataset's 11 years of history). Express as a ratio: `live_hour / historical_median_for_this_slot`.

- Ratio < 0.5 → "Quiet" (green dot)
- Ratio 0.5–1.2 → "Moderate" (yellow dot)
- Ratio > 1.2 → "Busy" (red dot)
- No recent data → fall back to Tier 2

**Tier 2 — Heuristic fallback:**
When the API data is stale or unavailable, use a deterministic heuristic:

```typescript
function estimateBusyness(now: Date): 'quiet' | 'moderate' | 'busy' {
  const month = now.getMonth(); // 0-indexed
  const hour = now.getHours();
  const dow = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = dow === 0 || dow === 6;
  const isSummer = month >= 5 && month <= 8; // June–September
  const isPeak = hour >= 10 && hour <= 14;
  const isReturnPeak = hour >= 17 && hour <= 21;

  if (!isSummer && !isWeekend) return 'quiet';
  if (isSummer && (isPeak || isReturnPeak) && isWeekend) return 'busy';
  if (isSummer && (isPeak || isReturnPeak)) return 'moderate';
  if (isSummer) return 'moderate';
  return 'quiet';
}
```

**Implementation notes:**
- The API requires no authentication. Rate limit is generous (public CKAN endpoint).
- Backend should cache the response and serve it to the frontend — avoid hitting CKAN from the browser directly.
- The ticket counts are cross-terminal aggregates, so there is no way to distinguish Centre Island vs. Ward's Island busyness from this data.
- The ~4–12 hour lag means "live" counts actually reflect yesterday evening's traffic. The primary value is for pattern-matching against historical norms, not true real-time queue sensing.
- For a future enhancement: if the city integrates PRESTO tapping (currently being explored), tap-on/tap-off data may eventually be available with lower latency.

---

## Gaps / Uncertainties

1. **True real-time lag:** The data's most recent timestamp is from the previous evening, not the current moment. The "updated hourly" description may mean the bulk CSV is regenerated hourly, not that the CKAN datastore is appended within minutes of each transaction. The actual latency between a passenger tapping and the count appearing in the API is unconfirmed but appears to be several hours.

2. **No per-route breakdown:** The dataset aggregates all three routes. There is no way to know from this data whether 100 redemptions went to Centre Island vs. Ward's Island. The dock popup for each destination cannot be differentiated.

3. **No queue or wait-time data:** Redemptions measure passengers who have boarded, not passengers waiting in queue. A high redemption rate suggests high throughput, not necessarily long queues (which depend on vessel capacity and frequency).

4. **Transit app crowding source:** The Transit app claims to have crowding data. The exact upstream source of that data is unclear — it may be based on the same ticket counts dataset, on crowdsourced input from app users, or on a private data-sharing agreement with the City. It is not accessible via a public API.

5. **Portal UI vs. API discrepancy:** The open.toronto.ca portal shows this dataset as "Retired" (with a note "a request for changes has been received"). The CKAN API returns `is_retired: false`. This is probably a UI metadata bug or a pending review that has not yet been actioned. The dataset is functionally active. Monitor for changes.

6. **No island headcount data:** There is no public dataset tracking how many people are currently on the Toronto Islands at any given time. The city has no publicly documented IoT/sensor system for this.

7. **Ontario 511 ferry endpoint:** The 511on.ca API has a Ferries endpoint, but it covers MTO provincial ferry routes only, not the Toronto Island municipal ferry. Not confirmed by inspecting the actual endpoint response.

---

## Sources

- [City of Toronto Open Data Portal](https://open.toronto.ca/)
- [Toronto Island Ferry Ticket Counts — Open Data Portal page](https://open.toronto.ca/dataset/toronto-island-ferry-ticket-counts/)
- [Toronto Island Ferry Ticket Counts — CKAN API (package metadata)](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=toronto-island-ferry-ticket-counts)
- [Toronto Island Ferry Ticket Counts — CKAN Datastore API](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?resource_id=0da005de-270d-49d1-b45b-32e2e777a381&limit=5&sort=Timestamp+desc)
- [Toronto Island Ferry Ticket Counts — Lunaris catalog entry](https://www.lunaris.ca/catalog/4639eeae-d6c3-54d4-8f93-79ea5c671e0b)
- [Toronto Port Authority website](https://www.torontoportauthority.com/)
- [Ontario Open Data — Ferry Services (MTO, static/outdated)](https://data.ontario.ca/dataset/ferry-services)
- [Ontario 511 Developer API](https://511on.ca/developers/doc)
- [City of Toronto — Toronto Island Park page (ferry service alert widget)](https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/toronto-island-park/)
- [City of Toronto — All Ferry Schedules](https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/toronto-island-park/all-ferry-schedules/)
- [Toronto Island ferries — Wikipedia (fleet, ridership, history)](https://en.wikipedia.org/wiki/Toronto_Island_ferries)
- [Transit app — Toronto Island Ferry page](https://transitapp.com/en/region/toronto/toronto-island-ferry)
- [Transitland Atlas — toronto.ca DMFR feeds (no ferry GTFS found)](https://github.com/transitland/transitland-atlas/blob/main/feeds/toronto.ca.dmfr.json)
- [Environment Canada GeoMet-OGC-API](https://api.weather.gc.ca/)
- [Environment Canada — Toronto Island hourly forecast](https://weather.gc.ca/en/forecast/hourly/index.html?coords=43.627,-79.394)
- [CBC News — Ferry capacity article](https://www.cbc.ca/news/canada/toronto/toronto-island-ferry-1.3645377)
- [CBC News — Tips to beat ferry lineups](https://cbc.ca/amp/1.3690901)
- [BlogTO — Crowds and wait times](https://www.blogto.com/city/2023/07/crowds-waits-toronto-islands-brutal-weekend/)
- [Global News — Long wait times with ferries out of service](https://globalnews.ca/news/10568895/toronto-island-ferries-wait-times/)
- [NOW Toronto — PRESTO integration exploration](https://nowtoronto.com/news/why-cant-we-just-tap-into-the-ferry-torontonians-call-for-presto-access-on-ferries-city-is-exploring-options/)
- [BlogTO — By the numbers: Toronto Island ferries](https://www.blogto.com/city/2013/06/by_the_numbers_toronto_island_ferries/)
- [ScienceDirect — Ferry delay prediction using open data & ML](https://www.sciencedirect.com/science/article/pii/S1077291X25000098)
- [Daily Hive — New ferry vessels 2024](https://dailyhive.com/toronto/toronto-new-ferry-2024)
- [FerryFinder X account (@FerryFinder)](https://x.com/ferryfinder)
- [Toronto Island Ferry unofficial schedule website](https://torontoislandferry.ca/)
- [PortsToronto Community Notices](https://www.portstoronto.com/media-room/community-notices/)
