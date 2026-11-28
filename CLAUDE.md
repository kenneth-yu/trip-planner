# Trip planner

A website for putting a trip's flights, stays and plans in one place, seeing them on a timeline that handles time zones honestly, catching problems (overlapping bookings, closing cancellation windows), and sharing the trip with the people on it.

The first real user is a two person trip: New York, Tokyo, Hong Kong, Shenzhen and back, Dec 1 to 15, 2026. That trip is in `src/fixtures/december-trip.json` and is the main test case for everything.

## Read these first, in this order

0. `docs/SECURITY.md` personal data we hold, the rules for handling it, and the threat model. Security comes first.
0. `docs/ENGINEERING.md` how code is written and changed here. The rules in it are enforced by `npm run check`.
1. `docs/PRODUCT.md` what we are building, the screens, what is out of scope
2. `docs/DESIGN.md` how it must look and read. Read this before writing any UI.
3. `docs/UX.md` what each screen shows, when information appears and disappears, and how it is ordered. Read this with DESIGN.md before any UI work.
4. `docs/TIME_RULES.md` how times, time zones and day boundaries work. The hardest part of the app.
5. `docs/DATA_MODEL.md` entities and fields
6. `docs/SHARING.md` accounts, roles, invites, share links, hidden items
7. `docs/IMPORT.md` getting trips in: quick add, Google Calendar, .ics, pasted emails
8. `docs/CHECKS.md` automatic problem detection and closing deadlines
9. `docs/PHASES.md` build order and what "done" means for each phase
10. `docs/ARCHITECTURE.md` how the code is organized, with diagrams and state charts
11. `docs/FEATURES.md` every user and assistant path, with the tests that prove it

## Rules that are never broken

* **Times are stored as a UTC instant plus an IANA time zone** for every start and end. Never store or compute with a bare local time. Never display a time without knowing its zone.
* **Every displayed time is local to where the thing happens.** Home time is a small secondary reference only. See `docs/TIME_RULES.md`.
* **Permissions are enforced on the server.** The API never sends a field or an item the requester is not allowed to see. Hiding something with CSS or in a component does not count.
* **Hidden items never leak.** Not in API responses, conflict messages, counts, calendar feeds, share links or activity logs for people who cannot see them.
* **Sensitive fields** (confirmation codes, booking references, phone numbers, prices, seat numbers) are never sent to viewers or to share link visitors.
* **No AI features in v1.** No LLM calls anywhere. Parsing uses structured data and simple patterns. If something cannot be parsed reliably, the user fills in a form.
* **No notifications in v1.** No email, push or SMS reminders.
* **Imports never overwrite silently.** Everything imported goes to the review inbox first.

## The checks

Rules that can be checked are checks, not prose. `npm run check` (types, lint, tests) enforces code style, layer boundaries, UI copy (sentence case, no emoji, no filler words) and that every route handler and server action is rate limited or has a reasoned exemption. `npm run e2e` enforces accessibility on every page of the demo trips (axe, 44 px tap targets, 3:1 form borders). CI also fails a branch that lacks commits main's tooling needs. Each failure says what to do instead; do that rather than working around it. `docs/ENGINEERING.md` lists every check and the rule behind it, and holds the stack defaults and how to work.
