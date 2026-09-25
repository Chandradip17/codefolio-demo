# Codefolio v2: build roadmap

Source of truth for what is **built and verified** vs **not built yet**.
Anything not marked ✅ here is not implemented, and the UI must not pretend it is.

Architecture (decided 2026-09-25):
- **Supabase-first.** The React app talks to Supabase directly (Auth, Postgres, Storage, Realtime). RLS is enabled on every table, and privileged operations go through `security definer` SQL functions.
- **Thin Node service** (`server/`) only for things that need secrets or CORS proxying: live GDG/Devfolio listings ("Around India") and, in Phase 6, the email outbox worker (Resend).
- **Supabase project:** `jutcfkrmrruayxuwovpe`. Migrations live in `supabase/migrations/`.
- The v1 app (Express API + old project `zvtl…`) is archived in `_archive/v1/`.

| Phase | Scope | Status |
|---|---|---|
| 1 | Landing, Google OAuth + email OTP, onboarding, profiles, settings, theme, protected routing, schema/RLS foundation | 🟡 code written, DB migration pending (needs Supabase MCP) |
| 2 | Host requests + admin approval, events CRUD, discovery, applications, participants, co-hosts, host dashboard | ⬜ not started |
| 3 | Hackathons, form builder, solo/team modes, teams, codes/invite links, team-level review | ⬜ not started |
| 4 | QR credentials, participant QR page, camera scanner + manual code, atomic check-in, attendance | ⬜ not started |
| 5 | Projects, media, contributors, discovery, profile integration | ⬜ not started |
| 6 | Notification center, email (Resend via outbox), reminders, polish, a11y, performance | ⬜ not started |

## Manual setup the project owner must do (dashboard-only settings)
- [ ] Connect the Supabase MCP connector in Claude (for migrations + verification)
- [ ] Auth → Providers → **Google**: enable, paste Google OAuth client ID/secret
- [ ] Auth → URL Configuration: Site URL `http://localhost:5173`, add redirect `http://localhost:5173/auth/callback`
- [ ] Auth → Email Templates → **Magic Link**: include `{{ .Token }}` so emails contain the 6-digit code (the link also works)
- [ ] Provide the Codefolio logo file (the current mark is a placeholder derived from v1)
- [ ] Phase 6: Resend API key as a server secret
