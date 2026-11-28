import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TRAVELERS } from "@/fixtures/december-trip";
import { isValidZone } from "../time/format";
import { MAX_ICS_EVENTS, parseIcs } from "./ics";
import { planCalendarImport } from "./pipeline";
import { InputProblem } from "./problem";
import { FUZZ_SEED, fuzzParams, garbageText, hugeText } from "./fuzz-config";

const importCtx = { calendarTravelers: {}, defaultTravelerIds: [TRAVELERS.kenny], homeZone: "America/New_York" };

const value = fc.oneof(
  garbageText,
  hugeText,
  fc.constantFrom("20261205T100000", "20261205T100000Z", "20261205", "20260230T100000", "20261305T100000", "20261205T250000", "00000101T000000Z", "99991231T235959Z", "20261205T100000+0900", "2026-12-05T10:00:00", "PT2H", "-PT5M", "P1000000D", "P1W"),
);
const zone = fc.constantFrom("Asia/Tokyo", "America/New_York", "Europe/London", "Mars/Olympus", "UTC+9", "Eastern Standard Time", "", "GMT+25", "asia/tokyo", "Etc/GMT-14", "../../etc/passwd");
const propName = fc.constantFrom("DTSTART", "DTEND", "DURATION", "SUMMARY", "DESCRIPTION", "LOCATION", "UID", "STATUS", "RRULE", "RECURRENCE-ID", "X-WR-CALNAME", "ATTENDEE", "ORGANIZER", "TRIGGER");
const param = fc.oneof(
  fc.constant(""),
  zone.map((z) => `;TZID=${z}`),
  fc.constantFrom(";VALUE=DATE", ";VALUE=DATE-TIME", ";VALUE=PERIOD", ";X-UNKNOWN=1", ";ENCODING=BASE64", ";VALUE=BINARY"),
  garbageText.map((g) => `;${g}`),
);
const line = fc.oneof(
  fc.tuple(propName, param, value).map(([n, p, v]) => `${n}${p}:${v}`),
  garbageText,
  fc.constantFrom("BEGIN:VEVENT", "END:VEVENT", "BEGIN:VCALENDAR", "END:VCALENDAR", "BEGIN:VTIMEZONE", "END:VTIMEZONE", " folded continuation", "\tfolded", "BEGIN:", "END:", ":", ";", "BEGIN:VALARM", "END:VALARM"),
);
const separator = fc.constantFrom("\r\n", "\n", "\r", "\u0000", "\r\n ");

const eventLines = fc.array(line, { maxLength: 12 }).map((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]);
const calendarText = fc
  .tuple(fc.array(eventLines, { maxLength: 8 }), separator)
  .map(([evs, sep]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...evs.flat(), "END:VCALENDAR"].join(sep));
const anyText = fc.oneof(calendarText, fc.array(line, { maxLength: 30 }).map((l) => l.join("\r\n")), garbageText, hugeText);

function typedOrResult(text: string) {
  try {
    return parseIcs(text, { calendar: "file" });
  } catch (e) {
    if (e instanceof InputProblem) return null;
    throw e;
  }
}

describe(`parseIcs fuzz (seed ${FUZZ_SEED})`, () => {
  it("only ever returns events or a plain refusal, whatever the text", () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const result = typedOrResult(text);
        if (!result) return;
        expect(result.events.length).toBeLessThanOrEqual(MAX_ICS_EVENTS);
        for (const ev of result.events) {
          expect(typeof ev.summary).toBe("string");
          const timed = ev.start.dateTime !== undefined;
          expect(timed || typeof ev.start.date === "string").toBe(true);
          if (ev.start.timeZone !== undefined) expect(isValidZone(ev.start.timeZone)).toBe(true);
          if (ev.end.timeZone !== undefined) expect(isValidZone(ev.end.timeZone)).toBe(true);
        }
      }),
      fuzzParams(400),
    );
  });

  it("everything it returns goes through the importer without a crash", () => {
    fc.assert(
      fc.property(calendarText, (text) => {
        const result = typedOrResult(text);
        if (!result) return;
        try {
          const entries = planCalendarImport(result.events, [], importCtx);
          for (const entry of entries) {
            expect(Number.isFinite(Date.parse(entry.proposed.start.at))).toBe(true);
            expect(isValidZone(entry.proposed.start.zone)).toBe(true);
          }
        } catch (e) {
          if (!(e instanceof InputProblem)) throw e;
        }
      }),
      fuzzParams(300),
    );
  });

  it("never keeps a time zone name it does not know", () => {
    fc.assert(
      fc.property(zone, (name) => {
        const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:z", `DTSTART;TZID=${name}:20261205T100000`, `DTEND;TZID=${name}:20261205T110000`, "SUMMARY:x", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
        const result = typedOrResult(text);
        if (!result) return;
        for (const ev of result.events) if (ev.start.timeZone !== undefined) expect(isValidZone(ev.start.timeZone)).toBe(true);
        if (!isValidZone(name)) expect(result.events).toEqual([]);
      }),
      fuzzParams(100),
    );
  });

  it("huge fields are cut short, not copied whole", () => {
    const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:h", "DTSTART:20261205T100000Z", "DTEND:20261205T110000Z", `SUMMARY:${"s".repeat(300_000)}`, `DESCRIPTION:${"d".repeat(300_000)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const [ev] = parseIcs(text).events;
    expect(ev?.summary?.length).toBeLessThanOrEqual(20_000);
    expect(ev?.description?.length).toBeLessThanOrEqual(20_000);
  });
});
