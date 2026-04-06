# Toronto Island Ferry — Live Service Status Data Sources

Researched: 2026-04-05

## Recommendation (TL;DR)

**Use `https://www.toronto.ca/data/parks/live/ferry.json` proxied through the Express backend.**

This is the only machine-readable, no-auth, live source for ferry service status published by the City of Toronto. It is the same endpoint the City's own website widget uses, polled every 30 seconds. Because it lacks CORS headers, it must be fetched server-side and re-served via `/api/ferry-status`.

---

## Sources Investigated

### 1. `ferry.json` — Primary Source ✅

**URL:** `https://www.toronto.ca/data/parks/live/ferry.json`
**Format:** JSON, no authentication
**Update cadence:** CDN with `Cache-Control: must-revalidate, max-age=0` — re-validates on every request. City's own widget polls every 30 seconds.
**CORS:** None — must be proxied through backend

**Live response shape:**
```json
{
  "assets": [
    {
      "LocationID": 3789,
      "AssetID": 14127,
      "PostedDate": "2026-04-03 20:57:57",
      "AssetName": "JACK LAYTON FERRY TERMINAL",
      "SeasonStart": null,
      "SeasonEnd": null,
      "Reason": "Maintenance/Repair",
      "Comments": "Due to ongoing infrastructure improvements at the Jack Layton Ferry Terminal, vehicle service will be suspended from <b>Thursday, April 2, 2026, through Tuesday, April 7, 2026, inclusive.</b>",
      "Status": 2
    }
  ]
}
```

**Field reference:**

| Field | Type | Meaning |
|---|---|---|
| `LocationID` | integer | `3789` = Jack Layton Ferry Terminal. Filter key. |
| `PostedDate` | string `"YYYY-MM-DD HH:mm:ss"` | Eastern Time — convert via `.replace(' ', 'T') + '-05:00'` |
| `Reason` | string | Short category: `"Maintenance/Repair"`, `"Weather"`, `"Mechanical"`, etc. |
| `Comments` | string (HTML) | Full advisory text — strip `<b>` tags before display |
| `Status` | integer | `0` = Closed, `1` = Open/Normal, `2` = Service alert/disruption |

**Status mapping:**
- `0` → `'closed'`
- `1` → `'open'`
- `2` → `'alert'`
- other → `'unknown'`

---

### 2. Toronto Open Data Portal — Not useful for status

**URL:** `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_search?q=ferry`

Only dataset found: **"Toronto Island Ferry Ticket Counts"** — near-realtime ticket sales data, updated hourly. Contains throughput data only, no operational status. Not suitable for `useServiceStatus`.

---

### 3. City of Toronto Ferry Page — HTML only

**URL:** `https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/toronto-island-park/ferries-to-toronto-island-park/`

Renders a live status widget that consumes `ferry.json` (source 1). No additional data — scraping the HTML is unnecessary when the JSON endpoint is available upstream.

---

### 4. Toronto 311 / `secure.toronto.ca` — No feed

No machine-readable advisory feed found. 311 provides only service request lookup and ferry ticket sales. No JSON endpoint on any `*.toronto.ca` subdomain other than `ferry.json`.

---

### 5. Social Media — Not machine-readable

City of Toronto Parks posts ferry disruption notices to Facebook (`@TorontoPFR`) and historically to Twitter/X (`@TorontoPFR`). Reliable for humans, not suitable for the hook (Twitter API key would be required).

---

### 6. GTFS-RT — Not available for ferry

TTC publishes GTFS-RT at `https://gtfsrt.ttc.ca` for subway/bus/streetcar. The Toronto Island Ferry is operated by Parks, Forestry & Recreation (not TTC) and is not included. No GTFS service alerts feed exists for the ferry.

---

## What Does Not Exist

- Public GTFS-RT service alerts for the ferry
- RSS feed for ferry disruptions
- Official REST API with authentication
- 311 JSON feed for parks advisories
- Machine-readable social media feed without Twitter API credentials
- Open Data portal operational status (ticketing data only)

---

## Implemented Architecture

```
Browser → GET /api/ferry-status
  Express server → GET https://www.toronto.ca/data/parks/live/ferry.json
    Filter: LocationID === 3789
    Normalize: Status code → 'open' | 'alert' | 'closed' | 'unknown'
    Strip HTML from Comments
    Convert PostedDate to ISO 8601 UTC
  Response cached 60s (Cache-Control: public, max-age=60)
  On error: returns { status: 'unknown', source: 'error' } — always HTTP 200
```

Hook polls `/api/ferry-status` every 60 seconds. Seasonal closure logic (Centre Island: before April 15 or after October 15) is computed client-side from `new Date()` — no network call needed.
