# Trip planner

Flights, stays and plans for a trip in one place, shown in local time, with problems and deadlines pointed out. The product spec is in `CLAUDE.md` and `docs/`. How the code is put together, with diagrams and state charts, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | What |
|---|---|
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32`. Encrypts booking details, activity copies and imports at rest. The app will not start without it, and losing it makes that data unreadable |
| `AUTH_SECRET` | `openssl rand -base64 32`. Signs Auth.js sign in state |
| `APP_URL` | The address people open, `http://localhost:3000` locally. Emailed sign in links are built on it; required in production |
| `DEV_SIGN_IN` | `1` to show "Demo accounts" (Kenneth, Jacob) on the sign in screen and the email link through a local outbox (never in production) |
| `TRUST_PROXY` | `1` behind a proxy that appends the client address (Vercel). Required in production. `0` makes every client share each rate limit budget, so use it only for a single user setup |
| `DATABASE_URL` | Postgres URL. Leave empty to use an embedded database in `.data/pglite` (migrated in process). A Postgres database is migrated by `npm run db:migrate` (Vercel runs it before every build through `vercel-build`); the app never migrates Postgres on first request |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google and the Google Calendar mirror |
| `AUTH_APPLE_ID`, `AUTH_APPLE_SECRET` | Optional. Shows Sign in with Apple |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Optional. Sends email sign in links through the email API (Resend). Do not set in a deployed environment until sign in rate limits (WP-02) are on main |

```bash
npm run db:seed
npm run dev
```

Open http://localhost:3000 and continue as Kenneth. The seed adds four trips so you can see the UI at every size: the real December trip, an empty trip, a sparse Chicago weekend and a packed Tokyo and Kyoto week with four travelers. Running the seed again skips trips that are already there.

Stop the dev server before running `db:seed` again. The embedded database allows one process at a time.

## Check it

```bash
npm run check
```

That runs type checking, lint, and 101 tests. Tests use an in-memory Postgres (PGlite) and a fake Google Calendar, so they need no setup and no network. The December fixture trip in `src/fixtures` is the main test case; the acceptance checks in `docs/PHASES.md` are written as tests against it.

## Let Claude or ChatGPT add things to a trip

1. Open a trip, go to **Connect**, name the connection ("Jacob's Claude"), and choose **Make a link**.
2. Copy the link. It is shown once and works like a password. **Disconnect** turns it off.
3. Add it to the assistant:
   - **Claude** (claude.ai or the desktop app): Settings, Connectors, Add custom connector, paste the link.
   - **ChatGPT**: Settings, Connectors, Create (developer mode), paste the link as the MCP server URL.
   - **Claude Code**: `claude mcp add --transport http trips <link>`
4. Ask it things like "Read my booking emails and add the hotel and flights to the Asia trip."

What the assistant can do: read the trip as you see it (`get_trip`, `list_trips`, `list_review_inbox`), and suggest items (`add_items` for structured details, `import_calendar_events` for calendar-shaped events). Suggestions land in the **Review inbox** and only reach the trip when someone presses Add or Merge.

claude.ai and ChatGPT connect from their own servers, so they need the app on a public HTTPS address. Claude Code and Claude Desktop with a local server can use `localhost`.

## Mirror the trip to Google Calendar

The app is the source of truth. Each member who turns this on gets their own Google calendar named after the trip, kept up to date after every change. The app cannot see or touch their other calendars.

One time setup in Google Cloud Console:

1. Create a project and enable the **Google Calendar API**.
2. Under OAuth consent screen, choose External, keep it in **Testing**, and add each person's Google account as a test user. This avoids Google's verification review while only a few people use the app.
3. Add the scope `https://www.googleapis.com/auth/calendar.app.created`.
4. Create an OAuth client (Web application) with the redirect URIs `<APP_URL>/api/google/callback` and `<APP_URL>/api/auth/callback/google`.
5. Put the client id and secret in `.env.local`.

Then on a trip: **Connect**, then **Mirror to Google Calendar**.

The events Jacob's Claude created in Google Calendar earlier can be removed once the trip is in the app and mirrored. The mirror lives in its own calendar, so the two never mix.

## Layout

```
src/domain      pure rules: time zones, visibility, checks, deadlines, import matching, mirror diff
src/server      database, services (use cases), MCP server, Google client, auth
src/app         Next.js pages, server actions, routes
src/fixtures    the December 2026 trip
drizzle         SQL migrations (generated with npm run db:generate)
docs            spec, plus ARCHITECTURE.md
```
