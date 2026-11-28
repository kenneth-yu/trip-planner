# Checks and deadlines

Checks are simple rules that run whenever the trip changes. Each finding is one plain sentence saying what is wrong and what to do. Each can be dismissed with "This is fine", after which it stays hidden until the items involved change. Dismissals belong to the trip, not a person. Every key holds the version of each item involved, so editing one of them brings the check back. "Night with nowhere to sleep" involves every stay on the trip, so changing or removing any stay brings its nights back. "Records that disagree" has no item in its key: it stays hidden until the entry is decided in the review inbox, which removes the finding.

Checks run per viewer, using only the items that viewer can see (see `SHARING.md` for hidden items and busy blocks). Viewers only see checks if they can see deadlines.

## Checks for v1

**Overlapping stays**
Two stays for the same traveler overlap by at least one night.
"Two stays overlap Dec 10 to 13: Airbnb 528 Nathan Road and 'Stay at Total (USD) $1,183.22'. Check whether one is a duplicate."

**Night with nowhere to sleep**
A night where the traveler is on the ground with no stay covering it.
"Nowhere booked for the night of Dec 8 in Shenzhen."

**Different airport for the next flight**
A flight lands at one airport and the next departure in the same city leaves from another.
"You land at Haneda on Dec 2 but fly out of Narita on Dec 5."

**City change with no transport**
Consecutive stays are in different cities with no flight or transfer between them.
"Nothing booked to get from Hong Kong to Shenzhen on Dec 6."

**Records that disagree**
Two sources for the same item disagree on a shared field (from the review inbox, if not resolved).
"Two records for CX509 disagree on departure: 8:50am and 9:00am."

**Late arrival at a hotel**
On a stay's check in day, the last flight or plan before you would get there ends after the hotel's late arrival cutoff (when one is recorded). Count a flight as ending 90 minutes after landing, for immigration and bags. The fix is either checking in earlier in the day or telling the hotel, so say both.
"Your head spa ends at 9pm and Hotel Resol asks to be told about arrivals after 9pm. Check in first or let them know."

**Plan outside the trip's places**
A plan happens in a city where the traveler is not at that time.
"Jantzen Tailor is in Hong Kong, but you are in Shenzhen at 5pm on Dec 7."

**Tight connection**
Less than a fixed buffer between landing and the next timed item (default 2 hours for anything after an international arrival, 1 hour after a domestic one).
"You land at 1:25pm and your next plan is at 2:30pm. That may be tight after immigration."

**Wrong time of day** (travel smarts)
A plan whose title says dinner, drinks, a show or a concert starts at 6:30am or earlier (breakfast, brunch or lunch at 4:00am or earlier), or a plan lands in the small hours when the same clock time in the traveler's home zone would be a normal waking hour. One tap fixes it ("Change to 6:30pm", "Use New York time"), keeping the plan's length.
"Dinner at 6:30am? Did you mean 6:30pm?"

**Risky connection** (travel smarts)
Under 60 minutes between flights on one booking at an international hub (under 90 for a change of terminal), under 3 hours between flights on separate bookings (only shown to people who can see booking details), or under 4 hours when the second flight leaves from a different airport in the same city.
"Tight: 55 min to change planes at HKG."

Both are ordinary checks: warning color, "This is fine" for the whole trip, a "Why?" explanation, and a place in Worth a look. Travel tips (leave the hotel by, bag storage) are separate: secondary color, a per person switch and per kind off switches on `/account#travel-smarts`, shown only to editors, never to viewers or view links, and never a replacement for a check.

Leave out of v1: visa and entry rules. They change and depend on nationality. Do not generate advice about them.

## Deadlines view

* Shows every deadline the viewer can see, sorted by time.
* Each line: what happens, and how long until it happens. "Hotel Resol Ueno becomes non refundable in 2 days."
* Under it, the exact time in the place it applies, and in home time if different: "Sat 11:59pm Tokyo (9:59am Sat New York)".
* Warning color only within 3 days. Passed deadlines fold into "Passed" at the bottom.
* Parsed deadlines not yet confirmed show "Check the booking terms" beside them.

## Where deadlines and checks also appear
* **Now screen:** before the trip, any deadline within 7 days and any open check, at most three lines, with a link to see all.
* **Timeline:** a small marker at each deadline's moment.
* **Item details:** the item's own deadlines.
