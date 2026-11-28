import { present } from "@/testing/present";
import { describe, expect, it } from "vitest";
import { fixture, TRAVELERS } from "@/fixtures/december-trip";
import { toLocal } from "../time/format";
import type { CalendarEvent } from "./calendar-event";
import { isClean, planCalendarImport, type InboxEntryDraft } from "./pipeline";
import { extractDeadlines, extractFlightNumber, findAirports, readClock } from "./patterns";
import { DateTime } from "../time/luxon";

const both = [TRAVELERS.kenny, TRAVELERS.jacob];
const ctx = {
  calendarTravelers: {
    "kenny primary": [TRAVELERS.kenny],
    "kenny primary (from Gmail)": [TRAVELERS.kenny],
    "shared China": both,
  },
  defaultTravelerIds: [TRAVELERS.kenny],
  homeZone: "America/New_York",
};
const events: CalendarEvent[] = fixture.calendarEvents;
const local = (t: { at: string; zone: string }) => `${toLocal(t).toFormat("yyyy-MM-dd'T'HH:mm")} ${t.zone}`;

describe("importing the fixture's two calendars into an empty trip (phase 2 acceptance)", () => {
  const entries = planCalendarImport(events, [], ctx);
  const flight = (n: string) => present(entries.find((e) => e.proposed.flight?.flightNumber === n));
  const titled = (t: string) => entries.filter((e) => e.proposed.title.startsWith(t));

  it("collapses duplicates: 16 events become 14 entries", () => {
    expect(entries).toHaveLength(14);
  });

  it("NH159: one flight, two travelers, a seat each, no conflict", () => {
    const e = flight("NH159");
    expect(e.raw).toHaveLength(2);
    expect(e.differences).toEqual([]);
    expect(e.proposed.travelerIds.sort()).toEqual([...both].sort());
    expect(e.proposed.private.map((p) => [p.travelerId, p.seat, p.confirmationCode])).toEqual([
      [TRAVELERS.kenny, "30K", "PLACEHOLDER_A"],
      [TRAVELERS.jacob, "30C", "PLACEHOLDER_B"],
    ]);
    expect(local(e.proposed.end)).toBe("2026-12-02T05:25 Asia/Tokyo");
  });

  it("CX509: the 10 minute disagreement is shown for a decision, not picked", () => {
    const e = flight("CX509");
    expect(e.differences).toEqual([expect.objectContaining({ field: "start", values: ["9:00am", "8:50am"] })]);
    expect(isClean(e)).toBe(false);
    expect(e.proposed.flight).toMatchObject({ fromAirport: "NRT", toAirport: "HKG", airline: "Cathay Pacific" });
  });

  it("flights take zones from airports, not from the event's time zone", () => {
    expect(local(flight("CX520").proposed.end)).toBe("2026-12-13T15:30 Asia/Tokyo");
    expect(local(flight("NH160").proposed.end)).toBe("2026-12-15T21:55 America/New_York");
  });

  it("the two Resol Ueno bookings stay separate (different nights)", () => {
    expect(titled("Hotel Resol Ueno")).toHaveLength(2);
  });

  it("deadlines from descriptions are proposed, marked parsed", () => {
    const dl = (t: string) => titled(t)[0].proposed.deadlines.map((d) => `${d.kind} ${local(d.at)} ${d.source}`);
    expect(dl("Hotel Resol Ueno")).toEqual(["free_cancellation 2026-11-28T23:59 Asia/Tokyo parsed"]);
    expect(dl("Head spa")).toEqual(["change 2026-11-29T10:00 Asia/Tokyo parsed"]);
    expect(dl("Mumian")).toEqual(["free_cancellation 2026-12-05T00:00 Asia/Shanghai parsed"]);
    expect(dl("Airbnb")).toEqual(["partial_refund 2026-12-03T14:00 Asia/Hong_Kong parsed"]);
  });

  it("stays read check in times and the late arrival cutoff", () => {
    const resol = titled("Hotel Resol Ueno")[0].proposed;
    expect(local(resol.start)).toBe("2026-12-02T15:00 Asia/Tokyo");
    expect(resol.startIsEstimated).toBe(false);
    expect(resol.stay?.lateArrivalCutoff).toBe("21:00");
    const stanford = titled("Stanford")[0].proposed;
    expect([stanford.startIsEstimated, stanford.endIsEstimated]).toEqual([false, true]);
  });

  it("Gmail stubs with no place need review and are never clean", () => {
    const stub = titled("Stay at Total")[0];
    expect(stub.proposed.status).toBe("needs_review");
    expect(stub.proposed.problems.length).toBeGreaterThan(0);
    expect(isClean(stub)).toBe(false);
  });
});

describe("importing on top of the reviewed trip", () => {
  const first = planCalendarImport(events, [], ctx);
  const existing = first
    .filter((e) => !e.proposed.title.startsWith("Stay at"))
    .map((e, i) => ({ ...e.proposed, id: `existing-${i}`, deadlines: [], flags: e.proposed.problems, visibleToUserIds: [], createdBy: null, updatedBy: null, createdAt: "", updatedAt: "", tripId: "t", visibility: "everyone" as const, showAsBusy: false, booked: true }));
  const again: InboxEntryDraft[] = planCalendarImport(events, existing, ctx);

  it("every re-imported record matches what is already there", () => {
    const unmatched = again.filter((e) => !e.match).map((e) => e.proposed.title);
    expect(unmatched).toEqual([]);
  });

  it("Gmail stays with no place are only possible matches, never merged automatically", () => {
    const stubs = again.filter((e) => e.proposed.title.startsWith("Stay at"));
    expect(stubs.map((s) => s.match?.strength)).toEqual(["possible", "possible"]);
  });

  it("the Gmail stay gives the time zone of where you are that day", () => {
    const total = present(again.find((e) => e.proposed.title.startsWith("Stay at Total")));
    expect(local(total.proposed.start)).toBe("2026-12-10T15:00 Asia/Hong_Kong");
    expect(total.proposed.startIsEstimated).toBe(true);
  });
});

describe("patterns", () => {
  it("flight numbers", () => {
    expect(extractFlightNumber("Flight to Hong Kong (CX 509)")).toBe("CX509");
    expect(extractFlightNumber("ANA NH160. Departs")).toBe("NH160");
    expect(extractFlightNumber("Boeing 777-300ER")).toBeNull();
    expect(extractFlightNumber("Seat 30C")).toBeNull();
  });
  it("airports by code, name, and single airport city, never a bare multi airport city", () => {
    expect(findAirports("Tokyo Narita")).toEqual(["NRT"]);
    expect(findAirports("Hong Kong")).toEqual(["HKG"]);
    expect(findAirports("Tokyo")).toEqual([]);
    expect(findAirports("Narita International Airport (NRT)")).toEqual(["NRT"]);
  });
  it("clock times", () => {
    expect(readClock("after 3:00pm")).toBe("15:00");
    expect(readClock("by 12:00pm")).toBe("12:00");
    expect(readClock("at 12am")).toBe("00:00");
    expect(readClock("Dec 5")).toBeNull();
  });
  it("unreadable deadline dates are returned, not guessed", () => {
    const r = extractDeadlines("Free cancellation until the day before arrival.", "Asia/Tokyo", DateTime.fromISO("2026-12-02"));
    expect(r.deadlines).toEqual([]);
    expect(r.unparsed).toEqual(["Free cancellation until the day before arrival."]);
  });
});
