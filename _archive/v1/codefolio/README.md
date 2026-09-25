# Codefolio

**The community calendar for GDG events & hackathons across India.**

A React + JavaScript (Vite) app for discovering and booking developer events, organized in three sections:
**Hackathons**, **Workshops** and **GDG Events**.

## Run it

This is the frontend. It needs the API in [`../server`](../server) (Node + Express + Supabase); see the [root README](../README.md) for setup.

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api → http://localhost:4000
```

Set `API_PROXY_TARGET` to point the dev proxy elsewhere, or `VITE_API_URL` for production builds.

### Demo accounts (created by `npm run seed` in the server)

| Role      | Email                     | Password        |
|-----------|---------------------------|-----------------|
| Attendee  | `demo@codefolio.dev`      | `demo1234`      |
| Organizer | `organizer@codefolio.dev` | `organizer1234` |

## Where events come from

| Source | Served by | Notes |
|---|---|---|
| **GDG Community** (live) | `GET /api/live/gdg` | The API pulls gdg.community.dev, keeps Indian chapters, loads event details in the background and caches for 10 min. |
| **Devfolio** (live) | `GET /api/live/devfolio` | Hackathons in India or online with open applications. |
| **Codefolio** (hosted) | `/api/events`, `/api/bookings` | Stored in Supabase; booking and seat tracking run in Postgres functions. |

Live events link out to register on GDG / Devfolio. Only Codefolio-hosted events can be booked in the app.
The GDG and Devfolio endpoints are public but **undocumented**, so they may change without notice. If they fail, the UI shows Retry and keeps everything else.

Client code: `src/services/api.js` (HTTP client, token refresh, errors) and `src/services/liveApi.js`.

## Routes

`/` · `/events` · `/chapters` · `/about` · `/login` · `/signup` · `/forgot-password` · `/reset-password` · `/dashboard` (logged-in attendees) · `/profile` ·
`/admin` · `/admin/events` · `/admin/events/new` · `/admin/events/:id/edit` · `/admin/bookings` (organizers only)

Any page accepts `?event=<id>` to open the event modal (deep-linkable, and survives the login redirect).

## Structure

```
src/
  components/   Navbar, Footer, EventCard (ticket), EventGrid, EventFilters, EventModal, Modal/ConfirmDialog,
                ChapterCard, BookingCard, Charts, LiveStatus, ui.jsx (Button, Badge, Input, Select, Segmented,
                EmptyState, ErrorState, SkeletonCard…)
  context/      AuthContext, DataContext (API data, live feeds, booking actions), ToastContext
  services/     api.js (Codefolio API client), liveApi.js (live listings via the API)
  data/         chapters.js, images.js
  pages/        Home, Events, Chapters, About, Login, Signup, Dashboard, Profile, admin/*
  styles/       base.css (tokens, primitives), components.css, pages.css
```

Photos: Unsplash. Codefolio isn't affiliated with Google or Devfolio. Sample events are fictional and labelled "Sample".
