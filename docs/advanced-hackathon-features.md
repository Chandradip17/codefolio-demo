# Advanced hackathon features

This covers three features: Team Matcher, GitHub integration and Demo Day. Each one reuses the existing v1 components and styles. The only additions are a sidebar entry ("Demo Day"), a few entry-point buttons and links, and small CSS blocks built from existing tokens.

## Security model (all three)

- Migration: `server/supabase/migrations/20260926180000_matcher_github_demoday.sql`. It adds these tables:
  - `team_preferences`, `team_requests`
  - `github_connections`, `project_repositories`, `github_activity`
  - `demo_sessions`, `demo_presentations`
  - `judge_notes`
- Every table has RLS enabled with **no policies** and no `anon` / `authenticated` grants. The browser cannot read or write them directly.
- All rules live in `SECURITY DEFINER` functions that only `service_role` can execute. The Express API calls them after checking the signed-in user:
  - `save_team_preferences`, `team_match_candidates`, `send_team_request`, `respond_team_request`
  - `demo_save_session`, `demo_control`
- React route guards are only for convenience. The API returns 403/404 for anyone without access, and outsiders get 404 so they can't learn that something exists.

## 1. Team Matcher

- Pages: `/team-matcher` (matches and invitations) and `/team-matcher/preferences`.
- Entry points: the Dashboard header, a "Find teammates" link in the hackathon's event modal, and a link in the application form's participation step.
- Preferences are saved per hackathon: skills, roles needed, experience, availability, goal, interests, about, and "available for invitations".
- Scoring lives in `server/src/lib/matching.js`. It is deterministic, and the weights sit in one config object (`MATCH_WEIGHTS`):

  | Component | Weight |
  |---|---|
  | Skill complement (their roles cover what you're looking for, and the reverse) | 40% |
  | Hackathon goal | 25% |
  | Experience closeness | 15% |
  | Availability | 10% |
  | Project interests (Jaccard) | 10% |

  Every "why this match" reason comes from these inputs. Ties are sorted by name, then by id.
- **AI is optional and semantic only.** With `GEMINI_API_KEY` set, "Suggest skills from About you" proposes tags. The member adds them manually, and AI never ranks anyone.
- Candidates must be in the same hackathon, available and not full, and must not already be teammates. You never see yourself.
- Invitation rules are enforced in SQL:
  - no self-invites
  - no duplicate pending invitations in either direction
  - nobody who is unavailable or hasn't saved preferences
  - no one whose team is full, and not when both people are already in teams
  - at most 20 pending invitations
  - only the receiver can accept or decline, and only the sender can withdraw
- Accepting an invitation shows each side the other's team name and code. **Joining still uses the normal application** (form, fee and team-size rules stay intact).
- Real time: `team.request` messages go only to the other person, who gets a toast and a refreshed list.

## 2. GitHub integration

- `RepoPanel` appears in the participant's project modal (editable by team members) and on the judge's project page (read-only).
- It shows metadata, visibility, languages, commits, contributors, open PRs and issues, stars, and the 10 most recent commits / PRs / issues.
- Sync: "Sync now" has a 60-second cooldown, and the data auto-refreshes in the background when it's older than 15 minutes. Counts are shown as **informational only** and never feed scores.
- Changing the repository updates `projects.github_url`. That's blocked once judges have started reviewing (`project/locked`).
- **Public repositories work without any setup.** An optional server `GITHUB_TOKEN` raises the rate limit.
- Private repositories and "choose from my repositories" need a GitHub **OAuth App**:
  1. Create one at GitHub → Settings → Developer settings → OAuth Apps. Callback URL: `<API origin>/api/github/callback` (dev: `http://localhost:4000/api/github/callback`).
  2. In `server/.env`, set:
     - `GITHUB_CLIENT_ID`
     - `GITHUB_CLIENT_SECRET`
     - `GITHUB_TOKEN_ENCRYPTION_KEY`: 32 random bytes, base64. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
  3. Scopes default to `read:user` (public repositories only). GitHub OAuth Apps have no read-only private scope, so private repositories need `GITHUB_OAUTH_SCOPES=read:user repo`. Enable that only if you need it.
- Token handling:
  - The OAuth state is HMAC-signed, bound to the member and expires after 10 minutes.
  - Tokens are stored AES-256-GCM encrypted (`github_connections.access_token_enc`, not readable by clients).
  - Tokens are revoked on disconnect and never sent to the browser or logged.
  - A private repository is synced with the connecting member's token. Judges' AI analysis uses that same token server-side.
- **Not verified end-to-end:** the OAuth flow was not run because no OAuth App credentials are configured. The encryption, state signing and snapshot parsing are unit-tested with a mocked GitHub API.

## 3. Demo Day

- `/organizer/demo-day` (organizer or admin): pick finalists (sorted by current judging average, for reference only), order them, and set the presentation and Q&A durations.
- Controls: start Demo Day, start next team (or any specific waiting team), Q&A, pause / resume, end presentation, next team, skip, end Demo Day.
- `/demo/:eventId`: the presentation screen (organizer, assigned judges, approved participants). It shows the current team, a large timer and the running order.
- `/judge/demo/:eventId`: the team on stage opens automatically, next to the timer, **private notes** (autosaved, visible only to that judge) and the **existing score form** (same `submit_review` path, same criteria and weights). The judge dashboard shows a "Demo Day live" button while a session is live.
- **Server-authoritative timer:** `demo_control` stamps `phase_started_at`, `paused_at` and `paused_seconds` with the database clock. Every client computes remaining = duration − (now − started − paused), with `now` corrected by the `serverNow` offset. Every screen therefore shows the same time, and a reload doesn't reset it.
- Real time: after every change, `demo.updated` is pushed to the organizer, assigned judges and approved participants (SSE plus the signed Supabase broadcast relay), with a 30-second poll as a fallback.

## Tests

| Command | What it covers | Result |
|---|---|---|
| `npm run test:matcher-demo` | SQL rules in PGlite, including browser-role lockout | 11 passed |
| `npm run test:github-matching` | token encryption, OAuth state, snapshot parsing (mocked), scorer | 7 passed |
| `npm run smoke:advanced` | live API: matcher, invitations, GitHub public repo (octocat/Hello-World), notes, Demo Day flow | 14 passed (cleans up after itself) |
