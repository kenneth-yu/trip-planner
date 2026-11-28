import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, byTitle, fixtureItem, TRAVELERS, USERS } from "@/fixtures/december-trip";
import { inputToProposal } from "./quick-add";
import { arrivalAfter, dayNote, sameDayClockRoll } from "./arrival";
import { airlineFor } from "./airlines";
import { editPatch, entriesOfValues, FORM_ERROR, itemToFormValues, MESSAGES, parseClock, parseEditForm, parseItemForm, parseTripId, type FormEntries } from "./item-form";
import { projectTrip, type VisibleItem } from "../visibility/project";
import { present } from "@/testing/present";
import type { ProposedItem } from "./proposal";

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
    expect(r.sharing).toEqual({ visibility: "everyone", visibleToUserIds: [], showAsBusy: false, booked: true });
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
    const r = parseItemForm([...nh159, ["visibility", "specific"], ["person", "someone-else"]], { memberIds: [USERS.kenny.id, USERS.jacob.id] });
    expect(r.ok).toBe(false);
    const ok = parseItemForm([...nh159, ["visibility", "specific"], ["person", USERS.jacob.id], ["person", "someone-else"]], { memberIds: [USERS.kenny.id, USERS.jacob.id] });
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
    expect(r.ok && r.sharing).toEqual({ visibility: "only_me", visibleToUserIds: [], showAsBusy: true, booked: true });
  });

  it("ignores show as busy for everyone", () => {
    const r = parseItemForm([...nh159, ["showAsBusy", "on"]]);
    expect(r.ok && r.sharing.showAsBusy).toBe(false);
  });

  it("pick people", () => {
    const r = parseItemForm([...nh159, ["visibility", "specific"], ["person", USERS.jacob.id]]);
    expect(r.ok && r.sharing).toEqual({ visibility: "specific", visibleToUserIds: [USERS.jacob.id], showAsBusy: false, booked: true });
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
    expect(arrivalAfter("2026-12-01T00:55", "America/New_York", "05:25", "Asia/Tokyo")).toEqual({ local: "2026-12-02T05:25", dayOffset: 1 });
    expect(arrivalAfter("2026-12-15T17:00", "Asia/Tokyo", "21:55", "America/New_York")).toEqual({ local: "2026-12-15T21:55", dayOffset: 0 });
  });

  it("derives the airline from the flight number when it knows the carrier", () => {
    expect(airlineFor("CX 509")).toBe("Cathay Pacific");
    expect(airlineFor("ZZ 1")).toBeNull();
  });
});

describe("arrival on the previous local date", () => {
  it("accepts Tokyo to Honolulu, which lands the day before", () => {
    expect(arrivalAfter("2026-12-02T00:30", "Asia/Tokyo", "12:50", "Pacific/Honolulu")).toEqual({ local: "2026-12-01T12:50", dayOffset: -1 });
    expect(dayNote(-1, "Lands")).toBe("Lands the day before");
    expect(dayNote(1, "Lands")).toBe("Lands the next day");
    expect(dayNote(0, "Lands")).toBeNull();
  });

  it("enters NRT to HNL as a flight", () => {
    const r = parseItemForm([
      ["type", "flight"],
      ["flightNumber", "JL 782"],
      ["date", "2026-12-02"],
      ["from", "NRT"],
      ["to", "HNL"],
      ["departs", "00:30"],
      ["arrives", "12:50"],
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({ arriveLocal: "2026-12-01T12:50" });
    const p = inputToProposal(r.input, trip.travelers, places);
    expect(p.end.at > p.start.at).toBe(true);
  });

  it("rolls a clock that is earlier than the start to the next date without a zone", () => {
    expect(sameDayClockRoll("2026-12-03", "22:00", "01:00")).toEqual({ local: "2026-12-04T01:00", dayOffset: 1 });
    expect(sameDayClockRoll("2026-12-03", "19:00", "20:30")).toEqual({ local: "2026-12-03T20:30", dayOffset: 0 });
  });
});

describe("places we cannot place", () => {
  const transfer = (from: string, departs: string, arrives: string): FormEntries => [
    ["type", "transfer"],
    ["from", from],
    ["to", "Shenzhen"],
    ["date", "2026-12-06"],
    ["departs", departs],
    ["arrives", arrives],
  ];

  it("does not derive an arrival date in a made up zone when the origin is unknown", () => {
    const r = parseItemForm(transfer("Xyzzyville", "09:00", "11:00"));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input).toMatchObject({ endLocal: "2026-12-06T11:00" });
    const p = inputToProposal(r.input, trip.travelers, places);
    expect(p.status).toBe("needs_review");
    expect(p.problems.join(" ")).toContain("Xyzzyville");
    expect(new Date(p.end.at).getTime() - new Date(p.start.at).getTime()).toBe(2 * 3600000);
    expect([p.start.zone, p.end.zone]).toEqual(["Asia/Shanghai", "Asia/Shanghai"]);
  });

  it("asks for a check of the times instead of rolling the date when the origin is unknown", () => {
    expect(failure(transfer("Xyzzyville", "23:00", "01:00")).errors.arrives).toBe(MESSAGES.arrivalBeforeDeparture);
  });

  it("uses the zones the caller resolved, so the form agrees with the saved item", () => {
    const zoneOf = (q: { city?: string }) => (q.city === "Hong Kong" ? "Asia/Hong_Kong" : "Asia/Shanghai");
    const r = parseItemForm(transfer("Hong Kong", "23:30", "00:45"), { zoneOf });
    expect(r.ok && r.input).toMatchObject({ endLocal: "2026-12-07T00:45" });
  });
});

describe("plan end", () => {
  const plan = (ends: string): FormEntries => [
    ["type", "plan"],
    ["title", "Tim Ho Wan"],
    ["place", "Hong Kong"],
    ["date", "2026-12-05"],
    ["starts", "7:30pm"],
    ["ends", ends],
  ];

  it("is optional and defaults to one hour marked estimated", () => {
    const r = parseItemForm(plan(""));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect("endLocal" in r.input && r.input.endLocal).toBeFalsy();
    const p = inputToProposal(r.input, trip.travelers, places);
    expect(p.endIsEstimated).toBe(true);
    expect(new Date(p.end.at).getTime() - new Date(p.start.at).getTime()).toBe(3600000);
    expect(p.end.zone).toBe("Asia/Hong_Kong");
  });

  it("is not estimated when given", () => {
    const r = parseItemForm(plan("9pm"));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(inputToProposal(r.input, trip.travelers, places).endIsEstimated).toBe(false);
  });

  it("still rejects an end that is not a time", () => {
    expect(failure(plan("late")).errors.ends).toBe(MESSAGES.time);
  });
});

describe("limits and ids", () => {
  it("says a too long value is too long, on its own field", () => {
    expect(failure([...nh159.filter(([k]) => k !== "confirmationCode"), ["confirmationCode", "X".repeat(61)]]).errors.confirmationCode).toBe(MESSAGES.tooLong);
    expect(failure([["type", "stay"], ["name", "N".repeat(201)], ["place", "Tokyo"], ["checkInDate", "2026-12-02"], ["checkOutDate", "2026-12-05"]]).errors.name).toBe(MESSAGES.tooLong);
  });

  it("treats a malformed trip id as no trip", () => {
    expect(parseTripId("nope")).toBeNull();
    expect(parseTripId(undefined)).toBeNull();
    expect(parseTripId("00000000-0000-4000-8300-000000000001")).toBe("00000000-0000-4000-8300-000000000001");
  });

  it("uses one message for a place we cannot find", () => {
    expect(MESSAGES.place).toBe("We can't find that place. Try an airport code like HND.");
  });
});

describe("itemToFormValues round trip", () => {
  const owner = { kind: "member" as const, userId: USERS.kenny.id, homeZone: "America/New_York" };
  const view = projectTrip(trip, owner);

  function visible(p: ProposedItem, id: string): VisibleItem {
    return {
      ...p,
      id,
      tripId: view.trip.id,
      visibility: "everyone",
      visibleToUserIds: [],
      showAsBusy: false,
      booked: true,
      flags: p.problems,
      deadlines: [],
      createdBy: USERS.kenny.id,
      updatedBy: USERS.kenny.id,
      createdAt: "2026-11-20T12:00:00.000Z",
      updatedAt: "2026-11-20T12:00:00.000Z",
    };
  }

  const nozomi = visible(
    inputToProposal({ type: "transfer", title: "Nozomi 17 to Kyoto", mode: "train", fromCity: "Tokyo", toCity: "Kyoto", country: "Japan", startLocal: "2027-03-11T09:00", endLocal: "2027-03-11T11:15" }, view.travelers, places),
    "transfer-1",
  );
  const dinner = visible(inputToProposal({ type: "plan", title: "Tim Ho Wan", city: "Hong Kong", startLocal: "2026-12-11T11:00", endLocal: "2026-12-11T12:30" }, view.travelers, places), "plan-1");

  function roundTrip(item: VisibleItem) {
    const travelers = view.travelers.filter((t) => item.travelerIds.includes(t.id));
    const parsed = parseEditForm(entriesOfValues(itemToFormValues(item, travelers)), { travelerIds: item.travelerIds, previous: item.private });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const proposal = inputToProposal({ ...parsed.input, travelers: item.travelerIds }, view.travelers, places);
    return { proposal, patch: editPatch(item, proposal, parsed.private), parsed };
  }

  it.each([
    ["NH159", view.items.find((i) => i.flight?.flightNumber === "NH159")],
    ["CX509", view.items.find((i) => i.flight?.flightNumber === "CX509")],
    ["Hotel Resol Ueno", view.items.find((i) => i.title === "Hotel Resol Ueno")],
    ["a plan", dinner],
    ["a transfer", nozomi],
  ])("%s comes back from its own form values with no change", (_, found) => {
    const item = found ?? dinner;
    const { patch } = roundTrip(item);
    expect(patch).toEqual({});
  });

  it("reads the Nozomi time in its own zone and keeps the instant right when 9:00 becomes 9:30", () => {
    const entries = entriesOfValues(itemToFormValues(nozomi, view.travelers)).map(([k, v]): [string, string] => (k === "departs" ? [k, "09:30"] : [k, v]));
    const parsed = parseEditForm(entries, { travelerIds: nozomi.travelerIds, previous: [] });
    if (!parsed.ok) throw new Error("expected ok");
    const proposal = inputToProposal({ ...parsed.input, travelers: nozomi.travelerIds }, view.travelers, places);
    expect(proposal.start).toEqual({ at: "2027-03-11T00:30:00.000Z", zone: "Asia/Tokyo" });
    expect(editPatch(nozomi, proposal, parsed.private).start).toEqual(proposal.start);
  });

  it("keeps an arrival in its own zone, not the home zone", () => {
    const nh159Item = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));
    const values = itemToFormValues(nh159Item, view.travelers);
    expect(values.fields).toMatchObject({ date: "2026-12-01", departs: "00:55", arrives: "05:25", to: "HND" });
  });

  it("flags a time in a clock change gap instead of shifting it silently", () => {
    const item = visible(inputToProposal({ type: "plan", title: "Early run", city: "New York", startLocal: "2027-03-14T01:00", endLocal: "2027-03-14T03:00" }, view.travelers, places), "plan-2");
    const entries = entriesOfValues(itemToFormValues(item, view.travelers)).map(([k, v]): [string, string] => (k === "starts" ? [k, "02:30"] : k === "ends" ? [k, "04:00"] : [k, v]));
    const parsed = parseEditForm(entries, { travelerIds: item.travelerIds, previous: [] });
    if (!parsed.ok) throw new Error("expected ok");
    const proposal = inputToProposal({ ...parsed.input, travelers: item.travelerIds }, view.travelers, places);
    expect(proposal.problems.length).toBeGreaterThan(0);
    const patch = editPatch(item, proposal, parsed.private);
    expect(patch.flags).toEqual(proposal.problems);
    expect(patch.status).toBe("needs_review");
  });

  it("offers a code field per traveler for two travelers and one field for one", () => {
    const flight = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));
    expect(Object.keys(itemToFormValues(flight, view.travelers).fields).filter((k) => k.startsWith("code:"))).toHaveLength(2);
    const single = itemToFormValues(flight, view.travelers.slice(0, 1));
    expect(Object.keys(single.fields)).toContain("confirmationCode");
    expect(Object.keys(single.fields).some((k) => k.startsWith("code:"))).toBe(false);
  });

  it("rejects seats and codes for travelers who are not on the item and too long values", () => {
    const item = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));
    const base = entriesOfValues(itemToFormValues(item, view.travelers));
    expect(parseEditForm([...base, ["seat:not-a-traveler", "1A"]], { travelerIds: item.travelerIds, previous: [] }).ok).toBe(false);
    const tooLong = base.map(([k, v]): [string, string] => (k === `seat:${TRAVELERS.kenny}` ? [k, "x".repeat(21)] : [k, v]));
    const long = parseEditForm(tooLong, { travelerIds: item.travelerIds, previous: [] });
    expect(long.ok ? null : long.errors[`seat:${TRAVELERS.kenny}`]).toBe(MESSAGES.tooLong);
  });

  it("saves codes, booking references and seats in capitals", () => {
    const item = present(view.items.find((i) => i.flight?.flightNumber === "NH159"));
    const base = entriesOfValues(itemToFormValues(item, view.travelers)).filter(([k]) => !k.startsWith("code:") && !k.startsWith("seat:"));
    const parsed = parseEditForm([...base, [`code:${TRAVELERS.kenny}`, "ab12cd"], [`seat:${TRAVELERS.kenny}`, "14b"], ["bookingReference", "ref9"]], { travelerIds: item.travelerIds, previous: [] });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.private.map((r) => [r.confirmationCode, r.seat, r.bookingReference])).toEqual([[undefined, "14B", undefined], ["AB12CD", undefined, "REF9"]]);
  });

  it("stores unusual codes and prices as text", () => {
    const item = present(view.items.find((i) => i.title === "Hotel Resol Ueno"));
    const base = entriesOfValues(itemToFormValues(item, view.travelers)).filter(([k]) => !k.startsWith("code:"));
    const entries: FormEntries = [...base, [`code:${TRAVELERS.kenny}`, "<script>1</script> é"], ["price", "$1,200.00"], ["bookingReference", "ab 12"]];
    const parsed = parseEditForm(entries, { travelerIds: item.travelerIds, previous: [] });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.private.find((r) => r.confirmationCode)?.confirmationCode).toBe("<SCRIPT>1</SCRIPT> É");
    expect(parsed.private.find((r) => r.price)?.price).toEqual({ amount: "1200.00", currency: "USD" });
  });
});
