# Design

This app is for people, often tired and in an airport, glancing at a phone. Every screen should be simple, calm and obvious. It should feel like something a careful person designed, not something generated.

Every element must have a reason to exist. When writing a component, be able to say in one sentence what the user would miss if it were removed. If you cannot, remove it.

## Principles

1. **One question per screen.** See the screen list in `PRODUCT.md`.
2. **Open to now, not everything.** Lead with what is next. Fold the past. Put details (codes, addresses, phone numbers) behind a tap.
3. **Say it like a person.** "Non-refundable after Saturday", not "Cancellation policy: free until 11/28 23:59". "About 45 min", not "47 minutes".
4. **Color means something or it is not there.** City colors for stays. One warning color for things that need action. Nothing decorative.
5. **Quiet until it matters.** A deadline is plain text until it is within 3 days, then it turns to the warning color. If everything is highlighted, nothing is.
6. **Nothing to show means nothing shown.** No empty fields, no "N/A", no "No events" boxes. A free day says "Free day".
7. **Show each fact once.** If it is on the day view, it is not repeated in a summary above it.

## Things that make an interface look generated. Do not use them.

* Rows of big number stat tiles ("4 flights", "13 nights")
* Gradients, glows, heavy shadows, glassy blur
* Emoji, or an icon in front of every heading or label
* Badges and pills on everything
* Cards inside cards, or every item in its own identical rounded box
* A centered hero with a slogan
* A purple or indigo accent by default
* Legends that explain colors the items could label themselves
* Filler copy: "Seamlessly manage your journey", "Your adventure awaits"
* Uppercase tracked labels above headings

## What to do instead

* **Borrow from real travel objects.** Boarding passes, departure boards and paper itineraries already solved this: the time is big, the city is small, the rest is quiet. Use that hierarchy.
* **Let type do the work.** Separate things with size, weight and space before reaching for borders and boxes. Lists are rows divided by a fine rule, not stacks of cards.
* **Pick a typeface for numbers.** The app is mostly times. Choose one with clear, distinct figures and tabular figures for aligned columns. One family, two weights, about four sizes.
* **Design with the real trip.** Awkward real cases (a flight that lands "before" it left) only show up with real data.
* **Check every screen at every size.** `npm run db:seed` adds the December trip, an empty trip, a sparse weekend and a packed week with four travelers. A screen is done when it reads well on all four.

## Visual system

### Type
* One sans serif family with good figures. Two weights: regular and bold.
* Sizes: large for the key time on a card, a heading size, body (16 to 17px), small (13 to 14px) for secondary text. Nothing under 13px.
* Times use tabular figures and never wrap.

### Color
* Ground: white (and a deep near black for dark mode). Text: near black (and near white).
* One secondary text color for supporting information.
* City colors: one per city on the trip, assigned automatically from a small fixed palette chosen to be distinct and readable in both modes. Used for stay bars and a thin marker beside stay rows. Nowhere else.
* Flights: the text color. A flight is a neutral object, not a city.
* Warning: one color, used only for things that need action soon.
* Gaps: a light hatch, never a solid fill.

### Layout
* Phone first. Single column. Generous line height.
* Desktop: the day view stays a readable column; the timeline uses the full width.
* Respect safe areas when installed as a PWA.

### Motion
* One purposeful transition at most (for example a day folding open). Nothing animates on load. Respect reduced motion.

## Components

Each component lists what it shows and why.

### Day header
* Date ("Sat Dec 5") and where you are ("Tokyo to Hong Kong" on travel days, "Tokyo" otherwise).
* Why: you navigate by date, and the place tells you which local time applies.

### Event row
* Time on the left (local, large enough to scan), title, and place underneath in secondary text.
* Home time after the local time in small secondary text, only when it differs from local. The day name is added only when the home date is different.
* Tap to open the item's details page: address, confirmation code (if allowed), phone, notes, source. Rows do not expand in place; one tap, one level (see `UX.md`).
* When the app is not sure where something is, the row says "Check where this is" in the warning color, and the details say why and what to add.
* Why: the time is what people scan for; everything else is on demand.

### Flight card
* Line 1, small: flight number and airline.
* Line 2: departure time big, city and airport small. Duration in the middle ("14h 30m"). Arrival time big, city and airport small.
* A tag on the arrival only when it is a different local date ("Wed"), or a "Same day" tag when the arrival clock time is earlier than the departure.
* One line underneath in plain words about the clock: "Lands the next day. Clocks go forward 14 hours." or "Clocks go back 1 hour."
* Home time on the arrival only.
* Why: these are the three questions people have about a flight: when do I leave, how long is it, when do I get there in local time.

### Arrival line
* On the day you land, when it is a different date from departure: "5:25am  Landed from New York". Small, secondary.
* Why: each day reads on its own without scrolling back.

### Phone trip screen
* Opens on what is next: alerts for new items and decisions due soon, then the next three things with how long until each.
* A day strip replaces the grid: one small chip per day with the date, a thin bar in the city color of where you sleep, a dot when something is planned and a red dot when something needs a look. Tap a chip to see that day.
* Each day sits in its own soft panel, with the date pinned at the top while you scroll it.
* Why: on a small screen people need one thing at a time. The strip keeps the shape of the trip in view without the weight of the grid.

### Trip grid (timeline)
* One column per day, rows labeled in plain words: Sleeping in, Travel, Plans, Not sure yet.
* City blocks carry their own name and nights, so no legend is needed. The clock change rides on each landing: "Land in Tokyo, 5:25am, clocks +14h".
* Each travel item and plan sits in its own soft, rounded bubble. A missing transfer gets a softly red bubble.
* Each row has a faint neutral tint, and soft day lines run the full height, so rows and days are easy to follow. The tints are near-neutral so they never read as city colors.
* A cell shows at most three plans, then "+N more". The grid is the shape of the trip, not the full list.
* The chosen day is gently highlighted, and its full detail appears below the grid.
* Days are at least about 7rem wide and at most 12rem. Long trips scroll sideways with the row names pinned on the left; short trips stay compact instead of stretching.
* A row with nothing in it for the whole trip is not drawn.
* Why: people read a trip by day. Every label fits in its own cell and nothing floats.

### Deadline line
* One sentence: "Hotel Resol Ueno becomes non refundable in 2 days" with the exact time beneath: "Sat 11:59pm Tokyo (9:59am Sat New York)".
* Warning color only within 3 days.
* Why: people need to know what happens and how long they have.

### Check line
* One sentence describing the problem and what to do: "Two stays overlap Dec 10 to 13. Check whether the $1,183.22 booking is a second reservation."
* A way to dismiss it ("This is fine") so it stops showing.

## Copy

* Sentence case everywhere. No exclamation marks. No "please", "simply", "successfully".
* Buttons are verbs: "Add flight", "Invite", "Copy link".
* Times as people say them: "8:50am", "noon", "midnight". Durations rounded sensibly: "14h 30m", "about 45 min".
* Places by city first, airport second: "Tokyo, Narita".
* Errors say what happened and what to do: "That link has expired. Ask the trip owner for a new one."
* Empty states invite: "Add your first flight or stay" with one button.

## Testing the design

* For every screen, write down the question it answers. Hand the phone to someone who has not seen it and ask that question. They should answer in a few seconds.
* Standard test questions using the fixture trip:
  * "When do you land in Hong Kong, and what time is it in New York then?"
  * "What do you have to decide this weekend?"
  * "Where are you sleeping on Dec 8?"
  * "How long is the flight home?"
