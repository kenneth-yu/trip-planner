# Feature map

Every path a person or an assistant can take through the app, where it lives, and the tests that prove it. When behavior changes, update this table in the same change. A feature without a test in the last column is not done.

| Who | Path | Entry point | Service | Proven by |
|---|---|---|---|---|
| Member | See the trip day by day in local time | `/trips/[id]` | `getTripView` then `buildDays` | `days.test.ts`, `flight-card.test.ts` |
| Member | See deadlines and problems | `/trips/[id]/deadlines` | `buildDeadlineLines`, `runChecks`, `disagreementFindings` | `deadlines.test.ts`, `checks.test.ts`, `services.test.ts` |
| Editor | Quick add a flight, stay, plan or transfer | form or API (UI pending) | `quickAddItem` | `quick-add.test.ts`, `services.test.ts` |
| Editor | Review imported items: add, merge, discard, add all clean | `/trips/[id]/inbox` | `approveEntry`, `mergeEntry`, `discardEntry`, `approveAllClean` | `services.test.ts`, `pipeline.test.ts` |
| Editor | Import calendar events | service (Google and .ics UI pending) | `importCalendarEvents` | `pipeline.test.ts`, `services.test.ts` |
| Member | Connect Claude or ChatGPT | `/trips/[id]/connect` | `createAssistantToken`, `revokeAssistantToken` | `server.test.ts` |
| Assistant | Read trips and the itinerary | `/api/mcp` `list_trips`, `get_trip` | `getTripView` | `server.test.ts` |
| Assistant | Propose items (structured) | `/api/mcp` `add_items` | `importProposals` | `server.test.ts` |
| Assistant | Propose calendar-shaped events | `/api/mcp` `import_calendar_events` | `importCalendarEvents` | `server.test.ts` |
| Assistant | Read the review inbox | `/api/mcp` `list_review_inbox` | `listInbox` | `server.test.ts` |
| Member | Mirror the trip to Google Calendar | `/trips/[id]/connect`, `/api/google/*` | `enableMirror`, `syncMirror`, `syncTripMirrors` | `mirror-service.test.ts`, `calendar-mirror.test.ts`, `auth.test.ts` |
| Creator | Hide an item, or show it only as busy | service (UI pending) | `quickAddItem` sharing, `updateItem` | `project.test.ts`, `services.test.ts`, `checks.test.ts`, `calendar-mirror.test.ts` |
| Anyone | View link, invites, roles | not built | | |
| Anyone | Now screen, timeline | not built | | |
