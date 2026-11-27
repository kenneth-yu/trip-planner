# Feature map

Every path a person or an assistant can take through the app, where it lives, and the tests that prove it. When behavior changes, update this table in the same change. A feature without a test in the last column is not done.

| Who | Path | Entry point | Service | Proven by |
|---|---|---|---|---|
| Member | See the trip day by day in local time | `/trips/[id]` | `getTripView` then `buildDays` | `days.test.ts`, `flight-card.test.ts` |
| Member | See the whole trip as a day grid: where you sleep, travel with clock changes, plans, missing transfers, unclear bookings | `/trips/[id]` on desktop | `buildTripGrid`, `missingTransfers`, `pickDay` | `trip-grid.test.ts` |
| Member | On a phone, see what is next and pick a day from a strip | `/trips/[id]` on phone | `upNext`, `dayStrip` | `trip-grid.test.ts` |
| Member | On desktop, see what to decide and what to check beside the day list | `/trips/[id]` (1000px and wider) | `loadAttention` | `deadlines.test.ts`, `checks.test.ts` |
| Member | See deadlines and problems | `/trips/[id]/deadlines` | `buildDeadlineLines`, `runChecks`, `disagreementFindings` | `deadlines.test.ts`, `checks.test.ts`, `services.test.ts` |
| Editor | Add a flight, stay, plan or transfer in local time, with place hints and a next day arrival; a repeated submit adds it once; lands on the item's day marked Added | `/trips/[id]/add`, Add in the trip nav | `parseItemForm`, `quickAddItem`, `placeHint` | `item-form.test.ts`, `create-trip.test.ts`, `quick-add.test.ts`, `services.test.ts`, `nav.test.ts` |
| Anyone | Sign in with Google (verified email links to an existing person) | `/sign-in`, `/api/auth/*` | `buildAuthConfig`, `createAdapter` | `flow.test.ts`, `adapter.test.ts`, `providers.test.ts` |
| Anyone | Sign in with Apple, when `AUTH_APPLE_ID` and `AUTH_APPLE_SECRET` are set | `/sign-in` | `buildAuthConfig` | `providers.test.ts`, `flow.test.ts` |
| Anyone | Sign in with an emailed link (15 minutes, works once), when `EMAIL_API_KEY` and `EMAIL_FROM` are set or in local dev | `/sign-in` | `httpEmailSender`, `createAdapter` | `flow.test.ts`, `email.test.ts`, `adapter.test.ts` |
| Anyone | A signed out deep link returns to its page after sign in; `next` never leaves the site | `/sign-in?next=` | `safeNextPath`, `requireUser` | `next-path.test.ts`, `web.test.ts` |
| Signed in person | Stay signed in while using the app: the cookie lasts 400 days, the stored session rolls on a 30 day window | every page | `lookupSession` | `adapter.test.ts`, `session-machine.test.ts`, `auth.test.ts` |
| Signed in person | Sign out (session row and cookie deleted) | home, Sign out | `signOutAction` | `flow.test.ts`, `home.test.ts` |
| Signed in person | Opening a trip that is not theirs, or does not exist, shows the same "This trip is not on your account." page | `/not-on-your-account` | `loadTripPage` | `web.test.ts` |
| Developer | Demo accounts sign in, development and previews only (refused in production) | `/sign-in` "Demo accounts", `/api/dev/sign-in`, `/api/dev/outbox` | `devSignInEnabled` | `auth.test.ts`, `dev-routes.test.ts`, `home.test.ts` |
| Signed in person | Create a trip | `/trips/new` | `createTrip` | `create-trip.test.ts` |
| Editor | An empty trip offers Add flight or stay; viewers see a plain sentence | `/trips/[id]` | `DayView` | `empty-trip.test.ts` |
| Editor | Review imported items: add, merge, discard, add all clean | `/trips/[id]/inbox` | `approveEntry`, `mergeEntry`, `discardEntry`, `approveAllClean` | `services.test.ts`, `pipeline.test.ts` |
| Editor | Import calendar events | service (Google and .ics UI pending) | `importCalendarEvents` | `pipeline.test.ts`, `services.test.ts` |
| Member | Connect Claude or ChatGPT; Disconnect again on a stale page shows it as disconnected | `/trips/[id]/connect` | `createAssistantToken`, `revokeAssistantToken` | `server.test.ts`, `actions.test.ts` |
| Assistant | Read trips and the itinerary | `/api/mcp` `list_trips`, `get_trip` | `getTripView` | `server.test.ts` |
| Assistant | Propose items (structured) | `/api/mcp` `add_items` | `importProposals` | `server.test.ts` |
| Assistant | Propose calendar-shaped events | `/api/mcp` `import_calendar_events` | `importCalendarEvents` | `server.test.ts` |
| Assistant | Read the review inbox | `/api/mcp` `list_review_inbox` | `listInbox` | `server.test.ts` |
| Member | Mirror the trip to Google Calendar | `/trips/[id]/connect`, `/api/google/*` | `enableMirror`, `syncMirror`, `syncTripMirrors` | `mirror-service.test.ts`, `calendar-mirror.test.ts`, `auth.test.ts` |
| Creator | Hide an item, or show it only as busy | `/trips/[id]/add` (Who can see this); editing pending | `quickAddItem` sharing, `updateItem` | `project.test.ts`, `services.test.ts`, `checks.test.ts`, `calendar-mirror.test.ts` |
| Developer | Try the UI on an empty, a sparse and a packed trip | `npm run db:seed`, then the home page | `seedEverything`, `src/fixtures/demo-trips.ts` | `demo-trips.test.ts`, `services.test.ts` (seeding) |
| Anyone adding items | Places resolve to a time zone on their own (airports, about 7,000 cities, country, optional address lookup); unclear ones are flagged, never guessed silently | quick add, `add_items`, calendar import | `resolvePlace`, `placeZone`, `placeContextFor`, `unsurePlace` check | `resolve-place.test.ts`, `quick-add.test.ts`, `places.test.ts` |
| Anyone | View link, invites, roles | not built | | |
| Anyone | Now screen | not built | | |
