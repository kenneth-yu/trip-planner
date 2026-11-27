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
* See Now, Day by day and Timeline
* See deadlines only if the owner allowed it (separate switches for invited viewers and for the view link)
* Never see sensitive fields
* Cannot edit anything

Inviting is owner only in v1.

## Invites
1. Owner taps Share, picks a role (editor or viewer) and, optionally, which traveler the person is, then creates an invite link and sends it however they like. The app never sends email.
2. Whoever opens the link signs in (an account is created by signing in) and is added to the trip with that role, then lands on the trip.
3. A link works once and expires after 7 days. It is shown once; the owner sees pending invites without the link, can revoke them, and makes a new link instead of re-sending.
4. Opening a link never changes the role of someone already on the trip.

## The view link
* One switch: "Anyone with the link can see this trip", on the Share page, owner only.
* Opens straight to the Now screen. No account needed. A visitor never reaches the inbox, checks or member names beyond first names, whichever switches are on.
* Only a hash of the link is stored, so the link is shown once, when the owner turns the switch on or makes a new link. Turning the switch off and on again makes a new link; the old one stays dead.
* "Make a new link" replaces the old link atomically; the old one stops working on the next request.
* A turned off, replaced, unknown or malformed link all show the same page: "This link no longer works. Ask whoever sent it for a new one."
* Its own "Show deadlines" switch, off by default.
* Visitors see the trip in their device's time zone as the home reference, shown as "your time". The zone comes from a short lived cookie set by the page, parsed as an IANA zone, never stored; without it the page leaves "your time" out.
* "Viewers see deadlines" is a separate switch for invited viewers; neither switch changes the other.

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
