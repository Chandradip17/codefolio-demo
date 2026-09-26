# Idea Assistant, Communication Center and Organizer Analytics

All three features reuse Codefolio's existing components and styles (buttons, inputs, selects, segmented controls, badges, cards, KPI tiles, the `ColumnChart` and `BarList` charts, the admin layout and the hackathon picker). Visible additions are limited to these:

- two sidebar items (Communication, Analytics)
- an "Updates" button on the attendee and judge dashboards
- an "Idea Assistant" row in the hackathon event popup
- an "Import from a saved idea" option in the project form (new projects only)

## Security model

- Migration: `server/supabase/migrations/20260927100000_ideas_communication_analytics.sql`. It adds three tables: `hackathon_ideas`, `hackathon_announcements` and `announcement_reads`. Nothing existing was changed or dropped.
- RLS is on with **no policies**, and the browser roles have no table or function privileges (verified live). All access goes through the API with the signed-in user.
- Who may see or do what is decided in the database, from the user's real role and team:
  - `cf_event_role`, `cf_can_see_announcement`, `announcements_for`
  - `save_announcement`, `archive_announcement`
  - `mark_announcements_read`, `announcement_unread_counts`
  - `hackathon_analytics`

  The API never trusts a user id, hackathon id, role or team sent by the browser.

## 1. AI Hackathon Idea Assistant: the floating "AI Ideas" button (and `/idea-assistant`)

- **Where:** a floating **AI Ideas** button at the bottom-left for signed-in members.
  - It's hidden on sign-in pages, the participant chat (the composer sits there), Demo Day screens and `/idea-assistant` itself.
  - It steps aside while the footer is on screen.
  - It opens the existing Modal (a full-screen sheet on phones).
  - `/idea-assistant` shows the same panel as a page. There is one frontend component (`IdeaAssistantPanel`) and one backend (`/api/ideas`).
- **Flow:**
  1. **Choose a hackathon.** Only hackathons you've applied to (pending, accepted or attended) are listed. The server decides the list and re-checks membership on every AI call and save; anyone else gets 404.
  2. **Hackathon details** come from Supabase: theme, description, requirements, dates, team size, hacking hours. Missing fields are omitted.
  3. **Your details** are prefilled from your profile skills, Team Matcher interests and experience, and current team size. You can edit them for this session; your profile only changes if you tick "Save these skills to my profile".
  4. **Preferences:** interests (with suggestions), problem area, difficulty, team size (Solo–5+), development time, technology preference, and 3–5 ideas.
  5. **Generate** returns 3–5 ideas, each with: title, problem, solution, **why it fits this hackathon**, target users, core features, tech stack, MVP scope, roadmap, challenges, future improvements, and assumptions to verify.
  6. **Refine a single idea** in place: Develop this idea, Make it simpler, More innovative, More technical, Add AI, Improve MVP.
  7. **Save.** This uses the existing saved-ideas table (private to you), which gained a `why_it_fits` column. Import into a project through **Submit project → Import from a saved idea**.
- **Grounding and prompt safety:**
  - Codefolio's rules live only in Gemini's system instruction.
  - Hackathon and member text is sent as JSON data, which the model is told never to follow as instructions.
  - The model is also told not to invent rules, APIs or datasets, to list assumptions, and never to promise a win.
  - Codefolio-wide facts (judging criteria and weights, the required submission) are included because they apply to every hackathon here.
- **Limits:** inputs are length-capped, with at most 20 skills, 10 interests and 5 ideas per request, and a bounded output size.
  - `AI_IDEA_COOLDOWN_SECONDS` (default 10) is enforced per member on the server, counted from when the answer arrives. Requests that fail before reaching Gemini don't start it.
  - There is also a 20-requests-per-10-minutes limit per member.

### Gemini (one shared client: `server/src/lib/gemini.js`)

- The Idea Assistant, Team Matcher suggestions and the judges' project analysis all use it. There are no other Gemini calls.
- **Key:** `GEMINI_API_KEY` in `server/.env` only. It's sent in the `x-goog-api-key` header, never in the URL, a response, a log or the frontend (verified: it's absent from the production bundle, API responses, browser storage, the repository and git history). `server/.env` is git-ignored.
- **Model:** `GEMINI_MODEL` (default `gemini-3.8-flash`). The old default `gemini-2.5-flash` is closed to new API keys, which was the second cause of the original failure (the first was the missing key). Gemini 3 models use `thinkingLevel: low` for speed.
- **Fallbacks:** `GEMINI_FALLBACK_MODEL` takes comma-separated models (e.g. `gemini-3.7-flash,gemini-3.5-flash`). They're used only when the main model is overloaded (5xx) or has used up its **own** quota. Free-tier quotas are per model (20 requests per day per model on the key tested). An account-wide rate limit or a key/config error never falls back.
- **Errors members see:**

| Situation | Message | HTTP |
|---|---|---|
| No key | AI Idea Assistant is not configured. | 503 |
| Key rejected / model unavailable | AI service configuration is invalid. | 503 |
| Quota / rate limit | Too many AI requests. Please try again shortly. | 429 |
| Overload, network, timeout, empty / truncated / unreadable output | The AI service is temporarily unavailable. Please try again. | 502 |
| Codefolio cooldown | Please wait N seconds before asking the AI again. (`retryAfter`) | 429 |

  Details go only to the server log, with the key redacted. There is one retry with backoff per model.

## 2. Communication Center

- **Organizers** use `/organizer/communication` to:
  - create announcements for Everyone, Participants, Judges or a specific team
  - mark them important and/or pinned, and optionally schedule them (entered and shown in **IST**)
  - edit them (published ones show "edited") and archive them (soft; kept in an Archived list)
- **Participants and judges** use `/hackathons/:hackathonId/communication` (or `/hackathons/communication` to pick one):
  - their own feed, with pinned items first, All / Unread / Important filters and "Show older" pagination
  - per-item "Mark as read" and "Mark all as read"
  - upcoming deadlines taken from the listing (applications close, hacking start and end), shown without sending extra notifications
- **Audiences:**
  - Participants = everyone who applied (pending or approved)
  - Judges = judges assigned to that hackathon
  - Team = members of that team
  - The organizer sees everything, including scheduled announcements.
  - Codefolio has **no mentor role**, so there is no mentor audience; none was invented.
- **Realtime:** publishing pushes `announcement.published` only to the audience, through the existing stream (SSE plus the signed Supabase broadcast relay). It appears as a toast and in the existing Activity feed, and open feeds refresh by themselves. Scheduled announcements are claimed exactly once by a 30-second ticker in the API and delivered at their time. Edits and archives refresh the affected screens without a toast.

## 3. Organizer Analytics: `/organizer/analytics/:hackathonId?`

- One database call (`hackathon_analytics`, organizer or admin only) returns only aggregates; no raw rows reach React.
- **Numbers shown:**
  - registrations (by status, and per day or per week in IST)
  - approval rate
  - teams (count, average size, size distribution, members not in a team, teams below the minimum)
  - submissions (expected submitters, not started, awaiting review, partly reviewed, fully reviewed)
  - technology usage (from `projects.tech_stack`, grouped case-insensitively)
  - judging progress
  - timeline (registration → start → end → submissions → judging → Demo Day → results)
- **Definitions:**
  - *Submission rate* = teams and solo participants (approved) that have a project ÷ all approved teams and solo participants. Projects are one per team.
  - *Team formation rate* = approved participants in a team ÷ approved participants.
  - Empty data shows "–" and empty states, never NaN.
  - Codefolio projects have no draft status, so "not started" means no project yet.
- **Action insights** are factual counts only, such as "1 application is waiting for your review" or "3 reviews still to be done (1 of 4 complete)".

## Tests (all run)

| Command | Covers | Result |
|---|---|---|
| `npm run test:comms-analytics` | SQL rules in PGlite: targeting, scheduling, read tracking, archive, analytics access and counts, browser-role lockout | 5 passed |
| `npm run test:ideas-analytics` | instruction/data separation (injection), missing fields omitted, key in header only and never logged, every error category (invalid key, model unavailable, 429, 5xx retry, network, timeout, empty / truncated / invalid output), model fallback, rates and insights | 10 passed |
| `npm run smoke:ideas-comms` | live API: idea context/generate/refine/save/privacy, announcement permissions, **realtime delivery only to the audience**, feeds, read tracking, edit/archive/schedule, analytics counts | 10 passed (without a key: generation verified as "not configured"; with a local Gemini stand-in via `GEMINI_API_BASE`: the full generate → refine → save path) |

**Real Gemini API: verified.** Generation, refinement and saving ran live through `/api/ideas` and the browser (floating assistant) with a real key, along with the invalid-key, overload (503) and quota (429) paths.
