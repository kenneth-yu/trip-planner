import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, byTitle, fixtureItem } from "@/fixtures/december-trip";
import { buildFlightCard } from "./flight-card";
import { formatClock, homeReference, toLocal, formatDayHeader } from "./format";

const trip = buildFixtureTrip();
const NY = "America/New_York";
const card = (n: string) => buildFlightCard(fixtureItem(trip, byFlight(n)), NY);

describe("flight cards (TIME_RULES expected outputs)", () => {
  it("NH159 JFK to Haneda", () => {
    const c = card("NH159");
    expect(c.dayKey).toBe("2026-12-01");
    expect(`${c.depart.time} ${c.depart.place}`).toBe("12:55am New York, JFK");
    expect(c.duration).toBe("14h 30m");
    expect(`${c.arrive.time} ${c.arrive.place}`).toBe("5:25am Tokyo, Haneda");
    expect(c.arrive.tag).toBe("Wed");
    expect(c.clockSentence).toBe("Lands the next day. Clocks go forward 14 hours.");
    expect(c.arrive.home).toBe("3:25pm Tue NY");
  });

  it("CX509 Narita to Hong Kong", () => {
    const c = card("CX509");
    expect(formatDayHeader(toLocal(fixtureItem(trip, byFlight("CX509")).start))).toBe("Sat Dec 5");
    expect(`${c.depart.time} ${c.depart.place}`).toBe("8:50am Tokyo, Narita");
    expect(c.duration).toBe("5h 35m");
    expect(`${c.arrive.time} ${c.arrive.place}`).toBe("1:25pm Hong Kong");
    expect(c.arrive.tag).toBeNull();
    expect(c.clockSentence).toBe("Clocks go back 1 hour.");
    expect(c.arrive.home).toBe("12:25am NY");
  });

  it("CX520 Hong Kong to Narita", () => {
    const c = card("CX520");
    expect(c.dayKey).toBe("2026-12-13");
    expect(`${c.depart.time} ${c.depart.place}`).toBe("10:30am Hong Kong");
    expect(c.duration).toBe("4h 0m");
    expect(`${c.arrive.time} ${c.arrive.place}`).toBe("3:30pm Tokyo, Narita");
    expect(c.arrive.tag).toBeNull();
    expect(c.clockSentence).toBe("Clocks go forward 1 hour.");
  });

  it("NH160 Haneda to JFK lands at an earlier clock time", () => {
    const c = card("NH160");
    expect(c.dayKey).toBe("2026-12-15");
    expect(`${c.depart.time} ${c.depart.place}`).toBe("10:55pm Tokyo, Haneda");
    expect(c.duration).toBe("13h 0m");
    expect(`${c.arrive.time} ${c.arrive.place}`).toBe("9:55pm New York, JFK");
    expect(c.arrive.tag).toBe("Same day");
    expect(c.clockSentence).toBe("Clocks go back 14 hours.");
    expect(c.arrive.home).toBeNull();
  });

  it("head spa shows Tokyo time with a same date NY reference", () => {
    const spa = fixtureItem(trip, byTitle("Head spa"));
    expect(formatClock(toLocal(spa.start))).toBe("6:30pm");
    expect(homeReference(spa.start, NY)).toBe("4:30am NY");
  });
});

describe("edge cases", () => {
  it("handles DST: a March US flight sees the offset at that instant", async () => {
    const { fromLocal } = await import("./format");
    const { clockSentence } = await import("./flight-card");
    const s = clockSentence({
      start: fromLocal("2026-03-10T10:00", "Europe/London"),
      end: fromLocal("2026-03-10T13:00", "America/New_York"),
    });
    expect(s).toBe("Clocks go back 4 hours.");
  });

  it("crossing the date line eastbound lands the day before", async () => {
    const { fromLocal } = await import("./format");
    const { clockSentence } = await import("./flight-card");
    const s = clockSentence({
      start: fromLocal("2026-12-02T01:00", "Asia/Tokyo"),
      end: fromLocal("2026-12-01T18:00", "Pacific/Honolulu"),
    });
    expect(s).toBe("Lands the day before. Clocks go back 19 hours.");
  });

  it("formats noon and midnight as words", async () => {
    const { DateTime } = await import("./luxon");
    expect(formatClock(DateTime.fromISO("2026-12-01T12:00"))).toBe("noon");
    expect(formatClock(DateTime.fromISO("2026-12-01T00:00"))).toBe("midnight");
  });
});
