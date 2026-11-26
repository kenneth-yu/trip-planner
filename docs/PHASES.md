# Build phases

Each phase ends with working software someone can use. A phase is done when every acceptance check passes using `src/fixtures/december-trip.json`.

## Phase 0: Foundations
* Project setup, database, migrations, CI running tests
* Sign in (Google, Apple, email link)
* Trips, memberships, roles
* Invites (email and link), view link with rotation
* Travelers
* Item model with visibility and private fields
* The single "what can this requester see" function, with tests
* Quick add for flights, stays, plans, transfers
* A plain list of items (temporary, replaced in phase 1)
* Seed script that loads the fixture trip

**Done when**
* The fixture trip can be entered through quick add, with times shown correctly in local time
* An invited viewer and a view link visitor never receive confirmation codes, seats or prices (checked at the API level)
* An "only me" item created by an editor is invisible to the owner, and a "busy" one shows only as Busy
* Expired, revoked and used invite links are rejected

## Phase 1: Seeing the trip
* Time logic module (zone resolution, day bucketing, flight card text, home time reference) with the tests listed in `TIME_RULES.md`
* Day by day view with event rows, flight cards and arrival lines
* Now screen
* Timeline with rows, time zone dividers, home time row, now line, zoom
* Item details on tap
* PWA manifest and icons
* Phone layouts first, then desktop

**Done when**
* Every expected output in `TIME_RULES.md` passes
* The four test questions in `DESIGN.md` can be answered in a few seconds by someone who did not build it
* Nothing in the UI uses the patterns listed under "Things that make an interface look generated" in `DESIGN.md`
* Lighthouse PWA install check passes

## Phase 2: Importing
* Google Calendar import (testing mode project)
* .ics upload and URL import
* Review inbox with matching, per traveler merge and side by side differences
* Deadline extraction from descriptions
* Activity log with undo for item changes

**Done when**
* Importing the fixture's two calendars produces: the NH159 records merged as one flight with two travelers, the CX509 time difference shown for a decision, the "$1,183.22" stay flagged as overlapping, and the deadlines from descriptions proposed
* No existing item changes without an approval in the inbox

## Phase 3: Deadlines and checks
* Deadlines view
* All checks in `CHECKS.md`, with dismissal
* Deadline and view link sharing switches
* Calendar subscription feed per member, respecting visibility

**Done when**
* On the fixture, with "today" set to Nov 26, 2026: the Resol Ueno (Nov 28) and head spa (Nov 29, 10am Tokyo, shown also as Nov 28, 8pm New York) deadlines show in the warning color; the Airbnb (Dec 3) and Mumian (Dec 5) deadlines show plainly
* The overlap, airport switch, disagreeing records and missing transfer checks all appear
* A viewer with deadlines turned off sees none of the above

## Phase 4: Email import
* Paste email text or upload .eml
* schema.org reservation parsing
* Prefilled form fallback

**Done when**
* A real hotel confirmation and a real airline confirmation each import with dates, times, confirmation code and cancellation deadline correct, or fall back to a form with nothing guessed

## Later (not planned in detail)
* Notifications
* Route and travel time help, place lookup
* An AI layer for messy text and planning help
* Native or desktop app wrappers
* Expenses
