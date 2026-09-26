# Participant Chat

Two-way chat between the participants of one hackathon. It is **separate** from the Communication Center:

| | 📢 Announcements (Communication Center) | 💬 Participant Chat |
|---|---|---|
| Direction | One-way: organizer → participants / judges / a team | Two-way: participant ↔ participant |
| Used for | Deadlines, rules, schedule, official information | Discussion, questions, team formation, resources |
| Tables | `hackathon_announcements`, `announcement_reads` | `chat_rooms`, `chat_messages`, `chat_message_reports`, `chat_mutes` |
| API | `/api/announcements` | `/api/chat` |

The announcement system was not modified.

## Pages

- `/hackathons/:hackathonId/chat` (or `/hackathons/chat` to pick a hackathon). Entry points:
  - a "Participant chat" button on the dashboard
  - a "Participant chat" row in the event popup, for hackathons you've applied to
- `/organizer/chat` shows "Chat moderation" in the admin sidebar: room status and open/close, reported messages with a Review dialog (Dismiss / Delete message / Mute user), and active mutes with Unmute.

## Who can do what (enforced in the database, not by the React routes)

- **Participants:** people who applied to the hackathon, not rejected or cancelled. This is the same definition as the announcement "Participants" audience. They can read, send and report.
- **Judges:** not in the participant chat.
- **Organizer of that hackathon, and platform admins:**
  - read the room and moderate it (remove messages, mute, review reports, open/close)
  - they don't post; announcements are for official messages
- **Other people:** get 404 (the chat "doesn't exist" for them), including participants of a different hackathon.
- Messages are always stored with the signed-in user's id, whatever the request contains.

## Limits (one place, enforced by `send_chat_message` in Postgres)

`server/.env` (defaults shown; see `.env.example`):

```
CHAT_MESSAGE_COOLDOWN_SECONDS=5      # wait between messages
CHAT_MAX_MESSAGES_PER_MINUTE=10      # burst limit (rolling minute)
CHAT_MAX_MESSAGE_LENGTH=1000         # characters (hard cap 4000)
CHAT_DUPLICATE_WINDOW_SECONDS=60     # reject the same text repeated within this window
CHAT_READ_ONLY_AFTER_END=true        # no new messages after the hackathon ends (IST)
```

- The API reads these into `config.chat` and passes them to the database function, which checks everything in one transaction:
  1. membership
  2. room open
  3. read-only after the hackathon ends
  4. mute
  5. trimmed and not empty
  6. length
  7. cooldown
  8. burst limit
  9. duplicate text
- A per-user advisory lock serialises sends, so parallel requests can't slip past the cooldown (tested: of 6 simultaneous sends, exactly 1 succeeded).
- Too fast returns `429` with `retryAfter` (and a `Retry-After` header), e.g. "Please wait 3 seconds before sending another message." The countdown in the UI starts from the server's numbers and is only a display.

## Realtime

The existing signed stream carries these events, sent only to that hackathon's participants and moderators:

- `chat.message`: appended, deduplicated by id
- `chat.deleted`: shown as "This message was removed by a moderator."
- `chat.room`: chat opened or closed

History isn't reloaded on each event. The first 50 messages load when the page opens, and older ones load on demand with a cursor.

Ordinary messages never notify. Only moderation does:

- `chat.muted` (to the muted person)
- `chat.report` (to the organizer)

## Moderation data

- **Reports:** one per member per message (unique constraint). You can't report your own message. Status is pending → dismissed / reviewed / action_taken.
- **Delete:** a soft delete (`deleted_at`, `deleted_by`). The text is kept for auditing and hidden from participants.
- **Mute:** `chat_mutes` (hackathon + user, `muted_until`, reason). It lasts 5 minutes to 30 days and never affects the member's account. Muted members can still read the chat.

## Tests (all run)

| Command | Covers | Result |
|---|---|---|
| `npm run test:chat` | SQL rules in PGlite: access (judge / outsider / other hackathon), trim / empty / length, cooldown then allowed, duplicates, burst limit, cursor pagination per hackathon, reports, soft delete, mute and expiry, closed room, read-only after end, audience, browser-role lockout | 12 passed |
| `npm run smoke:chat` | live API: 401 without sign-in, 404 for judge / outsider / other hackathon, realtime delivered once to members only, server cooldown with `retryAfter`, **parallel-request bypass blocked**, validation, history, reporting and organizer notification, delete placeholder, mute / unmute, close / reopen, announcements unaffected | 11 passed |

Not built (optional in the spec): reactions, replies, @mentions.
