# Trip planner

A website for putting a trip's flights, stays and plans in one place, seeing them on a timeline that handles time zones honestly, catching problems (overlapping bookings, closing cancellation windows), and sharing the trip with the people on it.

The first real user is a two person trip: New York, Tokyo, Hong Kong, Shenzhen and back, Dec 1 to 15, 2026. That trip is in `src/fixtures/december-trip.json` and is the main test case for everything.

## Read these first, in this order

0. `docs/SECURITY.md` personal data we hold, the rules for handling it, and the threat model. Security comes first.
0. `docs/ENGINEERING.md` how code is written and changed here. The rules in it are enforced by `npm run check`.
1. `docs/PRODUCT.md` what we are building, the screens, what is out of scope
2. `docs/DESIGN.md` how it must look and read. Read this before writing any UI.
3. `docs/TIME_RULES.md` how times, time zones and day boundaries work. The hardest part of the app.
4. `docs/DATA_MODEL.md` entities and fields
5. `docs/SHARING.md` accounts, roles, invites, share links, hidden items
6. `docs/IMPORT.md` getting trips in: quick add, Google Calendar, .ics, pasted emails
7. `docs/CHECKS.md` automatic problem detection and closing deadlines
8. `docs/PHASES.md` build order and what "done" means for each phase
9. `docs/ARCHITECTURE.md` how the code is organized, with diagrams and state charts
10. `docs/FEATURES.md` every user and assistant path, with the tests that prove it

## Rules that are never broken

* **Times are stored as a UTC instant plus an IANA time zone** for every start and end. Never store or compute with a bare local time. Never display a time without knowing its zone.
* **Every displayed time is local to where the thing happens.** Home time is a small secondary reference only. See `docs/TIME_RULES.md`.
* **Permissions are enforced on the server.** The API never sends a field or an item the requester is not allowed to see. Hiding something with CSS or in a component does not count.
* **Hidden items never leak.** Not in API responses, conflict messages, counts, calendar feeds, share links or activity logs for people who cannot see them.
* **Sensitive fields** (confirmation codes, booking references, phone numbers, prices, seat numbers) are never sent to viewers or to share link visitors.
* **No AI features in v1.** No LLM calls anywhere. Parsing uses structured data and simple patterns. If something cannot be parsed reliably, the user fills in a form.
* **No notifications in v1.** No email, push or SMS reminders.
* **Imports never overwrite silently.** Everything imported goes to the review inbox first.

## Stack (defaults, ask before changing)

* Next.js (App Router) with TypeScript, strict mode
* Postgres, with Drizzle ORM and migrations checked in
* Auth.js with Google, Apple and email magic link sign in. No passwords.
* Luxon for all time zone math (or Temporal if the polyfill is stable when you start). No manual offset arithmetic anywhere.
* An airport to time zone lookup from a maintained dataset (IATA code to IANA zone), not a hand typed list
* Plain CSS modules or Tailwind, whichever keeps the design rules in `docs/DESIGN.md` easiest to follow. No component library that brings its own look.
* Installable as a PWA (manifest plus icons). No offline sync in v1.
* Vitest for unit tests, Playwright for a handful of end to end flows

## How to work

* Build one phase at a time from `docs/PHASES.md`. A phase is done only when its acceptance checks pass against the fixture trip.
* Time logic and permission logic get unit tests before UI is built on them. Use the fixture trip's flights as test cases; `docs/TIME_RULES.md` lists the expected outputs.
* Design the phone layout first, then widen it for desktop.
* Use real content from the fixture in every screen and story. No lorem ipsum, no "Event title" placeholders.
* Keep UI copy short and plain. Sentence case. No emoji in the interface.
* When a rule in these docs seems wrong or a case is not covered, stop and ask rather than inventing behavior.
* Follow `docs/ENGINEERING.md`. In short: fix root causes, no comments in code, never swallow errors, no type casts or non-null assertions, respect layer boundaries, prove every feature with a test, run the app and show evidence, and keep `docs/ARCHITECTURE.md` and `docs/FEATURES.md` current in the same change.
* Run `npm run check` before calling anything done. A lint error's message says what to do instead; do it rather than working around the rule.
