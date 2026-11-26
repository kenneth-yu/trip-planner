# Getting a trip in

Importing should take minutes and never make a mess. Everything imported lands in the review inbox first. Nothing overwrites an existing item without a person approving it.

## 1. Quick add (phase 0)
The fallback for everything, and the way to fix imports.
* **Flight:** airline, flight number, date, from and to airports, local departure and arrival times. Duration is computed. Travelers and seats per traveler.
* **Stay:** property name, address or city, check in date and time, check out date and time (defaults 3pm and 11am, marked estimated), travelers.
* **Plan:** title, place, start and end local times.
* **Transfer:** from, to, start and end (train, ferry, border crossing, car).
* Optional, collapsed: confirmation code, phone, price, notes, deadlines.
* Times are entered as local times at that place. The zone comes from the airport or location. Never ask the user for a UTC offset.

## 2. Google Calendar (phase 2)
* OAuth with the read only calendar scope, requested only when the user picks this import.
* While the app is used by a handful of people, keep the Google project in testing mode with them added as test users. This avoids Google's verification review until the app goes public.
* The user picks which calendars and a date range.
* Map each event:
  * Timed events: use the event's start and end with their time zones.
  * All day events that look like stays: dates plus default check in and check out times, marked estimated.
  * Events whose title or description contains a flight number pattern (two letter or digit airline code plus 1 to 4 digits, for example "NH159", "CX 509") become flight candidates. Fill airports from the description or location when present (IATA codes, "JFK", "Haneda").
  * Events created from Gmail often have almost no details. Import what is there and mark them needs review.
* Keep the original event (title, description, location, times, calendar name, link) on the ImportedItem for reference.

## 3. .ics files and links (phase 2)
* Upload a file or paste an .ics URL. Covers Apple Calendar, Outlook and TripIt exports.
* Same mapping rules as Google Calendar.

## 4. Pasted or forwarded confirmation emails (phase 4)
* Many booking emails include machine readable reservation data (schema.org `FlightReservation`, `LodgingReservation`, `EventReservation`, usually as JSON LD or microdata). Parse that first. It is reliable and needs no AI.
* If none is present, extract only what simple patterns can find reliably (flight number, dates, confirmation code, "free cancellation until ...") and show a prefilled form for the user to complete.
* Forwarding by email (a per user inbound address) is a later addition; pasting the email text or uploading the .eml file comes first.

## Review inbox
Each imported item shows:
* what it will become (type and title), with the type changeable
* the key fields in the same format as the day view
* a match, if it looks like something already in the trip, and the fields that differ, side by side
* actions: Add, Merge into match, Edit, Discard

Bulk actions: "Add all without conflicts".

## Matching and duplicates
An imported item matches an existing item when:
* **Flights:** same flight number and same local departure date. Times within 2 hours count as the same flight with a time difference to resolve.
* **Stays:** overlapping nights and a similar property name or address (normalize case, punctuation, common words like "hotel").
* **Plans:** same local date, overlapping times and similar title.

When matched records differ:
* If the difference is a per traveler field (seat, confirmation code) and the travelers differ, it is **not a conflict**. Merge as one flight with two travelers. (This is the NH159 case in the fixture.)
* If a shared field differs (departure time, dates), show both values and let the user choose. Never pick silently. (This is the CX509 case: 8:50am vs 9:00am.)

## Deadlines from text
Look for these patterns in descriptions and emails and propose a Deadline marked "check terms":
* "free cancellation until/before [date] [time]"
* "non refundable after [date]"
* "cancel or change by [time] [date]"
* "partial refund if cancelled before [time] [date]"

Resolve the zone from the item's location unless the text names one ("Japan time", "Shenzhen time"). If the date or time cannot be read with confidence, do not create the deadline; show the sentence in the review inbox so the user can add it.
