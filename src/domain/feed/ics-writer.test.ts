import { describe, expect, it } from "vitest";
import { buildFixtureTrip, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { buildDemoTrip, PACKED_TRIP } from "@/fixtures/demo-trips";
import { present } from "@/testing/present";
import { parseIcs } from "../import/ics";
import { fromLocal, instantMs } from "../time/format";
import { itemHeading } from "../time/item-heading";
import type { Item, Requester, TripAggregate } from "../types";
import { projectTrip } from "../visibility/project";
import { buildFeed } from "./ics-writer";

const NY = "America/New_York";
const jacob: Requester = { kind: "member", userId: USERS.jacob.id, homeZone: NY };
const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: NY };
const VIEWER = "user-mom";
const viewer: Requester = { kind: "member", userId: VIEWER, homeZone: NY };
const opts = { appUrl: "https://trips.test", generatedAt: new Date("2026-11-28T12:00:00Z") };

function withViewer(agg: TripAggregate, viewersSeeDeadlines = false): TripAggregate {
  agg.memberships.push({ tripId: agg.trip.id, userId: VIEWER, role: "viewer" });
  agg.trip.viewersSeeDeadlines = viewersSeeDeadlines;
  return agg;
}

const feedFor = (agg: TripAggregate, requester: Requester) => buildFeed(projectTrip(agg, requester), opts);
const unfolded = (feed: string) => feed.replace(/\r\n /g, "");
const eventsOf = (feed: string) => unfolded(feed).split("BEGIN:VEVENT\r\n").slice(1).map((block) => block.split("END:VEVENT")[0] ?? "");
const eventNamed = (feed: string, summary: string) => present(eventsOf(feed).find((e) => e.includes(`SUMMARY:${summary}\r\n`)), summary);

describe("the feed's shape", () => {
  const feed = feedFor(buildFixtureTrip(), jacob);

  it("is a calendar with the trip's name, a one hour refresh hint and CRLF line ends", () => {
    expect(feed.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(feed.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(feed).toContain("X-WR-CALNAME:Asia\\, December 2026\r\n");
    expect(feed).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n");
    expect(feed).toContain("X-PUBLISHED-TTL:PT1H\r\n");
    expect(feed.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("folds no line over 75 octets, and never inside a character", () => {
    const long = buildFixtureTrip();
    const item = present(long.items.find((i) => i.type === "plan"));
    item.title = `Dinner at 麺屋 ${"とても長い名前".repeat(30)}`;
    const out = feedFor(long, jacob);
    for (const line of out.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfolded(out)).toContain(item.title.replace(/,/g, "\\,"));
  });

  it("escapes commas, semicolons, backslashes and line breaks in text", () => {
    const agg = buildFixtureTrip();
    const item = present(agg.items.find((i) => i.type === "plan"));
    item.title = "Lunch, then; a walk \\ back\nhome";
    expect(feedFor(agg, jacob)).toContain("SUMMARY:Lunch\\, then\\; a walk \\\\ back\\nhome\r\n");
  });

  it("has a balanced structure and is read back by the .ics importer", () => {
    const begins = feed.split("\r\n").filter((l) => l.startsWith("BEGIN:")).length;
    const ends = feed.split("\r\n").filter((l) => l.startsWith("END:")).length;
    expect(begins).toBe(ends);
    const parsed = parseIcs(feed);
    expect(parsed.events.length).toBe(eventsOf(feed).length);
    expect(parsed.events.map((e) => e.summary)).toContain("NH159 to Tokyo");
  });
});

describe("times survive a round trip through the .ics importer", () => {
  const instantOf = (time: { dateTime?: string }) => Date.parse(time.dateTime ?? "");

  function expectInstants(agg: TripAggregate, requester: Requester, titles: string[]) {
    const view = projectTrip(agg, requester);
    const parsed = parseIcs(buildFeed(view, opts)).events;
    for (const title of titles) {
      const item = present(view.items.find((i) => i.title === title || i.flight?.flightNumber === title));
      const event = present(parsed.find((e) => e.summary === itemHeading(item)), title);
      expect(instantOf(event.start), `${title} start`).toBe(instantMs(item.start));
      expect(instantOf(event.end), `${title} end`).toBe(instantMs(item.end));
    }
  }

  it("keeps every flight's departure and arrival instant, in New York, Tokyo, Hong Kong and Shenzhen", () => {
    expectInstants(buildFixtureTrip(), jacob, ["NH159", "CX509", "CX520", "NH160"]);
  });

  it("keeps the instants of plans in Hong Kong", () => {
    expectInstants(buildFixtureTrip(), jacob, ["Jantzen Tailor", "Sun Kai Tat"]);
  });

  it("keeps the instants of a plan before, and a plan after, the November clocks going back in New York", () => {
    const agg = buildFixtureTrip();
    const base = present(agg.items.find((i) => i.type === "plan"));
    const make = (id: string, title: string, from: string, to: string): Item => ({ ...base, id, title, start: fromLocal(from, NY), end: fromLocal(to, NY), deadlines: [], private: [], location: { name: "Park", city: "New York" } });
    agg.items.push(make("fall-before", "Late walk before the change", "2026-11-01T00:30", "2026-11-01T00:50"), make("fall-after", "Breakfast after the change", "2026-11-01T03:00", "2026-11-01T04:00"), make("fall-across", "Night out across the change", "2026-10-31T23:30", "2026-11-01T03:30"));
    expectInstants(agg, jacob, ["Late walk before the change", "Breakfast after the change", "Night out across the change"]);
    const text = feedFor(agg, jacob);
    const newYork = text.split("BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n")[1]?.split("END:VTIMEZONE")[0] ?? "";
    expect(newYork).toContain("BEGIN:STANDARD\r\nDTSTART:20261101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\n");
  });
});

describe("text a person typed", () => {
  const plan = (agg: TripAggregate) => present(agg.items.find((i) => i.type === "plan"));

  it("cannot start a new line, whatever kind of line break it holds", () => {
    const agg = buildFixtureTrip();
    plan(agg).title = "Lunch\rATTENDEE:mailto:x@example.test\nBEGIN:VEVENT\u2028END:VCALENDAR\u0085DESCRIPTION:hi\r\nX:y\u0000\u0007\u001b[2J\u007f";
    const text = feedFor(agg, jacob);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n\u0085\u2028\u2029\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    expect(unfolded(text)).toContain("SUMMARY:Lunch\\nATTENDEE:mailto:x@example.test\\nBEGIN:VEVENT\\nEND:VCALENDAR\\nDESCRIPTION:hi\\nX:y[2J\r\n");
    expect(unfolded(text)).not.toMatch(/\r\nATTENDEE/);
    expect(text.split("BEGIN:VEVENT\r\n").length - 1).toBe(eventsOf(feedFor(buildFixtureTrip(), jacob)).length);
  });

  it("cannot reach the calendar through a place name or an address either", () => {
    const agg = buildFixtureTrip();
    const item = plan(agg);
    item.location = { name: "Cafe\rX-INJECTED:1", address: "1 Road\u2028X-INJECTED:2", city: "Tokyo" };
    expect(unfolded(feedFor(agg, jacob))).not.toMatch(/\r\nX-INJECTED/);
  });

  it("leaves a trailing slash on the app address out of every link", () => {
    for (const appUrl of ["https://trips.test/", "https://trips.test///"]) {
      const text = unfolded(buildFeed(projectTrip(buildFixtureTrip(), jacob), { ...opts, appUrl }));
      expect(text).toContain(`Open in Trip planner: https://trips.test/trips/${TRIP_ID}/items/`);
      expect(text).not.toContain("trips.test//");
    }
  });
});

describe("what each kind of item looks like", () => {
  const feed = feedFor(buildFixtureTrip(), jacob);

  it("writes a flight from departure to arrival, each end in its own zone, with the day view's title", () => {
    const flight = eventNamed(feed, "NH159 to Tokyo");
    expect(flight).toContain("DTSTART;TZID=America/New_York:20261201T005500\r\n");
    expect(flight).toContain("DTEND;TZID=Asia/Tokyo:20261202T052500\r\n");
    expect(flight).toContain("LOCATION:New York\\, JFK\r\n");
    expect(flight).toContain(`DESCRIPTION:Lands 5:25am Tokyo time\\, Haneda.\\nOpen in Trip planner: https://trips.test/trips/${TRIP_ID}/items/`);
    expect(flight).toContain("TRANSP:OPAQUE\r\n");
  });

  it("writes a stay as an all day event from check in to check out, the end day excluded, with the times in words", () => {
    const stay = eventNamed(feed, "Hotel Resol Ueno");
    expect(stay).toContain("DTSTART;VALUE=DATE:20261202\r\n");
    expect(stay).toContain("DTEND;VALUE=DATE:20261205\r\n");
    expect(stay).toContain("DESCRIPTION:Check in from 3:00pm. Check out by 11:00am.\r\n");
    expect(stay).toContain("LOCATION:Hotel Resol Ueno\\, Tokyo\r\n");
    expect(stay).toContain("TRANSP:TRANSPARENT\r\n");
  });

  it("says estimated when a stay's time is estimated", () => {
    expect(eventNamed(feed, "Stanford Hotel")).toContain("Check out by 11:00am (estimated).");
  });

  it("writes a plan as a timed event in its zone with the place", () => {
    const plan = eventNamed(feed, "Head spa\\, Belle Cheveu Hiroo");
    expect(plan).toContain("DTSTART;TZID=Asia/Tokyo:20261202T183000\r\n");
    expect(plan).toContain("DTEND;TZID=Asia/Tokyo:20261202T210000\r\n");
    expect(plan).toContain("LOCATION:");
  });

  it("keeps a one day stay one day long", () => {
    const stay = eventNamed(feed, "Stanford Hotel");
    expect(stay).toContain("DTSTART;VALUE=DATE:20261205\r\n");
    expect(stay).toContain("DTEND;VALUE=DATE:20261206\r\n");
  });
});

describe("what is never in the feed", () => {
  const agg = buildFixtureTrip();
  const sensitive = agg.items.flatMap((item) => item.private.flatMap((p) => [p.confirmationCode, p.bookingReference, p.seat, p.phone, p.price?.amount, p.bookingSite, p.notes]).filter((v): v is string => typeof v === "string" && v.length > 0));

  it("holds no code, seat, phone, price or booking reference, for the owner who can see them all", () => {
    expect(sensitive.length).toBeGreaterThan(3);
    for (const who of [kenny, jacob]) {
      const text = unfolded(feedFor(buildFixtureTrip(), who));
      for (const value of sensitive) expect(text).not.toContain(value);
    }
  });

  it("holds no item notes, traveler names, user ids or e-mail addresses", () => {
    const withNotes = buildFixtureTrip();
    for (const item of withNotes.items) item.notes = `PRIVATE-NOTE-${item.id}`;
    const text = unfolded(feedFor(withNotes, kenny));
    expect(text).not.toContain("PRIVATE-NOTE");
    expect(text).not.toContain(USERS.kenny.id);
    expect(text).not.toContain(USERS.jacob.id);
    expect(text).not.toMatch(/@(?!trip-planner)/);
    expect(text).not.toMatch(/ATTENDEE|ORGANIZER|ATTACH|URL:/);
  });
});

describe("hidden items and busy blocks", () => {
  function withHidden(showAsBusy: boolean): TripAggregate {
    const agg = buildFixtureTrip();
    const base = present(agg.items.find((i) => i.type === "plan"));
    const hidden: Item = {
      ...base,
      id: "item-surprise",
      title: "Ring shopping in Ginza",
      start: fromLocal("2026-12-03T14:00", "Asia/Tokyo"),
      end: fromLocal("2026-12-03T16:00", "Asia/Tokyo"),
      location: { name: "Mikimoto", address: "2-4-12 Ginza", city: "Tokyo" },
      createdBy: USERS.jacob.id,
      updatedBy: USERS.jacob.id,
      visibility: "only_me",
      showAsBusy,
      notes: "the ring",
      private: [{ travelerId: null, confirmationCode: "RING-CODE-77" }],
      deadlines: [],
    };
    agg.items.push(hidden);
    return agg;
  }

  it("shows a hidden item to the person it is hidden from only as Busy, with nothing else", () => {
    const text = unfolded(feedFor(withHidden(true), kenny));
    const busy = eventNamed(text, "Busy");
    expect(busy).toContain("TRANSP:OPAQUE\r\n");
    expect(busy).toContain("CLASS:PRIVATE\r\n");
    expect(busy).not.toMatch(/LOCATION|DESCRIPTION/);
    for (const secret of ["Ring shopping", "Ginza", "Mikimoto", "the ring", "RING-CODE-77", "item-surprise"]) expect(text).not.toContain(secret);
  });

  it("leaves a hidden item that is not shown as busy out altogether", () => {
    const text = unfolded(feedFor(withHidden(false), kenny));
    expect(text).not.toContain("SUMMARY:Busy");
    for (const secret of ["Ring shopping", "Ginza", "RING-CODE-77", "item-surprise"]) expect(text).not.toContain(secret);
  });

  it("shows the person who made it its own item in full", () => {
    const text = unfolded(feedFor(withHidden(true), jacob));
    expect(text).toContain("SUMMARY:Ring shopping in Ginza\r\n");
    expect(text).not.toContain("SUMMARY:Busy");
  });

  it("gives a busy block the same id for the same hours, whatever the hidden item is called", () => {
    const first = unfolded(feedFor(withHidden(true), kenny)).match(/UID:(busy-[^\r]+)/)?.[1];
    const renamed = withHidden(true);
    present(renamed.items.find((i) => i.id === "item-surprise")).title = "A different name";
    expect(unfolded(feedFor(renamed, kenny)).match(/UID:(busy-[^\r]+)/)?.[1]).toBe(first);
    expect(first).toBeDefined();
  });
});

describe("deadlines", () => {
  it("are a 15 minute event at the deadline, in its zone, with the deadline sentence and no countdown", () => {
    const text = unfolded(feedFor(buildFixtureTrip(), jacob));
    const deadline = eventNamed(text, "Hotel Resol Ueno becomes non refundable");
    expect(deadline).toContain("DTSTART;TZID=Asia/Tokyo:20261128T235900\r\n");
    expect(deadline).toContain("DTEND;TZID=Asia/Tokyo:20261129T001400\r\n");
    expect(deadline).toContain(`DESCRIPTION:Open in Trip planner: https://trips.test/trips/${TRIP_ID}/deadlines\r\n`);
    expect(deadline).not.toMatch(/in \d|ago|days?\b/);
  });

  it("are left out for a viewer who may not see deadlines, and in when they may", () => {
    expect(unfolded(feedFor(withViewer(buildFixtureTrip(), false), viewer))).not.toContain("non refundable");
    expect(unfolded(feedFor(withViewer(buildFixtureTrip(), true), viewer))).toContain("Hotel Resol Ueno becomes non refundable");
  });
});

describe("ids and times", () => {
  it("keep an event's id when its title or time changes, so calendar apps update it", () => {
    const uids = (agg: TripAggregate, at = opts.generatedAt) => [...unfolded(buildFeed(projectTrip(agg, jacob), { ...opts, generatedAt: at })).matchAll(/UID:([^\r]+)/g)].map((m) => m[1]).sort();
    const agg = buildFixtureTrip();
    const before = uids(agg);
    const edited = buildFixtureTrip();
    const plan = present(edited.items.find((i) => i.type === "plan"));
    plan.title = "Something else";
    plan.start = fromLocal("2026-12-02T10:00", "Asia/Tokyo");
    expect(uids(edited, new Date("2027-01-01T00:00:00Z"))).toEqual(before);
    expect(new Set(before).size).toBe(before.length);
  });

  it("stamps every event with when the feed was made, in UTC", () => {
    expect(unfolded(feedFor(buildFixtureTrip(), jacob))).toContain("DTSTAMP:20261128T120000Z\r\n");
  });

  it("describes every zone it uses, with its offset", () => {
    const text = feedFor(buildFixtureTrip(), jacob);
    for (const zone of ["America/New_York", "Asia/Tokyo", "Asia/Hong_Kong", "Asia/Shanghai"]) {
      expect(text).toContain(`BEGIN:VTIMEZONE\r\nTZID:${zone}\r\n`);
    }
    const tokyo = text.split("BEGIN:VTIMEZONE\r\nTZID:Asia/Tokyo\r\n")[1]?.split("END:VTIMEZONE")[0] ?? "";
    expect(tokyo).toContain("TZOFFSETFROM:+0900\r\nTZOFFSETTO:+0900\r\n");
    const newYork = text.split("BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n")[1]?.split("END:VTIMEZONE")[0] ?? "";
    expect(newYork).toContain("TZOFFSETTO:-0500\r\n");
  });

  it("includes the change of clocks when a trip crosses one, at the right local moment", () => {
    const text = feedFor(buildDemoTrip(PACKED_TRIP), kenny);
    const newYork = text.split("BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n")[1]?.split("END:VTIMEZONE")[0] ?? "";
    expect(newYork).toContain("BEGIN:DAYLIGHT\r\nDTSTART:20270314T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nTZNAME:EDT\r\nEND:DAYLIGHT\r\n");
  });
});
