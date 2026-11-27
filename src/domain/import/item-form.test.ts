import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, byTitle, fixtureItem, TRAVELERS, USERS } from "@/fixtures/december-trip";
import { inputToProposal } from "./quick-add";
import { arrivalAfter } from "./arrival";
import { airlineFor } from "./airlines";
import { FORM_ERROR, MESSAGES, parseClock, parseItemForm, type FormEntries } from "./item-form";

const trip = buildFixtureTrip();
const places = { homeZone: "America/New_York" };

const nh159: FormEntries = [
  ["type", "flight"],
  ["flightNumber", "NH 159"],
  ["date", "2026-12-01"],
  ["from", "JFK"],
  ["to", "Tokyo Haneda HND"],
  ["departs", "00:55"],
  ["arrives", "5:25am"],
  [`seat:${TRAVELERS.kenny}`, "30K"],
  [`seat:${TRAVELERS.jacob}`, "30C"],
  ["confirmationCode", "PLACEHOLDER_A"],
];

function failure(entries: FormEntries) {
  const r = parseItemForm(entries);
  if (r.ok) throw new Error("Expected the form to fail");
  return r;
}

describe("quick add form to ItemInput", () => {
  it("enters NH159 with two seats and lands on the fixture instants", () => {
    const r = parseItemForm(nh159);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({
      type: "flight",
      flightNumber: "NH 159",
      airline: "ANA",
      fromAirport: "JFK",
      toAirport: "HND",
      departLocal: "2026-12-01T00:55",
      arriveLocal: "2026-12-02T05:25",
      seats: [
        { traveler: TRAVELERS.kenny, seat: "30K" },
        { traveler: TRAVELERS.jacob, seat: "30C" },
      ],
    });
    const p = inputToProposal(r.input, trip.travelers, places);
    const expected = fixtureItem(trip, byFlight("NH159"));
    expect([p.start, p.end]).toEqual([expected.start, expected.end]);
    expect(r.sharing).toEqual({ visibility: "everyone", visibleToUserIds: [], showAsBusy: false });
  });

  it("accepts a city with one airport and an airport code in parentheses", () => {
    const r = parseItemForm([...nh159.filter(([k]) => k !== "to"), ["to", "Tokyo (HND)"]]);
    expect(r.ok).toBe(true);
  });

  it("enters Hotel Resol Ueno with default times marked estimated", () => {
    const r = parseItemForm([
      ["type", "stay"],
      ["name", "Hotel Resol Ueno"],
      ["place", "Tokyo"],
      ["checkInDate", "2026-12-13"],
      ["checkInTime", "15:00"],
      ["checkOutDate", "2026-12-15"],
      ["checkOutTime", "11:00"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const p = inputToProposal(r.input, trip.travelers, places);
    const expected = fixtureItem(trip, (i) => i.title === "Hotel Resol Ueno" && i.start.at.startsWith("2026-12-13"));
    expect([p.start, p.end]).toEqual([expected.start, expected.end]);
    expect([p.startIsEstimated, p.endIsEstimated]).toEqual([true, true]);
  });

  it("keeps a check in time the person changed", () => {
    const r = parseItemForm([
      ["type", "stay"],
      ["name", "Hotel Resol Ueno"],
      ["place", "Tokyo"],
      ["checkInDate", "2026-12-02"],
      ["checkInTime", "15:00"],
      ["checkInEdited", "1"],
      ["checkOutDate", "2026-12-05"],
      ["checkOutTime", "10:30"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const p = inputToProposal(r.input, trip.travelers, places);
    expect([p.startIsEstimated, p.endIsEstimated]).toEqual([false, false]);
  });

  it("enters the Tim Ho Wan plan", () => {
    const r = parseItemForm([
      ["type", "plan"],
      ["title", "Tim Ho Wan"],
      ["place", "Hong Kong"],
      ["date", "2026-12-05"],
      ["starts", "7:00pm"],
      ["ends", "8:30pm"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({ type: "plan", title: "Tim Ho Wan", city: "Hong Kong", startLocal: "2026-12-05T19:00", endLocal: "2026-12-05T20:30" });
    const p = inputToProposal(r.input, trip.travelers, places);
    expect(p.start.zone).toBe("Asia/Hong_Kong");
  });

  it("enters the Hong Kong to Shenzhen transfer across two zones", () => {
    const r = parseItemForm([
      ["type", "transfer"],
      ["from", "Hong Kong"],
      ["to", "Shenzhen"],
      ["mode", "train"],
      ["date", "2026-12-06"],
      ["departs", "11:00"],
      ["arrives", "12:15"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({ type: "transfer", mode: "train", fromCity: "Hong Kong", toCity: "Shenzhen", endLocal: "2026-12-06T12:15" });
    const p = inputToProposal(r.input, trip.travelers, places);
    expect([p.start.zone, p.end.zone]).toEqual(["Asia/Hong_Kong", "Asia/Shanghai"]);
    expect(fixtureItem(trip, byTitle("Hotel Resol")).start.zone).toBe("Asia/Tokyo");
  });

  it("rolls a plan that ends after midnight to the next day", () => {
    const r = parseItemForm([
      ["type", "plan"],
      ["title", "Karaoke"],
      ["place", "Tokyo"],
      ["date", "2026-12-03"],
      ["starts", "10:00pm"],
      ["ends", "1:00am"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({ endLocal: "2026-12-04T01:00" });
  });

  it("puts a street address in the address field and a bare city in the city field", () => {
    const r = parseItemForm([
      ["type", "stay"],
      ["name", "Stanford Hotel"],
      ["place", "118 Soy Street, Mong Kok, Kowloon, Hong Kong"],
      ["checkInDate", "2026-12-05"],
      ["checkInTime", "15:00"],
      ["checkOutDate", "2026-12-06"],
      ["checkOutTime", "11:00"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({ address: "118 Soy Street, Mong Kok, Kowloon, Hong Kong" });
    expect("city" in r.input).toBe(false);
  });

  it("collects confirmation code, phone, price, notes and a cancellation deadline", () => {
    const r = parseItemForm([
      ...nh159,
      ["phone", "+81 3 0000 0000"],
      ["price", "$1,183.22"],
      ["notes", "Window seat"],
      ["deadlineDate", "2026-11-28"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({
      confirmationCode: "PLACEHOLDER_A",
      phone: "+81 3 0000 0000",
      price: { amount: "1183.22", currency: "USD" },
      notes: "Window seat",
      deadlines: [{ kind: "free_cancellation", local: "2026-11-28T23:59" }],
    });
  });

  it("reads prices with a currency code", () => {
    const yen = parseItemForm([...nh159, ["price", "JPY 45000"]]);
    const euro = parseItemForm([...nh159, ["price", "€240"]]);
    expect(yen.ok && yen.input.price).toEqual({ amount: "45000", currency: "JPY" });
    expect(euro.ok && euro.input.price).toEqual({ amount: "240", currency: "EUR" });
  });
});

describe("quick add form errors", () => {
  const without = (name: string) => nh159.filter(([k]) => k !== name);
  const with_ = (name: string, value: string): FormEntries => [...without(name), [name, value]];

  it("asks for the flight number, and for one that looks right", () => {
    expect(failure(with_("flightNumber", "")).errors.flightNumber).toBe(MESSAGES.flightNumber);
    expect(failure(with_("flightNumber", "hello")).errors.flightNumber).toBe(MESSAGES.flightNumberShape);
  });

  it("asks for an airport code when a place is unknown or has several airports", () => {
    expect(failure(with_("from", "Nowhereville")).errors.from).toBe(MESSAGES.place);
    expect(failure(with_("to", "Tokyo")).errors.to).toBe(MESSAGES.place);
    expect(failure(with_("to", "")).errors.to).toBe(MESSAGES.place);
  });

  it("asks for a time like 8:50am", () => {
    expect(failure(with_("departs", "soon")).errors.departs).toBe(MESSAGES.time);
    expect(failure(with_("arrives", "")).errors.arrives).toBe(MESSAGES.time);
    expect(failure(with_("arrives", "25:00")).errors.arrives).toBe(MESSAGES.time);
  });

  it("asks for a date", () => {
    expect(failure(with_("date", "")).errors.date).toBe(MESSAGES.date);
    expect(failure(with_("date", "2026-02-30")).errors.date).toBe(MESSAGES.date);
  });

  it("says when the arrival cannot follow the departure within a day", () => {
    const r = failure([
      ["type", "flight"],
      ["flightNumber", "NH 1"],
      ["date", "2026-12-05"],
      ["from", "HND"],
      ["to", "NRT"],
      ["departs", "10:00"],
      ["arrives", "10:00"],
    ]);
    expect(r.errors.arrives).toBe(MESSAGES.arrivalBeforeDeparture);
  });

  it("says when check out is before check in", () => {
    const r = failure([
      ["type", "stay"],
      ["name", "Hotel Resol Ueno"],
      ["place", "Tokyo"],
      ["checkInDate", "2026-12-05"],
      ["checkOutDate", "2026-12-02"],
    ]);
    expect(r.errors.checkOutDate).toBe(MESSAGES.checkOutBeforeCheckIn);
  });

  it("asks for at least one person when Pick people has nobody", () => {
    const r = failure([...nh159, ["visibility", "specific"]]);
    expect(r.errors.person).toBe(MESSAGES.people);
  });

  it("drops people who are not on the trip", () => {
    const r = parseItemForm([...nh159, ["visibility", "specific"], ["person", "someone-else"]], [USERS.kenny.id, USERS.jacob.id]);
    expect(r.ok).toBe(false);
    const ok = parseItemForm([...nh159, ["visibility", "specific"], ["person", USERS.jacob.id], ["person", "someone-else"]], [USERS.kenny.id, USERS.jacob.id]);
    expect(ok.ok && ok.sharing.visibleToUserIds).toEqual([USERS.jacob.id]);
  });

  it("echoes everything typed back when something is wrong", () => {
    const entries = with_("flightNumber", "hello");
    expect(failure(entries).values).toEqual(entries);
  });

  it("asks for the other required fields by type", () => {
    expect(failure([["type", "stay"]]).errors).toMatchObject({ name: MESSAGES.name, place: MESSAGES.cityOrAddress, checkInDate: MESSAGES.date });
    expect(failure([["type", "plan"]]).errors).toMatchObject({ title: MESSAGES.title, place: MESSAGES.cityOrAddress });
    expect(failure([["type", "transfer"]]).errors).toMatchObject({ from: MESSAGES.cityOrAddress, to: MESSAGES.cityOrAddress });
    expect(failure([]).errors.type).toBeDefined();
    expect(FORM_ERROR).toBe("That did not save. Your entries are still here. Try again.");
  });

  it("rejects a bad price", () => {
    expect(failure([...nh159, ["price", "a lot"]]).errors.price).toBe(MESSAGES.price);
  });
});

describe("who can see an item", () => {
  it("only me, with show as busy", () => {
    const r = parseItemForm([...nh159, ["visibility", "only_me"], ["showAsBusy", "on"]]);
    expect(r.ok && r.sharing).toEqual({ visibility: "only_me", visibleToUserIds: [], showAsBusy: true });
  });

  it("ignores show as busy for everyone", () => {
    const r = parseItemForm([...nh159, ["showAsBusy", "on"]]);
    expect(r.ok && r.sharing.showAsBusy).toBe(false);
  });

  it("pick people", () => {
    const r = parseItemForm([...nh159, ["visibility", "specific"], ["person", USERS.jacob.id]]);
    expect(r.ok && r.sharing).toEqual({ visibility: "specific", visibleToUserIds: [USERS.jacob.id], showAsBusy: false });
  });
});

describe("times and airlines", () => {
  it("reads clock text", () => {
    expect(parseClock("8:50am")).toBe("08:50");
    expect(parseClock("12am")).toBe("00:00");
    expect(parseClock("12:30 PM")).toBe("12:30");
    expect(parseClock("noon")).toBe("12:00");
    expect(parseClock("13:05")).toBe("13:05");
    expect(parseClock("13pm")).toBeNull();
    expect(parseClock("")).toBeNull();
  });

  it("finds the arrival date across the date line and flags the next day", () => {
    expect(arrivalAfter("2026-12-01T00:55", "America/New_York", "05:25", "Asia/Tokyo")).toEqual({ local: "2026-12-02T05:25", nextDay: true });
    expect(arrivalAfter("2026-12-15T17:00", "Asia/Tokyo", "21:55", "America/New_York")).toEqual({ local: "2026-12-15T21:55", nextDay: false });
  });

  it("derives the airline from the flight number when it knows the carrier", () => {
    expect(airlineFor("CX 509")).toBe("Cathay Pacific");
    expect(airlineFor("ZZ 1")).toBeNull();
  });
});
