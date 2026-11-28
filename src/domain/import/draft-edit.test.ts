import { describe, expect, it } from "vitest";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { projectTrip, type VisibleItem } from "../visibility/project";
import type { ItemPrivate, Requester } from "../types";
import { editPatch, itemToFormValues, MESSAGES, parseEditForm, parseItemForm, type FormEntries } from "./item-form";
import { inputToProposal } from "./quick-add";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
const agg = buildFixtureTrip();
const view = projectTrip(agg, kenny);
const flight = present(view.items.find((i) => i.type === "flight"));
const places = { homeZone: "America/New_York" };

function estimatedDraft(): VisibleItem {
  const f = present(flight.flight);
  return { ...flight, title: `${f.fromAirport} to ${f.toAirport}`, booked: false, private: [], notes: "", endIsEstimated: true, flight: { fromAirport: f.fromAirport, toAirport: f.toAirport, flightNumber: "" } };
}

function entriesOf(item: VisibleItem): FormEntries {
  return [["type", item.type], ...Object.entries(itemToFormValues(item, view.travelers.filter((t) => item.travelerIds.includes(t.id))).fields).map(([k, v]): [string, string] => [k, v])];
}

function submit(item: VisibleItem, changes: Record<string, string>) {
  const entries = entriesOf(item).filter(([k]) => !(k in changes)).concat(Object.entries(changes));
  const parsed = parseEditForm(entries, { travelerIds: item.travelerIds, previous: item.private, wasBooked: item.booked });
  if (!parsed.ok) return { parsed, patch: null };
  const proposal = inputToProposal({ ...parsed.input, travelers: item.travelerIds }, agg.travelers, places, { draft: !parsed.booked, endEstimated: parsed.endEstimated });
  return { parsed, patch: editPatch(item, proposal, parsed.private, parsed.booked) };
}

describe("a draft flight whose arrival is an estimate", () => {
  const item = estimatedDraft();

  it("is edited by how long it takes, not by an arrival time it never had", () => {
    const fields = itemToFormValues(item, []).fields;
    expect(fields.arrives).toBeUndefined();
    expect(Number(fields.hours) * 60 + Number(fields.minutes)).toBe(Math.round((Date.parse(item.end.at) - Date.parse(item.start.at)) / 60000));
  });

  it("saving it again changes nothing and keeps the estimate", () => {
    const { parsed, patch } = submit(item, { booked: "no" });
    expect(parsed.ok && parsed.endEstimated).toBe(true);
    expect(patch).toEqual({});
  });

  it("marking it booked needs a real arrival time, and then the estimate is gone", () => {
    const missing = submit(item, { booked: "yes", flightNumber: "NH159" });
    expect(missing.parsed.ok).toBe(false);
    if (!missing.parsed.ok) expect(missing.parsed.errors.arrives).toBe(MESSAGES.time);
    const real = submit(item, { booked: "yes", flightNumber: "NH159", arrives: "05:25" });
    expect(real.parsed.ok && real.parsed.endEstimated).toBe(false);
    expect(real.patch?.endIsEstimated).toBe(false);
    expect(real.patch?.booked).toBe(true);
  });
});

describe("how long a flight takes, typed by a person", () => {
  const base: FormEntries = [["type", "flight"], ["booked", "no"], ["from", "JFK"], ["to", "HKG"], ["date", "2027-01-15"], ["departs", "09:00"]];

  it.each([
    [{ hours: "abc" }, "hours", MESSAGES.hours],
    [{ hours: "16h" }, "hours", MESSAGES.hours],
    [{ hours: "-3" }, "hours", MESSAGES.hours],
    [{ hours: "49" }, "hours", MESSAGES.hours],
    [{ hours: "10", minutes: "75" }, "minutes", MESSAGES.minutes],
    [{ hours: "10", minutes: "x" }, "minutes", MESSAGES.minutes],
  ])("%j is a field error, never read as zero", (typed, field, message) => {
    const r = parseItemForm([...base, ...Object.entries(typed)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field]).toBe(message);
  });

  it("whole hours alone, whole minutes alone, and both are fine", () => {
    for (const typed of [{ hours: "16" }, { minutes: "45" }, { hours: "16", minutes: "30" }]) expect(parseItemForm([...base, ...Object.entries(typed)]).ok).toBe(true);
  });
});

describe("what a draft leaves out when it is added", () => {
  it("drops seats typed before Not yet was chosen", () => {
    const r = parseItemForm([["type", "flight"], ["booked", "no"], ["from", "JFK"], ["to", "HKG"], ["date", "2027-01-15"], ["departs", "09:00"], ["hours", "16"], ["seat:t1", "30K"]]);
    expect(r.ok && r.input.type === "flight" && r.input.seats).toBeFalsy();
  });
});

describe("what the form and the server agree Not yet drops", () => {
  const rows: ItemPrivate[][] = [
    [{ travelerId: null, confirmationCode: "ABC123" }],
    [{ travelerId: null, bookingReference: "REF9" }],
    [{ travelerId: null, price: { amount: "10", currency: "USD" } }],
    [{ travelerId: null, seat: "30K" }],
    [{ travelerId: null, bookingSite: "airline.example" }],
  ];

  it.each(rows.map((r) => [r]))("%j makes the form ask, and the server ask for the same", (row) => {
    const item: VisibleItem = { ...flight, private: row };
    expect(itemToFormValues(item, []).losesOnNotYet).toBe(true);
    const { parsed } = submit(item, { booked: "no" });
    expect(parsed.ok).toBe(false);
  });

  it("neither asks about a phone or notes, which stay", () => {
    const item: VisibleItem = { ...flight, private: [{ travelerId: null, phone: "+1 555 010 0000", notes: "Window" }] };
    expect(itemToFormValues(item, []).losesOnNotYet).toBe(false);
    expect(submit(item, { booked: "no" }).parsed.ok).toBe(true);
  });
});

describe("switching a booked item to Not yet", () => {
  const withCode: ItemPrivate[] = [{ travelerId: flight.travelerIds[0] ?? null, confirmationCode: "ABC123", seat: "30K" }];
  const booked: VisibleItem = { ...flight, private: withCode };

  it("asks first, because it removes the code, seats and price", () => {
    const { parsed } = submit(booked, { booked: "no" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.confirmDrop).toBe(MESSAGES.confirmDrop);
  });

  it("goes ahead once confirmed, and the rows are gone", () => {
    const { parsed, patch } = submit(booked, { booked: "no", confirmDrop: "yes" });
    expect(parsed.ok).toBe(true);
    expect(patch?.booked).toBe(false);
    expect(patch?.private?.some((r) => r.confirmationCode || r.seat)).toBeFalsy();
  });

  it("asks nothing when there is nothing to lose", () => {
    const { parsed } = submit({ ...flight, private: [] }, { booked: "no" });
    expect(parsed.ok).toBe(true);
  });
});
