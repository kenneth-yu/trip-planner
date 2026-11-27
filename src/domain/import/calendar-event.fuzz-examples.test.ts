import { describe, expect, it } from "vitest";
import { TRAVELERS } from "@/fixtures/december-trip";
import { isValidZone } from "../time/format";
import { mapCalendarEvent, type CalendarEvent, type MapContext } from "./calendar-event";
import { planCalendarImport } from "./pipeline";
import { InputProblem } from "./problem";

const ctx: MapContext = { homeZone: "America/New_York", travelerIds: [TRAVELERS.kenny] };
const importCtx = { calendarTravelers: {}, defaultTravelerIds: [TRAVELERS.kenny], homeZone: "America/New_York" };

const timed = (dateTime: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  summary: "Dinner",
  location: "Tokyo, Japan",
  start: { dateTime },
  end: { dateTime: end },
  ...extra,
});

describe("calendar event cases found by fuzzing, kept as examples", () => {
  it("seed 1: an empty start time is a typed problem, not an Invalid DateTime crash", () => {
    expect(() => mapCalendarEvent({ start: { dateTime: "" }, end: { dateTime: "2026-02-30T10:00:00" } }, ctx)).toThrow(InputProblem);
  });

  it("seed 1: an empty all day end date is a typed problem", () => {
    expect(() => mapCalendarEvent({ start: { date: "2000-01-01" }, end: { date: "" } }, ctx)).toThrow(InputProblem);
  });

  it("an event with neither start nor end is a typed problem, and a batch names which event", () => {
    expect(() => mapCalendarEvent({ start: {}, end: {} }, ctx)).toThrow(InputProblem);
    const batch = [timed("2026-12-05T19:00:00+09:00", "2026-12-05T21:00:00+09:00"), { start: {}, end: {} }];
    expect(() => planCalendarImport(batch, [], importCtx)).toThrow("Event 2:");
  });

  it("a date or year-month in place of a date and time is refused, not read in the server's zone", () => {
    for (const text of ["2026-12-05", "2026-12", "2026", "2026-12-05T"]) {
      expect(() => mapCalendarEvent(timed(text, "2026-12-05T21:00:00+09:00"), ctx)).toThrow(InputProblem);
      expect(() => mapCalendarEvent(timed("2026-12-05T19:00:00+09:00", text), ctx)).toThrow(InputProblem);
    }
  });

  it("dates outside any real trip are refused", () => {
    expect(() => mapCalendarEvent(timed("0000-01-01T00:00:00Z", "0000-01-01T01:00:00Z"), ctx)).toThrow(InputProblem);
    expect(() => mapCalendarEvent(timed("+275760-09-13T00:00:00Z", "+275760-09-13T01:00:00Z"), ctx)).toThrow(InputProblem);
  });

  it("a time with no offset is read in the event's own zone, not the server's", () => {
    const p = mapCalendarEvent({ summary: "Dinner", start: { dateTime: "2026-12-05T19:00:00", timeZone: "Asia/Tokyo" }, end: { dateTime: "2026-12-05T21:00:00", timeZone: "Asia/Tokyo" } }, ctx).proposed;
    expect(p.start).toEqual({ at: "2026-12-05T10:00:00.000Z", zone: "Asia/Tokyo" });
    expect(p.problems).toEqual([]);
  });

  it("a flight whose calendar zone is not a real zone gets a real zone and a problem", () => {
    const p = mapCalendarEvent(
      { summary: "NH159 flight", description: "NH159", start: { dateTime: "2026-12-02T00:55:00", timeZone: "Mars/Olympus" }, end: { dateTime: "2026-12-02T05:25:00" } },
      ctx,
    ).proposed;
    expect(isValidZone(p.start.zone)).toBe(true);
    expect(p.status).toBe("needs_review");
    expect(p.problems.length).toBeGreaterThan(0);
  });

  it("regression guard: a timed event with an unrecognised calendar zone stays flagged", () => {
    const p = mapCalendarEvent({ summary: "Dinner", start: { dateTime: "2026-12-05T19:00:00", timeZone: "UTC+9" }, end: { dateTime: "2026-12-05T21:00:00", timeZone: "UTC+9" } }, ctx).proposed;
    expect(isValidZone(p.start.zone)).toBe(true);
    expect(p.status).toBe("needs_review");
  });

  it("times that end before they start are flagged for review in every kind of event", () => {
    const timedBack = mapCalendarEvent(timed("2026-12-05T21:00:00+09:00", "2026-12-05T19:00:00+09:00"), ctx).proposed;
    const allDayBack = mapCalendarEvent({ summary: "Hotel Resol Ueno (Tokyo)", start: { date: "2026-12-06" }, end: { date: "2026-12-02" } }, ctx).proposed;
    for (const p of [timedBack, allDayBack]) {
      expect(p.status).toBe("needs_review");
      expect(p.problems.join(" ")).toContain("before it starts");
    }
  });

  it("a calendar named like an object property does not pick travelers from the prototype", () => {
    const [draft] = planCalendarImport([timed("2026-12-05T19:00:00+09:00", "2026-12-05T21:00:00+09:00", { calendar: "constructor" })], [], importCtx);
    expect(draft.proposed.travelerIds).toEqual([TRAVELERS.kenny]);
  });
});
