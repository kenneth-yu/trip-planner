# Time rules

The core idea: **every time is shown in the local time of the place where it happens.** Home time is a small reference, never the main time. Flights are the only things that touch two places, so they are the only things with special rules.

## Storage

* Every start and end is stored as a UTC instant plus an IANA zone, for example `2026-12-05T08:50:00+09:00` stored as `2026-12-04T23:50:00Z` with zone `Asia/Tokyo`.
* A flight's start zone is the departure airport's zone and its end zone is the arrival airport's zone. Look these up from the airport code.
* A stay has one zone, from its location.
* All arithmetic (durations, ordering, overlap) uses UTC instants. All display converts to the relevant zone.
* Never assume a fixed offset. Daylight saving time changes offsets; always let the library resolve the zone at that instant.

## "Where you are" at any moment

Several rules need to know which zone the traveler is in at a given instant. Resolve it in this order:

1. During a flight (between its start and end): **in the air**, belonging to the departure zone for date purposes.
2. Otherwise, the zone of the most recent arrival (flight or transfer end) before that instant.
3. Otherwise, the zone of a stay that covers that instant.
4. Otherwise, the traveler's home zone.

When a trip has several travelers, use the travelers the current viewer is filtering by. If not filtered, use the owner's items.

## Day boundaries

* A day is a **calendar date where you are**, from local midnight to local midnight in the zone resolved above.
* An item belongs to the day of its local start date in its own start zone.
* A flight belongs to its departure day. If it lands on a different local date, the arrival day also starts with an **arrival line** ("5:25am Landed from New York").
* A day that is entirely in the air still appears, with the flight card and "In the air for the rest of the day".
* Days run from the first item's local date to the last item's local date, with no gaps. A day with nothing on it is a "Free day".
* Stays do not create rows on every day. A stay appears as "Check in" on its first day and "Check out" on its last. Other days list where you are sleeping in the day header area only if it is not obvious (optional, decide in design review).

## Display

* Always show the city with a time when the city differs from the item above it. Use city names ("Tokyo"), not zone abbreviations ("JST").
* Home time appears after the local time in smaller secondary text, only when the home zone's offset differs from local at that instant. Add the weekday only when the home date differs.
  * Example: **8:50am** Tokyo  6:50pm Fri NY
* Each user sets their home zone in settings, suggested from the browser on sign up. Share link visitors without an account get their device's zone, labeled by city. Anyone can turn home time off.

## Flight cards

Show:
* departure local time and city
* duration (from UTC instants), as "14h 30m"
* arrival local time and city
* an arrival tag: the weekday when the local arrival date differs from the local departure date; "Same day" when it is the same date but the clock time is earlier than departure
* one sentence about the clock change, worked out from the two zones' offsets at those instants:
  * forward: "Clocks go forward 14 hours."
  * back: "Clocks go back 1 hour."
  * none: no sentence
  * prefix "Lands the next day." or "Lands the day before." when the dates differ
* home time on the arrival only

## Timeline (trip grid)

Changed on Nov 26, 2026 at the trip owner's request: a real elapsed time axis made short things (flights, one night stays) unreadable. The overview is a calendar style grid instead.

* One equal width column per calendar date where you are, the same dates as the day by day view.
* Rows: where you sleep (city blocks spanning the nights there), travel (departures and landings on the day they happen, in local time, with the clock change on each landing: "5:25am, clocks +14h"), plans (time and title), and, only when something is unclear, a row for it.
* A missing transfer between cities appears in the travel row on the day you move: "No way to Shenzhen booked".
* Weekends are shaded. Today, during the trip, is marked.
* Precise times, home time references and durations stay in the day by day view and on flight cards.
* On phones the grid is replaced by a day strip with the same days and the same city colors (see `DESIGN.md`).

## Defaults for imported all day stays

Calendar stays often have only dates. Default check in to 3:00pm and check out to 11:00am local, mark them as defaulted, and let the user change them. Never present a defaulted time as if it came from the booking (show "Check in from 3pm" style wording, or a subtle "estimated" in the detail view).

## Edge cases to handle

* Crossing the date line (both directions)
* Daylight saving changes during a trip (test with a March or November trip in the US or Europe)
* A flight arriving at a clock time earlier than it left (NH160 in the fixture)
* Overnight plans that cross local midnight (belong to their start day)
* Layovers in a third zone
* An unknown airport or location: do not guess the zone. Put the item in the review inbox and ask.

## Expected outputs from the fixture (write tests for these)

**NH159, JFK to Haneda**
* Day: Tue Dec 1 (departure). Card shows `12:55am New York, JFK`, `14h 30m`, `5:25am Tokyo, Haneda` with tag `Wed`.
* Clock sentence: "Lands the next day. Clocks go forward 14 hours."
* Arrival home time: `3:25pm Tue NY`.
* Wed Dec 2 starts with the arrival line `5:25am Landed from New York`.

**CX509, Narita to Hong Kong**
* Day: Sat Dec 5. `8:50am Tokyo, Narita`, `5h 35m`, `1:25pm Hong Kong`. No tag.
* Clock sentence: "Clocks go back 1 hour."
* Arrival home time: `12:25am NY` (same date as local arrival, so no weekday).

**CX520, Hong Kong to Narita**
* Day: Sun Dec 13. `10:30am Hong Kong`, `4h 0m`, `3:30pm Tokyo, Narita`. No tag.
* Clock sentence: "Clocks go forward 1 hour."

**NH160, Haneda to JFK**
* Day: Tue Dec 15. `10:55pm Tokyo, Haneda`, `13h 0m`, `9:55pm New York, JFK` with tag `Same day`.
* Clock sentence: "Clocks go back 14 hours."
* No home time on arrival (arrival is in the home zone).

**Head spa**
* Day: Wed Dec 2. `6:30pm` Tokyo, home reference `4:30am NY` (same date, so no weekday).

**Day list** runs Tue Dec 1 to Tue Dec 15. Thu Dec 3, Fri Dec 4, Mon Dec 7 to Wed Dec 9, Fri Dec 11, Sat Dec 12 and Mon Dec 14 show only what the fixture has on them (several are free days).
