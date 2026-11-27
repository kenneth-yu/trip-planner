# Security and privacy

This app holds personal data that can hurt people if it leaks: who is travelling, where they will sleep each night, which flight they are on, and the codes that let anyone change or cancel a booking. Security is a top priority, above features and above schedule. Every change is reviewed for it, and a failing security check blocks a merge.

## What we hold

| Data | Where | Why it matters | Who may see it |
|---|---|---|---|
| Names, emails | users, travelers | Identity | Trip members |
| Itinerary: flights, hotels, addresses, dates, times | items | Physical whereabouts: where someone is and when the home is empty | Members who can see the item; view link visitors see `everyone` items only |
| Confirmation codes, booking references, seats, phone numbers, prices, booking sites | item_private | Enough to change, cancel or steal a booking | Owners and editors only, never viewers, view links, the calendar mirror by default, or logs |
| Hidden items | items with visibility only_me or specific | Surprises, private plans | Only the people chosen, not the owner |
| Imported raw records (emails, calendar events) | imported_items.raw | May contain everything above and more | Editors of the trip |
| Google refresh tokens | google_connections | Access to the user's Google calendars the app created | Nobody; encrypted at rest |
| Session, invite, view link, assistant tokens | cookies, hashed columns | Account and trip access | Nobody; only hashes are stored |
| Activity log | activity | Before and after copies of items | Filtered by the same projection as items |

## Rules

1. **One permission boundary.** Every read goes through `projectTrip`; every write checks permissions in the service. No endpoint, page, feed, mirror or assistant tool reads the aggregate directly.
2. **Least data.** Collect only what a feature needs. Don't copy sensitive fields into new places (search indexes, logs, analytics, calendar events, PR text) without a reason written in docs/ARCHITECTURE.md.
3. **Secrets are hashed or encrypted.** Tokens are 32 random bytes, shown once, stored as SHA-256 hashes, compared in constant time. Secrets that must be read back (Google refresh tokens) use AES-256-GCM with a key from the environment. Sensitive booking fields are to be encrypted at rest too (planned).
4. **No personal data in logs, errors or URLs.** Log ids and outcomes, not names, addresses, codes or raw imports. Error messages to users say what to do, never echo stored data. Personal data never goes in query strings. Assistant links carry a token, never personal data.
5. **Every input is parsed.** HTTP bodies, server action form data, assistant tool input, calendar events, emails, OAuth responses and files are parsed with zod (or the import pipeline) before use. Unknown fields are dropped.
6. **Outbound calls are explicit and minimal.** The app sends data to: Google (only the calendar it created, only the fields the mirror needs, no codes or seats by default) and, only when `ADDRESS_LOOKUP` is set, OpenStreetMap (an address string, no names or dates) and, for email sign in links, the email API configured by `EMAIL_API_KEY` (the recipient address and the one time sign in link, sent once per sign in request, never logged). Any new outbound call needs a line in this file.
7. **Sessions and cookies.** HttpOnly, Secure in production, SameSite=Lax, signed, expiring. Sign out clears them. Sign in never asks for calendar access.
8. **Abuse resistance.** `src/proxy.ts` runs on every request except static assets. It sets a per request CSP nonce (`script-src 'self' 'nonce-...' 'strict-dynamic'`, no `unsafe-inline` or `unsafe-eval` for scripts in production, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`), HSTS in production, `X-Content-Type-Options: nosniff`, `Permissions-Policy` denying camera, microphone and geolocation, and `Cross-Origin-Opener-Policy: same-origin`. `/v/` and `/invite/` also send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`. In development only, `frame-ancestors` allows the phone frame on `http://localhost:8766`. Rate limits (fixed windows in the `rate_limits` table) apply to sign in (`/api/auth/signin`, `/callback`, `/email`: 10 per 15 minutes), invite acceptance (`/invite/`: 20 per 15 minutes), view links (`/v/`: 120 per minute), calendar feeds (`/api/feed/`: 60 per minute) and the assistant (`/api/mcp`: 120 per minute). Over the limit the response is 429 with `Retry-After` and fixed plain copy. Keys are HMAC-SHA-256 (keyed with `SESSION_SECRET`) of the rule name and the client address, so a leaked table cannot be matched against the IPv4 space; IPv6 clients are keyed on their /64. Raw addresses, emails and tokens are never stored. If the limiter cannot reach the database the response is 503 with the security headers, never an unlimited request. The client address is read from `x-forwarded-for` only when `TRUST_PROXY=1` (use the rightmost hop, which the trusted proxy appended). Without it, Next.js lets clients supply that header, so all clients share one bucket instead. Set `TRUST_PROXY=1` in production behind Vercel.
9. **Deletion is real.** Deleting a trip removes its items, private fields, imports, activity, mirrors (and their Google events) and tokens. A user can delete their account and export their data.
10. **Dependencies are audited.** CI runs `npm audit` for production dependencies at high severity. New dependencies need a reason.
11. **Test data is fake.** Fixtures and demo trips use placeholder codes and phone numbers. Never commit real booking codes, phone numbers, emails or tokens. The repository is private.

## Threat model (short)

| Threat | Mitigation | Proven by |
|---|---|---|
| A viewer or link visitor reads codes or hidden items | `projectTrip` strips them; tests assert they are absent from serialized output | `project.test.ts`, `calendar-mirror.test.ts`, `server.test.ts` |
| An editor edits or deletes an item hidden from them | `assertCanEditItem` | `services.test.ts` |
| A caller claims a role | `Requester` has no role; roles come from memberships | `project.test.ts` |
| A leaked assistant link | Hashed, revocable, trip scoped, read or propose only, proposals need human approval | `server.test.ts` |
| Stolen database | Tokens hashed; Google tokens encrypted; booking fields encryption planned | `auth.test.ts` |
| An AI assistant is tricked into proposing bad data | Proposals only reach the inbox; a person approves | `server.test.ts`, `services.test.ts` |
| Brute forcing tokens or links | 256 bit tokens; rate limits on sign in, invites, view links, feeds and the assistant | `auth.test.ts`, `rate-limit.test.ts` |
| A Google calendar shared onward exposes codes | Mirror leaves codes out by default | `calendar-mirror.test.ts` |
| Personal data in logs | Rule 4; reviewed on every PR | security review |

## Review

Every pull request gets a security review (see `.claude/agents/security-reviewer.md`). A PR that touches auth, tokens, permissions, imports, outbound calls, logging or the database schema cannot merge with an open security finding of severity high or above.

## Reporting

If you find a problem, do not open a public issue. Tell the repository owner directly.
