import { describe, expect, it } from "vitest";
import { fixture, TRAVELERS } from "@/fixtures/december-trip";
import { toIcs } from "@/testing/ics-fixture";
import type { CalendarEvent, CalendarEventTime } from "./calendar-event";
import { MAX_ICS_CHARS, MAX_ICS_EVENTS, parseIcs } from "./ics";
import { planCalendarImport } from "./pipeline";
import { InputProblem } from "./problem";

const events: CalendarEvent[] = fixture.calendarEvents;

const byCalendar = (name: string) => events.filter((e) => e.calendar === name);
const moment = (t: CalendarEventTime) => ({ instant: t.dateTime ? Date.parse(t.dateTime) : null, date: t.date ?? null, zone: t.timeZone ?? null });
const summarised = (list: CalendarEvent[]) => list.map((e) => [e.summary, moment(e.start), moment(e.end)]);

describe("the fixture calendars exported as .ics give the same inbox as the Google path", () => {
  const ctx = {
    calendarTravelers: { "kenny primary": [TRAVELERS.kenny], "kenny primary (from Gmail)": [TRAVELERS.kenny], "shared China": [TRAVELERS.kenny, TRAVELERS.jacob] },
    defaultTravelerIds: [TRAVELERS.kenny],
    homeZone: "America/New_York",
  };
  const calendars = [...new Set(events.map((e) => e.calendar ?? ""))];
  const viaIcs = calendars.flatMap((name) => parseIcs(toIcs(byCalendar(name)), { calendar: name }).events);
  const google = calendars.flatMap((name) => byCalendar(name));

  it("reads every event, skips none, and keeps the times and zones", () => {
    expect(viaIcs).toHaveLength(events.length);
    expect(summarised(viaIcs)).toEqual(summarised(google));
  });

  it("plans the same entries: same proposals, same differences, same matches", () => {
    const strip = (entries: ReturnType<typeof planCalendarImport>) => entries.map((entry) => ({ ...entry, raw: [] }));
    expect(strip(planCalendarImport(viaIcs, [], ctx))).toEqual(strip(planCalendarImport(google, [], ctx)));
  });

  it("keeps the whole description and location text, commas and line breaks included", () => {
    const hotel = viaIcs.find((e) => e.summary?.startsWith("Hotel Resol Ueno"));
    expect(hotel?.location).toContain("7-2-9 Ueno, Taito-ku");
    expect(hotel?.description).toContain("Free cancellation until Sat Nov 28, 11:59pm.");
  });
});

describe("times", () => {
  const wrap = (lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:t@example.test", ...lines, "SUMMARY:Thing", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const only = (lines: string[]) => parseIcs(wrap(lines)).events[0];

  it("a UTC time keeps its Z and no zone name", () => {
    expect(only(["DTSTART:20261201T055500Z", "DTEND:20261201T202500Z"])).toMatchObject({ start: { dateTime: "2026-12-01T05:55:00Z" }, end: { dateTime: "2026-12-01T20:25:00Z" } });
  });

  it("a named zone becomes local time with its offset and the zone name", () => {
    expect(only(["DTSTART;TZID=Asia/Tokyo:20261202T052500", "DTEND;TZID=Asia/Tokyo:20261202T070000"])).toMatchObject({
      start: { dateTime: "2026-12-02T05:25:00+09:00", timeZone: "Asia/Tokyo" },
      end: { dateTime: "2026-12-02T07:00:00+09:00", timeZone: "Asia/Tokyo" },
    });
  });

  it("the offset follows daylight saving", () => {
    const summer = only(["DTSTART;TZID=America/New_York:20260715T090000", "DTEND;TZID=America/New_York:20260715T100000"]);
    const winter = only(["DTSTART;TZID=America/New_York:20261215T090000", "DTEND;TZID=America/New_York:20261215T100000"]);
    expect(summer?.start.dateTime).toContain("-04:00");
    expect(winter?.start.dateTime).toContain("-05:00");
  });

  it("a floating time stays floating, so it is never given a zone here", () => {
    expect(only(["DTSTART:20261201T055500", "DTEND:20261201T202500"])).toMatchObject({ start: { dateTime: "2026-12-01T05:55:00" }, end: { dateTime: "2026-12-01T20:25:00" } });
    expect(only(["DTSTART:20261201T055500", "DTEND:20261201T202500"])?.start.timeZone).toBeUndefined();
  });

  it("an all day event keeps its dates, and a missing end is the next day", () => {
    expect(only(["DTSTART;VALUE=DATE:20261202", "DTEND;VALUE=DATE:20261205"])).toMatchObject({ start: { date: "2026-12-02" }, end: { date: "2026-12-05" } });
    expect(only(["DTSTART;VALUE=DATE:20261202"])).toMatchObject({ start: { date: "2026-12-02" }, end: { date: "2026-12-03" } });
  });

  it("a duration stands in for a missing end", () => {
    expect(only(["DTSTART;TZID=Asia/Tokyo:20261202T180000", "DURATION:PT2H30M"])?.end).toMatchObject({ dateTime: "2026-12-02T20:30:00+09:00", timeZone: "Asia/Tokyo" });
  });

  it.each(["DTSTART:", "DTSTART:garbage", "DTSTART;VALUE=DATE:2026"])("an unreadable start (%s) is skipped and counted, not a crash", (start) => {
    const result = parseIcs(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:u", start, "SUMMARY:x", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
    expect(result.events).toEqual([]);
    expect(result.skipped.unreadable_time + result.skipped.no_start).toBe(1);
  });

  it("a zone we do not know is skipped and counted, never guessed", () => {
    const result = parseIcs(wrap(["DTSTART;TZID=Eastern Standard Time:20261202T052500", "DTEND;TZID=Eastern Standard Time:20261202T070000"]));
    expect(result.events).toEqual([]);
    expect(result.skipped.unknown_zone).toBe(1);
  });
});

describe("what is skipped and what is kept", () => {
  const event = (lines: string[]) => ["BEGIN:VEVENT", "UID:x@example.test", "DTSTART:20261201T055500Z", "DTEND:20261201T065500Z", "SUMMARY:Thing", ...lines, "END:VEVENT"];
  const calendar = (...parts: string[][]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...parts.flat(), "END:VCALENDAR"].join("\r\n");

  it("skips cancelled events and the changed copies of repeating ones, and says how many", () => {
    const result = parseIcs(calendar(event([]), event(["STATUS:CANCELLED"]), event(["RECURRENCE-ID:20261201T055500Z"])));
    expect(result.events).toHaveLength(1);
    expect(result.skipped).toMatchObject({ cancelled: 1, override: 1 });
  });

  it("keeps a repeating event once and counts it", () => {
    const result = parseIcs(calendar(event(["RRULE:FREQ=WEEKLY;COUNT=10"])));
    expect(result.events).toHaveLength(1);
    expect(result.repeating).toBe(1);
  });

  it("skips an event with no start", () => {
    const result = parseIcs(calendar(["BEGIN:VEVENT", "UID:n@example.test", "SUMMARY:No start", "END:VEVENT"], event([])));
    expect(result.events).toHaveLength(1);
    expect(result.skipped.no_start).toBe(1);
  });

  it("stops at the event limit and counts the rest", () => {
    const many = Array.from({ length: MAX_ICS_EVENTS + 5 }, () => event([]));
    const result = parseIcs(calendar(...many));
    expect(result.events).toHaveLength(MAX_ICS_EVENTS);
    expect(result.skipped.over_limit).toBe(5);
  });

  it("labels every event with the calendar name it was given, and the uid as its id", () => {
    const [first] = parseIcs(calendar(event([])), { calendar: "Jacob's file" }).events;
    expect(first).toMatchObject({ calendar: "Jacob's file", id: "x@example.test" });
  });
});

describe("files that are not calendars", () => {
  it.each([
    ["empty", ""],
    ["plain text", "just some words"],
    ["html", "<html><body>Sign in</body></html>"],
    ["a vcard", "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Someone\r\nEND:VCARD"],
    ["a calendar with no events", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR"],
    ["an unterminated calendar", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:x"],
  ])("%s is a plain refusal", (_name, text) => {
    expect(() => parseIcs(text)).toThrow(InputProblem);
  });

  it("refuses more than 2 MB of text", () => {
    expect(() => parseIcs("x".repeat(MAX_ICS_CHARS + 1))).toThrow("That calendar is bigger than 2 MB.");
  });

  it("the refusal never echoes the file", () => {
    try {
      parseIcs("SECRET-PASSPORT-9 is not a calendar");
    } catch (e) {
      expect(e instanceof Error ? e.message : "").not.toContain("SECRET-PASSPORT-9");
    }
  });
});
