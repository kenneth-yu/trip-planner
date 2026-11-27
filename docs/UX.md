# UX: what we show, when, and how

This sits beside `DESIGN.md`. DESIGN.md says how things look. This file says which facts reach the screen, at what moment, and in what order. The UX lead owns it. Specs in `.pipeline/specs/` apply it to each package, and the UX review checks every user-facing PR against it.

The people using this app are travelers. Some are glancing at a phone in a taxi, at an airline counter or in a hotel lobby, often tired and on bad data. Some are planning at a desk at home. The phone case decides. The desktop uses its extra width to show the shape of the trip, never to show more detail.

Standards we cite: WCAG 2.2 AA as the floor; Nielsen's ten heuristics; Apple HIG and Material for touch, navigation and safe areas; progressive disclosure.

## Rules

1. **The fact a person came for is the largest thing on the screen.** On a trip that is a time; at a counter it is a code. Titles are smaller than the times they belong to.
2. **One level of disclosure.** A row either answers the question or opens the page that does. Never a tap that reveals a link to tap.
3. **Show each fact once per screen.** When the day header says "Tokyo", the rows under it do not. A check that a bubble already shows is not repeated in a list beside it.
4. **Time decides what is visible.** Each kind of information has a moment it starts to matter and a moment it stops. Between those moments it can be seen. Outside them it waits behind a tap or is gone. The table below lists the moments.
5. **State decides what is highlighted.** The warning color means "act within 3 days". A problem further away is plain text in its own place. Nothing is tinted just because it exists.
6. **Navigation never loses your place.** Going into something and coming back returns you to the same day, scrolled to where you were. Choosing a day shows that day without a scroll.
7. **One filled button per view.** It is the thing most people should do next. Everything else is quiet. Destructive actions are never the filled button, and never sit right next to the thing that cancels them.
8. **Controls exist only for people who can use them.** No disabled buttons, nothing greyed out, no "Only editors can..." in place of a control. Viewers see a trip, not a list of things they cannot do.
9. **Every message says what happened and what to do,** in the words of DESIGN.md's copy rules.
10. **Phone first, then widen.** Phones: one column, at most one alert, at most three upcoming things before the day. Desktop: the trip grid across the top, then two columns. Text columns never wider than 40rem.

## When information appears and disappears

| Information | Hidden until | Visible at a glance | Gone or folded when |
|---|---|---|---|
| Decision deadline | always listed on Deadlines | in the warning color, on the trip page, when within 3 days | it passes: folds into "Already passed" on Deadlines |
| Check (overlap, missing transfer, airport switch, late arrival, wrong city) | always listed on Deadlines | on the trip page when it concerns the next 14 days, or the trip starts within 14 days | dismissed ("This is fine", WP-17) or the items change so it no longer applies |
| Inbox entries | none | one alert on the trip page while any are pending; the nav shows "Inbox (2)" | the last one is decided: the alert and the count vanish |
| Up next (phone) | none | before and during the trip: the next three things with "in 4 days" or "in 2 hours" | after the trip: replaced by one line, "You were back on Dec 15." |
| Countdown | none | before the trip: "You leave in 4 days" | the trip starts: becomes "Day 3 of 15" |
| Codes, seats, phone, price | the item's details page, one tap from any row | never on rows, grid or Up next | never |
| Home time | none | small and secondary, after the local time, only where the place's zone differs from home (DESIGN.md, Event row); the day name only when the home date differs | never |
| Past days | a tap on the folded day | no | at the end of each local day they fold |
| "Added" marker | none | on the row just added | the next navigation |
| "Saved", "Deleted", "You joined as an editor." | none | once, at the top, `role="status"` | the next navigation or tap |
| Invite link | none | once, right after it is made | the page is left: it can never be shown again |

## Screens

Each screen answers one question. What follows is what answers it, in order, what waits for a tap, and what is left out on purpose.

### Your trips (`/`)
- **Question:** which trip?
- **Shows:** each trip's name with its dates beneath in secondary text ("Dec 1 to 15", or "No dates yet"). Trips sorted with the current one first, then upcoming by date, then past trips under "Past trips". The current trip says "Now" and upcoming trips say "In 4 days" in secondary text.
- **Primary action:** "New trip", as the one filled button.
- **Left out:** counts of items or travelers, cover images. "Sign out" is a quiet link at the bottom, never a filled button.

### Trip, phone (`/trips/[id]`, under 1000px)
- **Question:** what's next, and what does my day look like?
- **Order:** trip name, one line of dates and countdown; the nav; at most one alert; Up next (three rows); the day strip; the chosen day in its panel.
- **Alert:** when something is pending, one alert. Order of precedence: deadlines within 3 days, then inbox entries, then checks in the next 14 days. It shows the most urgent sentence and "and 2 more" beneath. The warning tint is used only for deadlines within 3 days. Inbox entries and checks use the neutral soft panel.
- **Day strip:** choosing a chip shows the chosen day without leaving the scroll position. It scrolls the day panel into view, or swaps the day in place and keeps the strip pinned. A chip's "needs a look" marker is a shape (a ring) as well as a color (WCAG 1.4.1).
- **Rows:** time (with home time beneath, small, only when the zone differs from home), then title, then a place only when it differs from the day header's place. Tapping a row opens the item's details page (rule 2).
- **Left out:** the route line (the strip's city bars carry it), the grid.

### Trip, desktop (1000px and wider)
- **Question:** where am I, and when?
- **Order:** trip name with dates and countdown; nav; the grid at full content width; below it, the chosen day (left, wider column) and the attention panel (right, narrower).
- **Grid:** fits the trip without sideways scrolling whenever the window can hold every day at the minimum day width. The content cap widens to the window for the grid only. Text in cells is never under 13px (DESIGN.md type floor).
- **Attention panel:** at most five lines: deadlines within 3 days, then checks in the next 14 days, then "See 6 more" to Deadlines. A check that the grid already shows as a bubble (a missing transfer, a second booking) is not repeated here (rule 3). The bubble is where it belongs, and it links to the check.
- **Left out:** the route line under the title (the Sleeping in row is the route).

### Item details (`/trips/[id]/items/[itemId]`)
- **Question:** what do I need to show or say about this booking?
- **Order:** "Back to Sat Dec 5"; title with its subtitle ("NH159 to Tokyo", then "ANA"); times in the day view's hierarchy; place and address; for owners and editors: your confirmation code first and largest, other travelers' codes, seats on one line, booking reference, phone, price, notes; then the item's deadlines; then Edit and Delete for people who may use them.
- **Codes** use the monospace face, the one allowed second face, so 0 and O, 1 and l stay apart at a counter. Every code has Copy (44 by 44, result announced).
- **Left out:** who added it and when, edit history, empty labels.

### Add and edit (`/trips/[id]/add`, `/items/[itemId]/edit`)
- **Question:** what is it, and when?
- **Shows:** the type's essential fields only. "More details" is closed for a new item and open when editing an item that has private values. Notes about time zones appear under a field once a place is recognised, never before.
- **Primary action:** "Add flight" or "Save changes" in a sticky bar on phones. The bar never covers the focused field.

### Deadlines (`/trips/[id]/deadlines`)
- **Question:** what do I have to decide, and by when?
- **Order:** "Decide in the next few days" (warning color); "Later"; then checks under one name everywhere: **"Worth a look"**. The phone alert, the desktop panel and this page all use it. "Already passed" folds at the bottom.
- **Times:** say "midnight" and "noon", never "12:00am". A deadline at local midnight reads "by the end of Fri Dec 4".

### Review inbox (`/trips/[id]/inbox`)
- **Question:** is this imported stuff right?
- **Reached** from the alert or from the nav entry, which shows the count only while entries wait. With nothing waiting, the page says "Nothing to review. Items from calendars and assistants arrive here first." at body size, not in small muted text.

### Share (`/trips/[id]/share`, owner only)
- **Question:** who can see this trip, and how do I add someone?
- **Order:** "Invite someone"; "People on this trip"; "Pending invites", newest first.
- **After creating a link,** the result replaces the form until "Create another link" is pressed. The form and the link it made are never on screen together.
- **Member actions** ("Change role", "Remove") appear after tapping a member's row, not on every row at once.

### Connect (`/trips/[id]/connect`)
- **Question:** how do I hook up an assistant or my Google Calendar?
- **A setup screen** used about once per trip. It is not a primary destination: on phones it lives under a "More" entry with Share, not in the main nav. Every input has a visible label (the placeholder "Name, like Jacob's Claude" is not a label).

### Sign in and invites
- **One question each:** "how do I get in?" and "do I want to join this trip?" The invite screen names the trip and the inviter, and has one button.
- **Every dead end has one way out.** The lost invite page has "Go to your trips" for a signed-in visitor. In the installed app there is no back button.

### View link and Now for visitors (`/v/[token]`, WP-16)
- See `.pipeline/specs/WP-16.md`. Visitors see Now, the strip and one day. They see no nav to pages they cannot open, and no controls.

## Density limits

| Where | Limit |
|---|---|
| Phone, first screen (390 by 844) | title block, nav, one alert, three Up next rows, the strip, the start of the chosen day |
| Phone, alerts | one; the rest summarised as "and 2 more" |
| Desktop attention panel | five lines, then "See N more" |
| Grid cell | three plans, then "+N more" |
| Any list row | two lines of text, three when a title wraps |
| Filled buttons per view | one |

## Mechanical checks (asked of the architect)

- **Type floor:** no `font-size` under 13px (0.8125rem) in any CSS module. Stylelint rule, or a test over the CSS modules.
- **Targets:** in the e2e phone project, every visible link, button, summary and input is at least 44 by 44 CSS px, apart from inline links inside running text.
- **One filled button:** in the e2e phone project, at most one visible filled button per page state.
- **Copy:** a test over `src/app/**/*.tsx` string literals rejects "please", "simply", "successfully", "N/A", "!", "12:00am" and "12:00pm" in UI copy.
- **Contrast:** a unit test computes every text and background token pair, and every input border against its ground, in both modes. Text pairs need 4.5:1; borders and UI parts need 3:1. This fails today on `--rule` as an input border (1.25:1).
- **axe** on every page in both e2e projects: zero serious or critical (WP-12).

## Anti-patterns in this app

Each was seen in the running app on Nov 27 (screenshots in `.pipeline/scratch/ux/audit/`).

1. **The same fact in three places.** On the December trip's desktop page, the overlap of the Airbnb with "Stay at Total (USD) $1,183.22" appears as a "Not sure yet" bubble, then twice more as "Two stays overlap..." lines in Worth a look. "No way to Shenzhen booked" is a red bubble and also "Nothing booked to get from Hong Kong to Shenzhen on Dec 6." **Instead:** the grid bubble carries it and links to the check; the panel lists only what the grid cannot show.
2. **Repeating the header on every row.** On Tue Mar 9 (packed week, phone) all nine rows say "Tokyo" under a header that says "Tokyo". **Instead:** show a row's place only when it differs from the day's place, or name the venue.
3. **A disclosure that discloses nothing.** In WP-10a's day view, tapping a row revealed "Open details" and a "Travelers" line identical on every row. **Instead:** the row opens the details page.
4. **Losing the person's place.** Tapping a day chip on a phone reloads the page at the top. On the packed week the chosen day starts at the bottom edge, below the alert and Up next. "Back to the trip" returns to the first day, not the one you came from. **Instead:** keep position (rule 6).
5. **The loudest control is the one nobody wants.** On "Your trips", "Sign out" is the only filled button, and "New trip" is a plain link. **Instead:** rule 7.
6. **Urgent color for something months away.** On the packed week, 101 days out, the phone alert "3 things worth a look" uses the warning tint. **Instead:** the warning tint only for deadlines within 3 days (rule 5).
7. **A form that contradicts its own result.** On Share, after creating a viewer link for Maya, the form resets to Editor and Someone new while the text below says "as a viewer". **Instead:** the result replaces the form.
8. **Placeholder as label.** On Connect, the only label for the assistant name field is the placeholder "Name, like Jacob's Claude". It disappears as you type (WCAG 3.3.2). **Instead:** a visible label "Name", with the example as a hint underneath.
9. **Two names for one thing.** Checks are "Worth a look" in the panel, "Worth double-checking" on the page, and live under a nav item called "Deadlines". **Instead:** "Worth a look" everywhere, and the page title says "Deadlines and checks".
10. **Text too small to read in a taxi.** Grid bubble subtext ("leaves 12:55am", "5:25am, clocks +14h") is 11.67px. **Instead:** 13px minimum, and let the cell wrap.
11. **A time without its meaning.** Chicago shows "4:00pm Check in: Thompson Chicago" after a flight that departs at 5:00pm, as if you check in before you leave. Deadlines say "Sat Dec 5, 12:00am Shenzhen". **Instead:** "Check in from 4:00pm" placed after the landing on that day; "by the end of Fri Dec 4".
12. **Copy built from data without care.** "Your omoide Yokocho ends at 10:30pm" lowercases a proper name. "'Stay at Total (USD) $1,183.22'" is quoted while the stay next to it is not. **Instead:** never change the case of a title, and quote titles consistently or not at all.
13. **Meaning carried by color alone.** On the day strip, "needs a look" is a red dot next to a grey "something planned" dot, the same size and shape. **Instead:** a ring or a different shape, as well as color.
14. **Setup screens in the main nav.** "Connect" sits beside "Day by day" and wraps alone onto a second nav line on every phone screen. "Review inbox" stays in the nav when there is nothing to review. **Instead:** primary nav is Trip, Add, Deadlines; the inbox appears with its count when it has entries; Connect and Share go under "More".

## Owner decisions (Nov 27)

1. **Rows open a details page instead of expanding.** Approved. DESIGN.md's Event row says so, and rule 2 above applies.
2. **Home time stays as DESIGN.md has it:** small and secondary, after the local time, only where the place's zone differs from home. It is not added to rows where the zones match, and it is not removed from plan rows.
3. **The route line under the trip title is removed on desktop** (the UX lead's call, delegated by the owner). The Sleeping in row directly below it already says the route, with each city's nights, so the line repeated it (rule 3). Phones never showed it; the day strip's city bars carry the shape there.
