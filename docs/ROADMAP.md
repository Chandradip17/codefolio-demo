# Codefolio: spec implementation status

Tracks the master spec (6 phases). **The existing UI is kept as-is**; new features reuse its components and styles.
Supabase project: **codefolio demo** (`zvtlkfbzmwgxhglsjnat`). It's the only project the connected Supabase MCP can access; the spec's `jutcfkrmrruayxuwovpe` isn't in that account.

| Phase | Status |
|---|---|
| 1 · Auth, onboarding, profiles, protected routing | ✅ Built and verified (dashboard setup items below still pending) |
| 2 · Host requests, admin approval, events + applications, co-hosts | ✅ Host requests, admin approval and the application flow are done · ⬜ co-hosts |
| 3 · Hackathons, form builder, teams, codes/invite links, team review | ✅ Form builder · ⬜ teams, invite codes, team review |
| 4 · QR credentials, camera scanner, atomic check-in | ✅ Built and verified |
| 5 · Projects, media, contributors, discovery | ⬜ Not started |
| 6 · Notification center, email (Resend), reminders, polish | ⬜ Not started (live in-app notifications exist through the activity feed) |

## Phase 1: what exists

- **Sign-in:** Google OAuth, email one-time code, and password (kept for the demo accounts). The browser uses Supabase Auth with the publishable key; the API accepts the same access token.
- **Onboarding** (`/onboarding`): required before using the app (username required). It's also enforced in the database (`onboarding_minimum`). Existing accounts were backfilled with usernames.
- **Profiles:** photo (Storage bucket `avatars`), username (unique, live availability check), college, company, skills, GitHub, LinkedIn, portfolio. Edit at `/profile`; public view at `/profile/:username` (members only).
- **Members-only pages:** Events, Chapters, profiles, dashboard, admin and event details. Logged-out visitors see the landing page and About. The intended destination is kept through login and onboarding.
- **Landing stats** are real: Codefolio events and seats come from the database (sample content excluded); GDG chapters and cities come from the live listings.
- **Security:**
  - RLS on profiles: signed-in members can read (emails excluded); members update only their own row and only whitelisted columns.
  - The role can't be changed from the browser, and new-account roles never come from user-editable metadata.
- **Migration:** `server/supabase/migrations/20260925130000_phase1_identity.sql` (applied via MCP).
- **Tests:** `npm run test:phase1` (14 local RLS tests), plus `test:sql` (17) and `smoke` (15, live).

## Host approval, applications, form builder, QR check-in

Migration: `server/supabase/migrations/20260925150000_hosting_applications_checkin.sql` (applied as `hosting_applications_checkin`). All rules live in SQL functions that only the server's service role can call.

**Host approval**
- Any member can ask to host at `/host`. "Become an Organizer" links go there; choosing Organizer at sign-up files the same request.
- Platform admins review requests at **Admin → Host requests**, which has pending / approved / rejected tabs and shows applicant, email, profile link, type, community, reason and date.
- Only approval grants `role = organizer`. There's no other path: sign-up metadata and profile edits can't set it.
- The applicant gets a live notification, and their role refreshes in any open tab.

**Bookings are applications**
- "Book My Seat" now opens the event's application form and sends a **Pending** request. No seats are taken yet.
- The host decides in **Admin → Bookings**:
  - **Approve** holds the seats and issues the QR.
  - **Reject** takes an optional note.
  - **Remove** applies to approved attendees.
- The host can view each applicant's answers. Uploaded files are private and open through 10-minute signed links.
- Per-event stats: applications, pending, approved, rejected, attended, capacity, seats left.
- The admin side can only act on real applications. It can't create bookings or add attendees.
- Statuses: Pending → Confirmed / Rejected; Confirmed → Removed / Cancelled / Attended. Attendance can't be undone.
- Attendees see Pending / Not approved / Removed (with the host's note) on their dashboard, and can withdraw a pending request.

**Form builder** (Admin → Events → Form)
- Hackathons start from a default form: name, email, college/company, skills, GitHub, LinkedIn, portfolio, experience, and "why". Other events ask only "why".
- Hosts can add, remove and reorder questions, and mark them required or optional.
- Question types: short text, long text, URL, number, single choice, multiple choice, file upload.
- Forms are stored as JSON and versioned. Answers are stored one row per question in `booking_answers`, so there are no hardcoded columns.
- Answers are validated on the server against the form.

**QR check-in**
- A token is issued when an application is approved.
- The token is 64 random hex characters, with a 10-character manual code.
- The QR contains only `codefolio:ci:<token>`, with no personal details.
- Attendees open it with **Show QR** on their dashboard. **Regenerate** revokes the old code immediately.
- Hosts use **Admin → Check-in**:
  - Camera scanning uses BarcodeDetector where available and falls back to jsQR.
  - There's also a manual code box and a live attendance list.
  - Each failure gets a precise message: invalid, not found, wrong event, already checked in (with the time), revoked, not approved, event closed.
- Check-in is atomic, and only one check-in per registration is possible.

**Event timeline & drafts** (Admin → Add/Edit Event; migration `20260925170000_event_timeline_teams_drafts.sql`)
- **Hackathons require:**
  - application opening date/time and deadline (IST)
  - "Hacking starts" and "Hacking ends / demos" dates
  - min and max team size (1–10)
- **Optional:** a theme/track for hackathons. Other event types can set the same window and an end date, but don't have to.
- **Participation format:** In-person, Online or Hybrid.
- **Publish status:** Published or Draft. Drafts are visible only to their host (the API hides them from everyone else) and can't be applied to. An event with applicants can't go back to draft.
- **Order is enforced** in the form, the API and the database: applications open → deadline → hacking starts → hacking ends. Applying outside the window is refused with the exact open date.
- After creating a hackathon, the host goes straight to its application form builder.

**Hackathon teams** (migration `20260925190000_hackathon_teams.sql`)
- When applying to a hackathon, members choose **Solo**, **Create team** or **Join team**:
  - Solo is disabled when the minimum team size is above 1.
  - Teams are disabled when the maximum is 1.
  - Hackathons without team settings allow teams of 1–4.
- **Create team:** the creator names the team (unique per hackathon) and gets a **6-character code**. They become the team leader.
- **Join team:** others enter the code, with a "Check code" preview. Joining is refused if the code is unknown, for a different hackathon, or the team is full. Joins are locked so two people can't take the last slot at once.
- Every member sends their own application (1 seat each; no seat picker for hackathons).
- When a member withdraws or is rejected or removed, they leave the team. An empty team is deleted, and if the leader leaves, leadership passes to the next member.
- **Where teams show up:**
  - the confirmation pass shows the code, with a copy button
  - dashboard cards show the team name, member count, code and whether you lead it
  - the host sees the team in Admin → Bookings, the answers view and the CSV export, with a warning when a team is below the minimum size
- Rosters update live (`team.updated`).
- **Tests:** `test:phase2` covers teams in SQL, and `npm run smoke:teams` runs 7 live end-to-end steps.

**Individual applications & application fee** (migration `20260926100000_individual_applications_fees.sql`)
- **One person, one seat:** every application is for exactly 1 seat, and the seat picker is gone. Teams exist only for hackathons; for other events the server ignores any team fields.
- **Setting a fee:** Admin → Add/Edit Event has an **Application Fee** section; 0 = free.
- **Paid events:** the host must add a **UPI ID**, a **UPI number** (10-digit mobile; +91/0 prefixes are normalised) and a **UPI QR image** (uploaded as PNG). The database enforces this too.
- **Privacy:** the public event list shows only the fee amount. UPI details go to the host and to signed-in applicants through the application form.
- **Applying to a paid event:** the applicant pays by QR, ID or number, then enters the **12-digit UPI transaction ID (UTR)**. A payment screenshot is optional and stored privately. A UTR can't be reused for the same event, and the fee amount is recorded on the booking.
- **Where it shows:**
  - host: fee and UTR in the bookings list, answers view (with a screenshot link) and CSV, to verify before approving
  - attendee: fee and UTR on the confirmation pass and ticket
- **Tests:** `npm run smoke:fees` (7 live steps).

**Judges & judging** (migration `20260926120000_judging.sql`)
- **Becoming a judge:**
  - "Apply to become a Judge" on Sign up, or `/judge/apply` for existing members, creates a **pending** application. Skills and links are saved to the profile.
  - Admin → Judge applications (`/admin/judge-applications`) lists, shows details, and approves or rejects with an optional reason the applicant sees.
  - Approval is one SQL transaction: application approved, reviewer and time recorded, `profiles.is_judge = true`.
  - Participants keep all their normal abilities.
- **Security:**
  - `is_judge` is readable by members but not writable.
  - All judging tables have RLS on with no browser access.
  - Every write goes through service-role-only SQL functions.
- **Projects:** approved hackathon participants submit one project per team (or per solo participant) from their ticket. Projects are locked once a judge has reviewed them.
- **Judge workspace** (`/judge/dashboard`, `/judge/projects/:id`, approved judges only, their assigned hackathons only):
  - scores of 0–10 for the 5 weighted criteria; the weighted score is computed in the database
  - one review per judge per project, which the judge can update until results are published
- **Organizer** (`/organizer/judging`, `/organizer/results/:id`):
  - assign approved judges (pending/rejected applicants and the hackathon's own participants are refused)
  - review progress, per-judge scores and feedback
  - a variance flag when judges' scores are 2.5+ apart (the flag only — no automatic changes)
  - publish or unpublish results
- **Results:** `/results/:id` is open to members only once published, and shows no judge names or feedback. Publishing closes reviews and submissions.
- **Analysis:**
  - GitHub facts (languages, README, tests, CI, Docker, licence, commits) are always collected.
  - The Gemini summary runs only when `GEMINI_API_KEY` is set in `server/.env` (model `GEMINI_MODEL`, default `gemini-2.5-flash`). It is supporting information and never scores.
  - `GITHUB_TOKEN` (optional) raises the GitHub rate limit.
- **Tests:** `npm run test:judging` (13 SQL/RLS) and `npm run smoke:judging` (15 live end-to-end steps).

**Unstop listings** (migration `20260926150000_external_events.sql`; full guide: [unstop-integration.md](unstop-integration.md))
- Unstop has no public API or feed, and robots.txt disallows `/api/*`, so nothing calls unstop.com.
- Everything is built up to an authorized feed:
  - provider (`off` / `feed` / `mock`)
  - cache with stale fallback
  - de-duplicated database copy
  - `/api/unstop/*`
  - the "Live · Unstop" source on the Events page
  - Admin → External events
- It stays off until `UNSTOP_PROVIDER=feed` and `UNSTOP_FEED_URL` are set.
- **Tests:** `npm run test:unstop` (25).

**Tests:** `npm run test:phase2` (33 local SQL tests) and `npm run smoke:phase2` (15 live end-to-end steps; it removes everything it creates).

## Advanced hackathon features: Team Matcher, GitHub, Demo Day

Details: [advanced-hackathon-features.md](advanced-hackathon-features.md). Migration `20260926180000_matcher_github_demoday.sql` (8 new tables, all RLS deny-all; rules in service-role-only SQL functions).

- **Team Matcher** (`/team-matcher`, `/team-matcher/preferences`): per-hackathon preferences; deterministic, explained match score (skills 40 / goal 25 / experience 15 / availability 10 / interests 10); invitations (send, withdraw, accept, decline) with real-time notifications. Accepting shows team codes; joining still goes through the normal application.
- **GitHub**: project ↔ repository mapping, metadata, stats and recent activity, manual sync (60 s cooldown) and auto-refresh when older than 15 min. Public repositories work now. Account connection (OAuth) needs a GitHub OAuth App (see the doc); tokens are AES-256-GCM encrypted on the server.
- **Demo Day** (`/organizer/demo-day`, `/demo/:eventId`, `/judge/demo/:eventId`): finalists, running order, durations, start / Q&A / pause / resume / end / skip / next, and a server-timestamp timer synced in real time. Judges get private notes and the existing score form.
- **Tests:** `npm run test:matcher-demo` (11), `npm run test:github-matching` (7), `npm run smoke:advanced` (14).

## Idea Assistant, Communication Center, Organizer Analytics

Details: [ideas-communication-analytics.md](ideas-communication-analytics.md). Migration `20260927100000_ideas_communication_analytics.sql` (3 new tables, RLS deny-all; rules in service-role-only SQL functions).

- **Idea Assistant** (`/idea-assistant`): grounded Gemini ideas (server-side key), six refine actions, private saved ideas, import into the project form. Needs `GEMINI_API_KEY`.
- **Communication Center** (`/organizer/communication`, `/hackathons/:id/communication`): targeted announcements (everyone / participants / judges / team), important, pinned, scheduled (IST), edit, archive, realtime delivery, read tracking, deadline reminders. No mentor role exists, so there's no mentor audience.
- **Analytics** (`/organizer/analytics/:id`): database-aggregated registrations, teams, submissions, technologies, judging, timeline and factual insights.
- **Tests:** `npm run test:comms-analytics` (5), `npm run test:ideas-analytics` (8), `npm run smoke:ideas-comms` (10).

## Participant Chat

Details: [participant-chat.md](participant-chat.md). Migration `20260927140000_participant_chat.sql` (4 new tables, RLS deny-all). This is two-way participant chat, separate from the announcement Communication Center (which is unchanged).

- `/hackathons/:id/chat` for participants; `/organizer/chat` for moderation (reports, soft delete, hackathon-scoped mutes, open/close).
- Cooldown, burst limit, maximum length, duplicate window and read-only-after-end come from `CHAT_*` env settings and are enforced in the database.
- **Tests:** `npm run test:chat` (12), `npm run smoke:chat` (11).

## Known gaps / next decisions

- Dark mode (spec §34) is **not** added, because it would change the existing UI. Waiting on the owner.
- **Sample content:** sample events and sample attendees remain as demo content (labelled "Sample"). No new sample data was added.
- **Not built yet:** co-hosts, teams / invite codes / team review, projects (Phase 5), and email notifications through Resend (Phase 6).
- **Network:** this machine's DNS sometimes times out. The API now retries connection failures to Supabase. If Supabase Auth is unreachable, it answers `503 "Can't reach the sign-in service"` instead of wrongly saying the session expired.

## Owner setup (Supabase dashboard; the MCP can't change auth settings)

- [ ] Authentication → Providers → **Google**: enable it and add the OAuth client ID and secret.
- [ ] Authentication → URL Configuration: add `http://localhost:5173/auth/callback` to Redirect URLs (Site URL `http://localhost:5173`).
- [ ] Authentication → Email Templates → **Magic Link**: include `{{ .Token }}` so emails show the sign-in code.
- [ ] Authentication → turn on **leaked password protection**.
- [x] First **admin**: the demo organizer `@organizer` (organizer@codefolio.dev) is a platform admin. Add more with `update profiles set platform_role = 'admin' where username = '…';`
