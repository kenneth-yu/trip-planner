# Product

## The problem

A real trip ends up scattered across a shared calendar, Gmail generated events, airline apps and booking sites. Nobody can see the whole thing at once, time zones make "when" confusing, and the details that cost money (a cancellation window closing on Saturday, two bookings for the same nights) are buried in descriptions.

This app puts the trip in one place, shows it clearly in local time, points out what needs attention, and makes sharing with the people on the trip effortless.

## Who uses it

* **Owner.** Creates the trip, invites people, controls sharing. One per trip.
* **Editors.** Travel companions who add and change things. They need an account.
* **Viewers.** People following along (family, a friend meeting you somewhere). They can open a share link without an account, or be invited.

## What v1 does

1. Get a trip in quickly: quick add, Google Calendar import, .ics import, pasted confirmation emails, all through a review inbox.
2. Show it four ways: Now, Day by day, Timeline, Deadlines.
3. Point out problems automatically (see `CHECKS.md`).
4. Share it: invites with roles, a view link, per item visibility.

## Out of scope for v1

* AI or LLM features of any kind
* Notifications and reminders
* Route planning, travel time estimates, place search
* Booking anything
* Expenses and splitting costs
* Offline mode and a native app (the site is installable as a PWA)
* Real time co editing. Last save wins, with the activity log as the safety net.

## Screens

Each screen answers one question. If something does not help answer it, it belongs elsewhere or nowhere.

### Now (the trip's home screen)
**Question:** what's happening next?
* Shows what is happening now, and the next two or three things, in local time
* Before the trip: a countdown to departure and any deadlines that need a decision soon
* After the trip: a quiet summary and a link to the day by day view
* This is what a share link opens to on a phone

### Day by day
**Question:** what does each day look like?
* One section per calendar date where you are (rules in `TIME_RULES.md`)
* Each line: time, what it is, place. Details (codes, address, phone) appear on tap.
* Flights are cards with departure, duration and arrival
* Past days are folded by default
* Free days say "Free day" and nothing else

### Timeline (trip grid)
**Question:** where am I, and when?
* The whole trip as a calendar style grid, one column per day (see `TIME_RULES.md`, Timeline)
* Rows: where you sleep (colored by city), travel, plans, and anything unclear
* On desktop it sits at the top of the trip page. On a phone a compact day strip takes its place (see `DESIGN.md`, Phone trip screen)

### Deadlines
**Question:** what do I have to decide, and by when?
* Closing windows sorted by time, each as one plain sentence
* Each shows the deadline in local time where it applies, and in your home time when that differs
* Passed deadlines fold away

### Review inbox
**Question:** is this imported stuff right?
* Imported items waiting for approval, with suggested type, matches and conflicts
* Approve, edit, merge or discard each one

### Item editor
* One form that adapts to the type (flight, stay, plan, transfer)
* Only the fields that type needs. Optional fields stay collapsed until asked for.

### Share
* Invite by email or copy an invite link, with the role chosen first
* The view link switch, and whether it shows deadlines
* List of members and pending invites

### Trip settings
* Name, dates (derived, shown read only), owner transfer, delete trip

## Success for v1

The December trip in `src/fixtures/december-trip.json` can be imported from Google Calendar in under five minutes, and the app shows, without the user looking for them:
* the two cancellation deadlines that close in the first weekend
* the unexplained "$1,183.22" stay that overlaps the Airbnb
* that the two NH159 records are two travelers on one flight, not a conflict
* the 10 minute disagreement on the CX509 departure time
* the airport switches (Haneda in, Narita out, Narita in, Haneda out)

And a person who did not build it can answer "when do you land in Hong Kong, and what time is it in New York then?" in a few seconds.
