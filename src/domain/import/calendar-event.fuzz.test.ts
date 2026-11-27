import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TRAVELERS } from "@/fixtures/december-trip";
import { isValidZone } from "../time/format";
import { mapCalendarEvent, type CalendarEvent, type MapContext } from "./calendar-event";
import { planCalendarImport } from "./pipeline";
import { InputProblem } from "./quick-add";
import type { ProposedItem } from "./proposal";
import { FUZZ_SEED, fuzzParams, garbageDate, garbageInstant, garbageText, garbageZone, hugeText } from "./fuzz-config";

const ctx: MapContext = { homeZone: "America/New_York", travelerIds: [TRAVELERS.kenny] };
const importCtx = { calendarTravelers: {}, defaultTravelerIds: [TRAVELERS.kenny], homeZone: "America/New_York" };

const optionalText = fc.option(fc.oneof(garbageText, hugeText), { nil: undefined });
const timePart = fc.record({
  dateTime: fc.option(garbageInstant, { nil: undefined }),
  date: fc.option(garbageDate, { nil: undefined }),
  timeZone: fc.option(garbageZone, { nil: undefined }),
});
const timedPart = fc.record({ dateTime: garbageInstant, timeZone: fc.option(garbageZone, { nil: undefined }) });
const allDayPart = fc.record({ date: garbageDate });
const place = fc.option(fc.oneof(garbageText, fc.constantFrom("Haneda Airport", "Tokyo", "1-2-3 Ueno, Tokyo, Japan", "Springfield", "Hong Kong", "Cairo")), { nil: undefined });
const summaryText = fc.option(fc.oneof(garbageText, fc.constantFrom("NH159 JFK → HND", "CX 509 to HKG", "Hotel Resol Ueno (Tokyo)", "Airbnb Kyoto")), { nil: undefined });
const body = {
  id: optionalText,
  calendar: optionalText,
  summary: summaryText,
  description: optionalText,
  location: place,
  htmlLink: optionalText,
};
const eventArb: fc.Arbitrary<CalendarEvent> = fc.oneof(
  fc.record({ ...body, start: timePart, end: timePart }),
  fc.record({ ...body, start: timedPart, end: timedPart }),
  fc.record({ ...body, start: allDayPart, end: allDayPart }),
);

function expectSound(p: ProposedItem) {
  expect(isValidZone(p.start.zone)).toBe(true);
  expect(isValidZone(p.end.zone)).toBe(true);
  expect(Number.isFinite(Date.parse(p.start.at))).toBe(true);
  expect(Number.isFinite(Date.parse(p.end.at))).toBe(true);
  for (const d of p.deadlines) {
    expect(isValidZone(d.at.zone)).toBe(true);
    expect(Number.isFinite(Date.parse(d.at.at))).toBe(true);
  }
  if (p.problems.length) expect(p.status).toBe("needs_review");
  if (Date.parse(p.end.at) < Date.parse(p.start.at)) expect(p.problems.length).toBeGreaterThan(0);
}

function mapOrTyped(ev: CalendarEvent): ProposedItem | null {
  try {
    return mapCalendarEvent(ev, ctx).proposed;
  } catch (e) {
    if (e instanceof InputProblem) return null;
    throw e;
  }
}

describe(`mapCalendarEvent fuzz (seed ${FUZZ_SEED})`, () => {
  it("never throws except a typed problem, and every proposal is sound", () => {
    fc.assert(
      fc.property(eventArb, (ev) => {
        const p = mapOrTyped(ev);
        if (p) expectSound(p);
      }),
      fuzzParams(),
    );
  });

  it("a timed event with no place and no valid calendar zone is flagged for review", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("2026-11-01T00:00:00Z"), max: new Date("2027-01-01T00:00:00Z"), noInvalidDate: true }), fc.option(garbageText, { nil: undefined }), (d, summary) => {
        const start = d.toISOString();
        const end = new Date(d.getTime() + 3_600_000).toISOString();
        const p = mapOrTyped({ summary, start: { dateTime: start }, end: { dateTime: end } });
        if (p) {
          expect(p.problems.length).toBeGreaterThan(0);
          expect(p.status).toBe("needs_review");
        }
      }),
      fuzzParams(),
    );
  });

  it("a start or end without a time of day is refused, never read in the server's zone", () => {
    fc.assert(
      fc.property(
        garbageInstant.filter((t) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)),
        (bad) => {
          expect(() => mapCalendarEvent({ summary: "Dinner", location: "Tokyo, Japan", start: { dateTime: bad }, end: { dateTime: "2026-12-05T21:00:00+09:00" } }, ctx)).toThrow(InputProblem);
        },
      ),
      fuzzParams(),
    );
  });

  it("an event whose zone is not a real zone is flagged, never trusted", () => {
    fc.assert(
      fc.property(
        garbageZone.filter((z) => !isValidZone(z)),
        (zone) => {
          const p = mapOrTyped({ summary: "Dinner", start: { dateTime: "2026-12-05T19:00:00", timeZone: zone }, end: { dateTime: "2026-12-05T21:00:00", timeZone: zone } });
          if (p) {
            expectSound(p);
            expect(p.status).toBe("needs_review");
          }
        },
      ),
      fuzzParams(),
    );
  });

  it("planCalendarImport survives any batch or fails with a typed problem", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 8 }), (events) => {
        try {
          for (const draft of planCalendarImport(events, [], importCtx)) expectSound(draft.proposed);
        } catch (e) {
          if (!(e instanceof InputProblem)) throw e;
        }
      }),
      fuzzParams(150),
    );
  });
});
