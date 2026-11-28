import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./calendar-event";
import { defaultRange, inRange, MAX_RANGE_DAYS, parseRange } from "./date-range";

const timed = (start: string, end: string): CalendarEvent => ({ summary: "x", start: { dateTime: start }, end: { dateTime: end } });
const allDay = (start: string, end: string): CalendarEvent => ({ summary: "x", start: { date: start }, end: { date: end } });

describe("reading the dates", () => {
  it("accepts two dates, one date, and none", () => {
    expect(parseRange("2026-11-30", "2026-12-16")).toEqual({ ok: true, range: { from: "2026-11-30", to: "2026-12-16" } });
    expect(parseRange("2026-11-30", "")).toEqual({ ok: true, range: { from: "2026-11-30", to: null } });
    expect(parseRange(undefined, " ")).toEqual({ ok: true, range: { from: null, to: null } });
  });

  it.each([["2026-02-30", ""], ["2026-13-01", ""], ["tomorrow", ""], ["", "20261201"], [5, ""], [{}, ""]])("refuses %j and %j as not dates", (from, to) => {
    expect(parseRange(from, to)).toEqual({ ok: false, problem: "bad_dates" });
  });

  it("refuses a From after the To, and allows the same day", () => {
    expect(parseRange("2026-12-16", "2026-11-30")).toEqual({ ok: false, problem: "from_after_to" });
    expect(parseRange("2026-12-16", "2026-12-16")).toEqual({ ok: true, range: { from: "2026-12-16", to: "2026-12-16" } });
  });

  it(`allows ${MAX_RANGE_DAYS} days apart and refuses one more, like the Google import`, () => {
    expect(parseRange("2026-01-01", "2026-12-31")).toEqual({ ok: true, range: { from: "2026-01-01", to: "2026-12-31" } });
    expect(parseRange("2026-01-01", "2027-01-01")).toEqual({ ok: false, problem: "range_too_long" });
    expect(parseRange("2026-01-01", "2030-01-01")).toEqual({ ok: false, problem: "range_too_long" });
  });
});

describe("which events are inside the dates", () => {
  const range = { from: "2026-11-30", to: "2026-12-16" };

  it("keeps an event that starts or ends inside, on either edge day", () => {
    expect(inRange(timed("2026-11-30T09:00:00+09:00", "2026-11-30T10:00:00+09:00"), range)).toBe(true);
    expect(inRange(timed("2026-12-16T23:00:00+09:00", "2026-12-17T01:00:00+09:00"), range)).toBe(true);
    expect(inRange(timed("2026-11-29T23:00:00Z", "2026-11-30T05:00:00Z"), range)).toBe(true);
  });

  it("leaves out an event wholly before or after", () => {
    expect(inRange(timed("2026-11-29T09:00:00Z", "2026-11-29T10:00:00Z"), range)).toBe(false);
    expect(inRange(timed("2026-12-17T09:00:00Z", "2026-12-17T10:00:00Z"), range)).toBe(false);
  });

  it("keeps a stay that begins before and runs into the dates, and treats an all day end as the day after", () => {
    expect(inRange(allDay("2026-11-27", "2026-12-01"), range)).toBe(true);
    expect(inRange(allDay("2026-11-27", "2026-11-30"), range)).toBe(false);
    expect(inRange(allDay("2026-12-16", "2026-12-18"), range)).toBe(true);
    expect(inRange(allDay("2026-12-17", "2026-12-18"), range)).toBe(false);
  });

  it("with no dates keeps everything that has a start, and with one date leaves the other side open", () => {
    expect(inRange(timed("1999-01-01T00:00:00Z", "1999-01-01T01:00:00Z"), { from: null, to: null })).toBe(true);
    expect(inRange(timed("2030-01-01T00:00:00Z", "2030-01-01T01:00:00Z"), { from: "2026-11-30", to: null })).toBe(true);
    expect(inRange(timed("2020-01-01T00:00:00Z", "2020-01-01T01:00:00Z"), { from: null, to: "2026-12-16" })).toBe(true);
    expect(inRange({ summary: "x", start: {}, end: {} }, { from: null, to: null })).toBe(false);
  });
});

describe("the dates a trip starts with", () => {
  it("is the day before the first day and the day after the last", () => {
    expect(defaultRange(["2026-12-01", "2026-12-05"], ["2026-12-15", "2026-12-04"])).toEqual({ from: "2026-11-30", to: "2026-12-16" });
  });

  it("is empty for a trip with no dates", () => {
    expect(defaultRange([], [])).toEqual({ from: null, to: null });
  });

  it("is capped under a year for a very long trip", () => {
    const range = defaultRange(["2026-01-01"], ["2030-01-01"]);
    expect(parseRange(range.from, range.to).ok).toBe(true);
  });
});
