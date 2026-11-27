# Sharing, accounts and visibility

Sharing has to be the easiest part of the app. One tap to share, nothing to explain.

## Signing in
* Google, Apple, or a one time email link. No passwords.
* Signing in never asks for calendar access. Calendar access is requested separately, only when someone chooses to import from Google Calendar.
* After sign in from an invite, the person lands directly on the trip.

## Roles

**Owner** (exactly one)
* Everything editors can do
* Invite and remove people, change roles
* Turn the view link on or off, rotate it, choose whether it shows deadlines
* Choose whether viewers see deadlines
* Transfer ownership, delete the trip

**Editor** (signed in)
* Add, change, delete items they can see
* Import from their own calendar or emails into the review inbox, and approve inbox items
* See sensitive fields on items they can see
* See deadlines and checks

**Viewer** (invited and signed in, or anyone with the view link)
* See Now, Trip (day by day) and Timeline
* See deadlines only if the owner allowed it (separate switches for invited viewers and for the view link)
* Never see sensitive fields
* Cannot edit anything

Inviting is owner only in v1.

## Invites
1. Owner taps Share, picks a role (editor or viewer) and, optionally, which traveler the person is, then creates an invite link and sends it however they like. The app never sends email.
2. Whoever opens the link signs in (an account is created by signing in) and is added to the trip with that role, then lands on the trip.
3. A link works once and expires after 7 days. It is shown once; the owner sees pending invites without the link, can revoke them, and makes a new link instead of re-sending.
4. Opening a link never changes the role of someone already on the trip.
5. The owner can pick a person from "People from your trips" instead of making a plain link. The list holds only people who are members now of a trip the owner is a member of now, minus the owner and minus this trip's members. It shows names only (no emails, trip names, counts or dates), sorted by first name, then full name, then a keyed hash of the id, so order never reflects trip history. A person whose account name is an email address is not listed. Picking a name makes exactly the same single-use link as "Create invite link", not bound to that person, and adds nobody to the trip; "Send this link to Jacob." is only text. The button carries an opaque keyed token, never a user id, and the server re-derives the list on every pick and refuses anything outside it with the same text as a bad id.

## The view link
* One switch: "Anyone with the link can view".
* Opens straight to the Now screen. No account needed.
* "Reset link" makes a new link and breaks the old one immediately.
* Its own "Show deadlines" switch, off by default.
* Visitors see the trip in their device's time zone as the home reference.

## Hidden items
Each item has a visibility:
* **Everyone on the trip** (default)
* **Only me**
* **Specific people** (the creator picks members)

Rules:
* Hidden means hidden from everyone not chosen, **including the owner**. Otherwise a surprise for the owner is impossible.
* The creator can choose **Show as busy**. Others then see a plain "Busy" block at that time, with no title, place or details.
* Checks never reveal hidden items to people who cannot see them. If a visible item overlaps a hidden busy block, others may see "You have something else at 7pm" at most. If the hidden item is not shown as busy, it is ignored entirely in their checks.
* Hidden items are left out of counts, the calendar feed, the view link and activity history for people who cannot see them.
* If the creator leaves the trip, their hidden items are removed from the trip (ask them first).

## What the server sends (enforce in one place)
Write a single function that takes the requester (user and role, or view link) and returns the items, fields, deadlines and checks they may see. Every endpoint, page and feed uses it. Test it directly with cases for each role, hidden items, busy blocks and both deadline switches.

## Security basics
* Invite and view link tokens: at least 32 random bytes, sent once, stored hashed.
* Rate limit invite acceptance and view link access.
* All write endpoints check role on the server.
* The view link page is marked noindex.

## Later, not v1
* Letting editors invite
* A calendar subscription feed per member (respects visibility). This is phase 3 in `PHASES.md`.
