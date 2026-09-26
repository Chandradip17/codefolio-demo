# Unstop listings integration

Codefolio can show hackathons, competitions, workshops, webinars and conferences
listed on Unstop next to its own events. Listings are **discovery only**: every
listing links to Unstop and registration happens there.

## 1. Data source: what exists (verified September 2026)

- **Unstop does not publish a public developer API, documentation, RSS or data feed.**
  `unstop.com/developers`, `/api-docs`, `/rss` and `/feed` all return the generic
  single-page-app shell (the same page as a made-up URL).
- `unstop.com/robots.txt` has `Disallow: /api/*` for general crawlers, so the
  endpoints Unstop's own website calls must not be used by automated clients.
- The "Unstop APIs" that show up in searches are third-party scrapers (Apify,
  Parse.bot). They are not official and are not used here.

So **Codefolio never calls unstop.com itself**. The integration is built up to a
clean boundary: a *feed* that you connect once you have authorized access —
official API access from Unstop (for example through their partnerships team) or a
licensed data partner.

## 2. How it works

```
Browser ── /api/unstop/events ──► Codefolio API ──► catalog cache ──► UnstopProvider ──► authorized feed (UNSTOP_FEED_URL)
                                        │                 ▲
                                        └── Supabase external_events (durable copy + dedup)
```

- `server/src/lib/external/unstopProvider.js` — fetches the feed (timeout, 3 attempts
  with backoff on network/5xx, no retry on 4xx, **429 honoured via Retry-After**,
  same-host pagination up to 10 pages). Modes: `off` | `feed` | `mock`.
- `server/src/lib/external/normalize.js` — validates and normalizes each record into
  Codefolio's external-event shape; invalid records are skipped and logged.
- `server/src/lib/external/catalog.js` — cache, stale fallback, sync, search/filter/sort/pagination.
- `server/src/lib/external/store.js` — Supabase persistence (`external_events`, `external_sources`).
- `server/src/routes/unstop.js` — HTTP API.
- Frontend: listings join the existing Events page as the **Live · Unstop** source
  (`services/liveApi.js → unstopToEvent`, `DataContext`), using the existing cards,
  filters, search and event modal (with **Register on Unstop** + **Source: Unstop**).
  When the provider is off, the UI is unchanged (no Unstop filter option, no tab).
- Admin: **Admin → External events** (platform admins) shows connection, cache,
  last sync, counts, last error, and a **Refresh now** button.

## 3. Feed contract (what an authorized feed must return)

`GET UNSTOP_FEED_URL` with `Authorization: Bearer UNSTOP_API_KEY` (if set) returns JSON:

```json
{
  "events": [
    {
      "id": "123456",
      "title": "AI for Good Hackathon",
      "url": "https://unstop.com/hackathons/ai-for-good-hackathon-123456",
      "registrationUrl": "https://unstop.com/hackathons/ai-for-good-hackathon-123456",
      "type": "hackathon",
      "organizer": "IIT Example",
      "description": "Plain text or simple HTML",
      "logo": "https://…", "banner": "https://…",
      "mode": "online",
      "location": "Bengaluru, Karnataka",
      "startAt": "2026-10-10T04:30:00Z", "endAt": "2026-10-11T12:30:00Z",
      "registrationDeadline": "2026-10-05T18:29:00Z",
      "prize": "₹1,00,000", "eligibility": "Undergraduate students",
      "skills": ["Python"], "tags": ["AI"]
    }
  ],
  "next": "https://same-host/…?page=2"
}
```

- Required: `title`, `url` (https, on `UNSTOP_ALLOWED_HOSTS`, default `unstop.com` — this
  guarantees attribution links point to Unstop). Everything else is optional; missing
  fields are simply not shown.
- A bare array, or `items` / `data` instead of `events`, is also accepted.
- `type`: hackathon, competition, workshop, webinar, conference, quiz (common aliases
  are mapped; anything else becomes "other"). `mode`: online, offline/in-person, hybrid.
- Dates: ISO 8601 or epoch seconds/milliseconds.
- snake_case keys (`start_at`, `registration_deadline`, …) are accepted too.

## 4. Environment variables (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `UNSTOP_PROVIDER` | `off` | `off` · `feed` · `mock` (local only; refused when `NODE_ENV=production`) |
| `UNSTOP_FEED_URL` | — | Authorized feed endpoint (required for `feed`) |
| `UNSTOP_API_KEY` | — | Sent as `Authorization: Bearer …`; never logged or sent to browsers |
| `UNSTOP_ALLOWED_HOSTS` | `unstop.com` | Hosts allowed for listing links |
| `UNSTOP_CACHE_TTL_SECONDS` | `900` | Cache freshness (min 60) |
| `UNSTOP_TIMEOUT_MS` | `15000` | Per request |
| `UNSTOP_SYNC_INTERVAL_MINUTES` | `0` | `0` = refresh lazily on request; e.g. `30` = also sync on a timer |
| `UNSTOP_MAX_EVENTS` | `500` | Listings kept per sync |
| `UNSTOP_PERSIST` | `true` | `false` = memory only (no database copy) |

Nothing Unstop-related is ever exposed to the browser; there are no `VITE_` variables.

## 5. Running locally

```bash
cd server
# see the full UI with clearly labelled mock listings (never stored in the database):
UNSTOP_PROVIDER=mock npm run dev
# or, with an authorized feed:
UNSTOP_PROVIDER=feed UNSTOP_FEED_URL=https://… UNSTOP_API_KEY=… npm run dev
```

Then open **Events** and pick **Source → Live · Unstop**.

## 6. Caching and freshness

- Fresh (younger than the TTL) → served from memory.
- Expired → served immediately (`stale: true`, `Warning: 110` header) while **one**
  refresh runs in the background.
- Nothing cached → the request waits for the refresh.
- Provider down → last good copy (memory, or the database after a restart). If there's
  nothing at all, the API answers `503 "Unable to load external events right now…"`
  and the Events page shows its usual "Couldn't reach … / Retry" notice.
- Rate limited (429) → no upstream calls until `Retry-After` passes.
- Upstream calls are at least 30 s apart however many visitors arrive; the browser
  caches API responses for 60 s; the endpoint is rate limited to 120 requests/min per IP.

## 7. Synchronization and deduplication

- Each sync fetches the feed, normalizes it, drops ended listings, keeps up to
  `UNSTOP_MAX_EVENTS` (soonest deadline first) and upserts them with
  `upsert_external_events()`.
- Identity = `source + provider id`; without an id, a fingerprint of normalized
  title + organizer + start date. Re-running a sync updates rows — no duplicates.
- Listings are read-only in Codefolio (no admin edits to be overwritten).
- **Recommended production schedule:** `UNSTOP_SYNC_INTERVAL_MINUTES=30` (or an
  external cron calling `POST /api/unstop/sync` as an admin), with the default 15-minute
  cache. Stay within whatever limits your feed agreement sets.

## 8. API

| Method | Path | Access |
|---|---|---|
| GET | `/api/unstop/events?q=&page=&limit=&category=&mode=&location=&status=&sort=` | public |
| GET | `/api/unstop/events/:id` | public |
| GET | `/api/unstop/status` | platform admins |
| POST | `/api/unstop/sync` | platform admins |

`category`: all · hackathon · competition · workshop · webinar · conference · quiz · other ·
`mode`: all · online · offline · hybrid · `status`: open (default) · closing_soon · upcoming · closed · all ·
`sort`: deadline (default) · start · recent · title · `limit` 1–100 · `page` 1–1000.
Response: `{ items, page, limit, total, hasMore, source: { name, configured, mock, updatedAt, stale } }`.
Invalid parameters → `422` with per-field errors.

## 9. Troubleshooting

Server logs use the `[unstop]` prefix:

| Log | Meaning |
|---|---|
| `provider: off — Not connected…` | No authorized feed configured (expected by default) |
| `fetching events` / `fetched N events (K kept, S skipped)` | Sync ran |
| `skipped invalid event #i: <reason>` | A record failed validation (e.g. non-https or non-Unstop link) |
| `provider unavailable: <reason>` | Timeout, network error, HTTP error, malformed JSON or 429 |
| `cache hit (N events, age Xs)` | Served from cache (logged at most once a minute) |

Admin → External events shows the same information, including the last error.

## 10. Limitations and production readiness

- **Not connected to real Unstop data**, because no permitted source exists today.
  The pipeline (provider, cache, database, API, UI, admin) is production-ready and
  tested; it needs an authorized feed URL/key to show real listings.
- The feed contract is Codefolio's; an official Unstop API would need a small mapping
  in `normalize.js` if its field names differ.
- The cache is in memory per API instance (with the database as a durable copy).
  Running several instances works, but each refreshes its own cache; use the timer on
  a single instance or an external cron if that matters.
