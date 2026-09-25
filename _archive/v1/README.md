# Codefolio

The community calendar for GDG events & hackathons across India.

```
codefolio/   React + Vite frontend
server/      Node + Express API, backed by Supabase (Auth + Postgres + Storage)
```

## Setup (about 5 minutes)

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (the free tier is fine).
2. **Create the database:** open *SQL Editor → New query*, paste all of [`server/supabase/schema.sql`](server/supabase/schema.sql) and click **Run**. It's safe to re-run.
3. **Add your keys:** copy `server/.env.example` to `server/.env` and fill in the values from *Project Settings → API*:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (anon / publishable key)
   - `SUPABASE_SERVICE_ROLE_KEY` (service_role / secret key; server only, never commit it)
4. **Install, seed, run:**

```bash
cd server && npm install && npm run seed && npm run dev
```

```bash
cd codefolio && npm install && npm run dev
```

Open http://localhost:5173. Demo accounts (created by the seed):

| Role | Email | Password |
|---|---|---|
| Attendee | `demo@codefolio.dev` | `demo1234` |
| Organizer | `organizer@codefolio.dev` | `organizer1234` |

5. **Check everything end to end** (with the API running):

```bash
cd server && npm run smoke
```

Optional, for password-reset emails: in Supabase *Authentication → URL Configuration*, add `http://localhost:5173/reset-password` to **Redirect URLs**.

## How it fits together

```
Browser (React) ──/api──▶ Express API ──service key──▶ Supabase Postgres (RLS on, no public policies)
                              │                         Supabase Auth (email + password)
                              │                         Supabase Storage (event images)
                              └──▶ gdg.community.dev + api.devfolio.co (cached 10 min)
```

- **The browser only talks to the Express API.** Supabase keys stay on the server, and every table has row-level security enabled with no public policies, so the anon key can't read or write data directly.
- **Auth:** Supabase Auth handles passwords. The API returns the Supabase access and refresh tokens, and the React app sends `Authorization: Bearer …` and refreshes automatically. Roles (`attendee` / `organizer`) live in `profiles`.
- **Seat booking is atomic:** `book_seats()` / `cancel_booking()` are Postgres functions that lock the event row, so two people can't take the last seat. Duplicate bookings are also blocked by a unique index.
- **Live feeds:** the API fetches GDG Community and Devfolio listings, filters them to India, loads GDG event details in the background, and caches everything. Browsers get the cached result in milliseconds.

## API

| Method | Path | Who | |
|---|---|---|---|
| GET | `/api/health` | public | config + DB check |
| POST | `/api/auth/signup` · `/login` · `/refresh` · `/logout` | public | returns `{ user, session }` |
| POST | `/api/auth/forgot` · `/reset` | public | password reset via Supabase email |
| GET / PATCH | `/api/auth/me` | signed in | profile |
| GET | `/api/events` · `/api/events/:id` | public | Codefolio-hosted events |
| POST | `/api/events` | organizer | create |
| PUT | `/api/events/:id` | owner | edit (capacity can't drop below booked seats) |
| POST | `/api/events/:id/cancel` | owner | stops new bookings |
| DELETE | `/api/events/:id` | owner | active bookings become Cancelled |
| GET | `/api/bookings/me` | signed in | my bookings |
| POST | `/api/bookings` | attendee | `{ eventId, seats }` |
| POST | `/api/bookings/:id/cancel` | booking owner | releases seats |
| GET | `/api/admin/bookings` | organizer | attendees of my events |
| POST | `/api/admin/uploads` | organizer | `{ dataUrl }` → Supabase Storage URL |
| GET | `/api/live/gdg` · `/api/live/gdg/:id` · `/api/live/devfolio` | public | live listings |

Errors always look like `{ "error": { "code": "booking/soldout", "message": "…", "fields"?: {…} } }`.

## Tests

- `npm run test:sql` (in `server/`): runs `schema.sql` against an in-memory Postgres (PGlite) and checks booking, duplicate, sold-out, cancel, capacity and delete rules. No Supabase needed.
- `npm run smoke` (in `server/`): end-to-end run against the live API and your Supabase project. It creates a temporary event, then deletes it.

## Deploying

- **API:** any Node 20+ host (Render, Railway, Fly…). Set the same env vars, plus `CORS_ORIGIN` and `APP_URL` = your frontend URL.
- **Frontend:** build with `VITE_API_URL=https://your-api.example.com/api npm run build`, or serve it behind the same domain as the API with `/api` routed to the server.
