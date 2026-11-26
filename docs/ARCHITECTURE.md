# Architecture

This file explains intent. The code carries no comments (see `docs/ENGINEERING.md`); when you need to know why something is the way it is, it should be here or in a test name.

## Goals this architecture serves

1. **The app is the single source of truth for the trip.** Google Calendar, Gmail and AI assistants feed it or copy it. They never hold the master copy.
2. **Anyone can put details in, nothing goes in unreviewed.** People type into quick add. Calendars, files and AI assistants (Claude, ChatGPT) send proposals to a review inbox. A person approves.
3. **Each person sees only what they may see, everywhere.** One function decides visibility, and every screen, API, feed, calendar mirror and assistant goes through it.
4. **Times are honest.** Every instant is stored in UTC with the zone of the place it happens. Display is always local to that place.
5. **Every rule is testable without a browser, a network or a database server.**

## System context

```mermaid
flowchart LR
  subgraph People
    K[Kenny<br/>owner]
    J[Jacob<br/>editor]
    V[Family<br/>viewer or view link]
  end
  subgraph Assistants
    C[Claude]
    G[ChatGPT]
  end
  subgraph App[Trip planner]
    UI[Web app / PWA]
    MCP[MCP endpoint<br/>/api/mcp]
    INBOX[(Review inbox)]
    TRIP[(Trip: items, travelers,<br/>deadlines)]
  end
  GC[Google Calendar<br/>one calendar per member]
  GM[Gmail]

  K & J -->|quick add, approve| UI
  V -->|read| UI
  GM -. read by .-> C
  C & G -->|propose items<br/>read trip| MCP
  MCP --> INBOX
  UI -->|approve / merge / discard| INBOX
  INBOX -->|on approval only| TRIP
  UI -->|quick add| TRIP
  TRIP -->|one way mirror| GC
```

What changed from how the trip was planned before: Jacob's Claude used to read Gmail and write Google Calendar events directly. Now it writes to the app through MCP. Those proposals wait in the inbox, and Google Calendar becomes a read only copy that the app keeps up to date.

## Layers

```mermaid
flowchart TB
  subgraph Web[src/app: Next.js pages, server actions, route handlers]
    P[Pages]
    A[Server actions]
    R[Routes: /api/mcp, /api/google/*]
  end
  subgraph Adapters[src/server: adapters]
    WEB[web.ts / app-context.ts<br/>session to Requester]
    MCPS[mcp/server.ts<br/>tools to services]
    GAPI[google/calendar-api.ts<br/>REST client + fake]
    OAUTH[google/oauth.ts]
  end
  subgraph Services[src/server/services: use cases]
    TS[trip-service]
    IS[inbox-service]
    MS[mirror-service]
    AS[assistant-service]
  end
  subgraph Persistence[src/server/repo + db]
    REPO[trip-repo]
    DB[(Postgres or PGlite<br/>Drizzle schema + migrations)]
  end
  subgraph Domain[src/domain: pure, no I/O]
    VIS[visibility/project<br/>THE permission function]
    TIME[time: places, format,<br/>flight cards, days]
    IMP[import: patterns, calendar mapping,<br/>matching, quick add schema]
    CHK[checks]
    DL[deadlines]
    MIR[mirror: desired events + diff]
  end

  P & A --> WEB --> Services
  R --> MCPS --> Services
  R --> OAUTH
  Services --> REPO --> DB
  Services --> Domain
  MS --> GAPI
```

Dependency rule: arrows point inward. `src/domain` imports nothing from `src/server` or `src/app`, and does no I/O. Services get everything external (database, clock, id generator, Google client, the change hook) through `ServiceContext`, so tests pass a fresh embedded database, a fixed clock and a fake Google.

| Layer | Tested with | Why it is shaped this way |
|---|---|---|
| Domain | Plain unit tests against the fixture trip | The hard rules (time zones, visibility, matching) must be correct before any UI sits on them |
| Services | Integration tests on in-memory PGlite (real Postgres SQL) | Transactions, constraints and races are real; no database server needed |
| MCP | The official MCP client over an in-memory transport | Proves the assistant experience, not just the functions |
| Routes and pages | Running the app and calling `/api/mcp` over HTTP | Thin glue only |

## The permission boundary

```mermaid
flowchart LR
  REQ[Requester<br/>member user id or view link<br/>no role field] --> PROJ
  AGG[(TripAggregate<br/>everything stored)] --> PROJ{{projectTrip}}
  PROJ --> VIEW[TripView<br/>only what this requester may see]
  VIEW --> DAYS[Day view]
  VIEW --> DLS[Deadlines]
  VIEW --> CHECKS[Checks]
  VIEW --> MIRROR[Google mirror events]
  VIEW --> MCPOUT[Assistant get_trip]
  VIEW --> MATCH[Import matching]
```

- Roles are always read from the stored membership. The requester never carries a role, so a caller cannot claim one.
- Hidden items are absent from the view, not flagged. Items shown as busy become `BusyBlock`s with a start and an end and nothing else: no id, no title.
- Sensitive fields are absent unless the role is owner or editor. The Google mirror also leaves them out by default, because a Google calendar can be shared beyond the app's control.
- Checks, deadlines, the mirror, assistant reads and import matching all take a `TripView`, so they cannot see more than the person they act for.

## Getting data in: one pipeline, many sources

```mermaid
flowchart LR
  QA[Quick add form] -->|ItemInput schema| QP[inputToProposal]
  AI1[Assistant add_items] -->|ItemInput schema| QP
  GCAL[Google Calendar import] --> MAP[mapCalendarEvent]
  ICS[.ics file] --> MAP
  AI2[Assistant import_calendar_events] --> MAP
  QP --> PROP[ProposedItem]
  MAP --> PROP
  PROP --> CONS[consolidate<br/>merge duplicates inside the import]
  CONS --> MATCH[matchAgainst<br/>existing visible items]
  MATCH --> INBOX[(Inbox entries)]
  QA -. typed by a person .-> ITEM[(Item)]
  INBOX -->|person approves| ITEM
```

- A person typing into quick add is trusted and goes straight in. Everything else goes to the inbox.
- Zones come from airports and cities, never from the source's claimed zone. Gmail events often carry the calendar owner's zone; the fixture's CX509 claims New York.
- When a zone cannot be known, the proposal carries a `problem`, is marked needs review, and is never added in bulk.
- Two kinds of disagreement are kept apart:
  - `differences`: records inside one import disagree (CX509 at 8:50am vs 9:00am). A person must pick before adding.
  - `match.differences`: the import disagrees with an item already on the trip. A person must pick per field to merge.
- Per traveler fields (seat, confirmation code) never conflict. They become one private row per traveler, which is the NH159 case.

## State charts

### Inbox entry

```mermaid
stateDiagram-v2
  [*] --> Pending: import / assistant proposal
  Pending --> Pending: Add or Merge without a choice<br/>(NeedsDecision, nothing written)
  Pending --> Approved: Add<br/>[every import difference chosen]
  Pending --> Merged: Merge into item<br/>[every field difference has keep]
  Pending --> Discarded: Discard
  Approved --> [*]
  Merged --> [*]
  Discarded --> [*]

  note right of Pending
    Claimed with one conditional UPDATE
    WHERE state = 'pending'.
    The second of two concurrent decisions
    finds nothing to claim and fails.
  end note
```

"Add all without conflicts" applies Add only to entries with no match, no differences and no problems.

### Item (as seen by one member)

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Visible: visibility = everyone,<br/>or creator,<br/>or listed in specific
  [*] --> Busy: hidden and showAsBusy
  [*] --> Absent: hidden, not busy
  Visible --> Busy: creator hides it, shows as busy
  Visible --> Absent: creator hides it
  Busy --> Visible: creator shares it
  Absent --> Visible: creator shares it
```

Only the creator can move an item between these states. That includes the owner, who cannot see or edit an item someone else hid from them.

### Google Calendar mirror (per member, per trip)

```mermaid
stateDiagram-v2
  [*] --> Off
  Off --> Connecting: Mirror to Google Calendar
  Connecting --> Off: consent denied or scope missing
  Connecting --> InSync: tokens stored, calendar created,<br/>first sync
  InSync --> Syncing: trip changed (after response)<br/>or Sync now
  Syncing --> InSync: all ops applied<br/>lastError cleared
  Syncing --> Failed: Google error<br/>lastError recorded, applied ops kept
  Failed --> Syncing: next change or Sync now<br/>(resumes from the event map, no duplicates)
  InSync --> Off: Stop mirroring
  Syncing --> TornDown: member left the trip<br/>(desired set is empty)
  TornDown --> [*]: all events deleted, mirror disabled
```

Sync is a diff. `buildMirrorEvents(view)` gives the events the calendar should hold, and `planMirrorSync` compares them with `mirror_events`, the event map of what was last pushed and its hash. The result is the minimal set of creates, updates and deletes. If someone deletes an event in Google, it is recreated on the next change: Google is a copy, the app is the source.

### Assistant connection

```mermaid
stateDiagram-v2
  [*] --> Active: Make a link<br/>(token shown once, stored hashed)
  Active --> Active: tool call<br/>(lastUsedAt updated)
  Active --> Revoked: Disconnect
  Revoked --> [*]
  state Active {
    [*] --> Propose: "Can suggest items" (editors)
    [*] --> Read: "Read only" (any member)
  }
```

## Sequences

### Jacob's Claude adds a booking from Gmail

```mermaid
sequenceDiagram
  actor Jacob
  participant Claude
  participant Gmail
  participant MCP as /api/mcp/{token}
  participant Inbox as inbox-service
  actor Kenny
  participant Trip as trip items
  participant Mirror as mirror-service
  participant GCal as Google Calendar

  Jacob->>Claude: "Add my Tim Ho Wan booking to the trip"
  Claude->>Gmail: search confirmation email
  Claude->>MCP: get_trip(trip_id)
  MCP-->>Claude: itinerary in local times (Jacob's view)
  Claude->>MCP: add_items([{type: plan, city: Hong Kong, startLocal: 2026-12-11T11:00}])
  MCP->>Inbox: importProposals (zone from city, match against trip)
  MCP-->>Claude: "Sent 1 item to the review inbox."
  Kenny->>Inbox: Add
  Inbox->>Trip: save item, log activity
  Trip-->>Mirror: onTripChanged (after response)
  Mirror->>GCal: insert event (11:00 Asia/Hong_Kong, no reminders)
```

### Connecting Google Calendar

```mermaid
sequenceDiagram
  actor Kenny
  participant App
  participant Google as Google OAuth
  participant GCal as Google Calendar API
  Kenny->>App: Mirror to Google Calendar
  App->>Google: authorize (scope calendar.app.created, signed state)
  Google-->>App: code
  App->>Google: exchange code (refresh token)
  App->>App: encrypt refresh token (AES-256-GCM), store
  App->>GCal: create "Asia, December 2026 (Trip planner)" calendar
  App->>GCal: insert one event per visible item
```

The scope `calendar.app.created` lets the app manage only calendars it created. It cannot read or change anything else in the person's Google Calendar.

## Data model (stored)

```mermaid
erDiagram
  users ||--o{ memberships : has
  trips ||--o{ memberships : has
  trips ||--o{ travelers : has
  trips ||--o{ items : has
  items ||--o{ item_private : "per traveler, sensitive"
  items ||--o{ deadlines : has
  trips ||--o{ import_batches : has
  import_batches ||--o{ imported_items : contains
  trips ||--o| share_links : has
  trips ||--o{ invites : has
  trips ||--o{ activity : logs
  users ||--o{ assistant_tokens : owns
  users ||--o| google_connections : has
  trips ||--o{ calendar_mirrors : "one per member"
  calendar_mirrors ||--o{ mirror_events : "event map"
```

## Decisions

| Decision | Why | Revisit when |
|---|---|---|
| AI assistants connect over MCP, and the app makes no LLM calls | Keeps the v1 rule "no AI features" inside the app: the assistant is a client, like a calendar import. People use the Claude or ChatGPT they already have | An AI layer inside the app is planned (PHASES.md, Later) |
| Assistant writes always go to the review inbox | "Imports never overwrite silently". Also protects against an assistant misreading an email | Never, for writes. Reads are fine |
| Assistant auth is a secret link (token in the URL), also accepted as a Bearer header | Claude and ChatGPT custom connectors accept a URL with no auth or with OAuth; a secret URL works in both today. Tokens are hashed, scoped to a trip, read or propose, and revocable | Add OAuth 2.1 to the MCP endpoint so connectors can sign in without a secret link |
| Google mirror is one way, app to Google, one calendar per member | One source of truth. Per member, because visibility differs per member | Two way sync is not planned: edits belong in the app |
| Mirror scope `calendar.app.created` | Least privilege: no access to the person's other calendars | n/a |
| Mirrored events have no reminders and do not include codes or seats by default | v1 has no notifications; a Google calendar can be shared beyond the app's permissions | Per member setting `includeSensitive` exists and is off |
| PGlite for dev and tests, Postgres in production | Same SQL and migrations; nobody installs a database to run tests | Never for prod: PGlite is single process |
| Signed cookie session with a dev sign in | Lets the app run and be tested now | Replace with Auth.js (Google, Apple, email link) per CLAUDE.md before anyone but the builders uses it |

## Open questions (need an answer from the trip owner)

1. **"Where you are" order.** TIME_RULES says most recent arrival beats a covering stay. On Dec 6 to 10 there is no transport to Shenzhen, so that rule would say "Hong Kong" while sleeping in Shenzhen. The code uses whichever is newer, the arrival or the stay's check in. Confirm.
2. **The Gmail "Queen beds" stay.** The fixture says it should merge into the Airbnb, but IMPORT.md's matching rules (similar name or address) do not match it. It is shown as a possible match for a person to merge. Confirm that is the intended behavior.
3. **The $1,183.22 stay also overlaps the second Resol Ueno booking on Dec 13.** The fixture's expected checks do not list that overlap, but it is true, so the app reports it.
4. **Whose seat is it?** When a shared calendar record has a seat but several travelers, the seat goes to the one traveler on that record who has no seat yet. Otherwise it stays unassigned. That is how NH159 resolves to 30K Kenny, 30C Jacob.
