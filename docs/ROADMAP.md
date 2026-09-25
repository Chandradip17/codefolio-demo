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

**Tests:** `npm run test:phase2` (19 local SQL tests) and `npm run smoke:phase2` (15 live end-to-end steps; it removes everything it creates).

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
