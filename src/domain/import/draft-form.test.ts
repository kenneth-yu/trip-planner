import { describe, expect, it } from "vitest";
import { buildFixtureTrip } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { projectTrip } from "../visibility/project";
import type { Requester } from "../types";
import { USERS } from "@/fixtures/december-trip";
import { editPatch, itemToFormValues, MESSAGES, parseEditForm, parseItemForm, type FormEntries } from "./item-form";
import { InputProblem, inputToProposal } from "./quick-add";

const draftFlight: FormEntries = [
  ["type", "flight"],
  ["booked", "no"],
  ["from", "JFK"],
  ["to", "HKG"],
  ["date", "2027-01-15"],
  ["departs", "09:00"],
  ["hours", "16"],
  ["minutes", "0"],
];

describe("a draft flight from the form", () => {
  it("needs no flight number and no arrival time, only how long it takes, and says the arrival is an estimate", () => {
    const r = parseItemForm(draftFlight);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toMatchObject({ type: "flight", fromAirport: "JFK", toAirport: "HKG", departLocal: "2027-01-15T09:00", arriveLocal: "2027-01-16T14:00" });
    expect(r.input.type === "flight" && r.input.flightNumber).toBeFalsy();
    expect(r.endEstimated).toBe(true);
    expect(r.sharing.booked).toBe(false);
  });

  it("asks for an arrival time or how long it takes, when neither is given", () => {
    const r = parseItemForm(draftFlight.filter(([k]) => k !== "hours" && k !== "minutes"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.arrives).toBe(MESSAGES.arrivalOrDuration);
  });

  it("uses a typed arrival time over the flight time, and then it is not an estimate", () => {
    const r = parseItemForm([...draftFlight, ["arrives", "14:00"]]);
    expect(r.ok && r.endEstimated).toBe(false);
    expect(r.ok && r.input.type === "flight" && r.input.arriveLocal).toBe("2027-01-16T14:00");
  });

  it("a booked flight still needs its number and its arrival time", () => {
    const booked = draftFlight.map(([k, v]): [string, string] => (k === "booked" ? [k, "yes"] : [k, v]));
    const r = parseItemForm(booked);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.flightNumber).toBe(MESSAGES.flightNumber);
      expect(r.errors.arrives).toBe(MESSAGES.time);
    }
  });

  it("a number that is given must still look like one", () => {
    const r = parseItemForm([...draftFlight, ["flightNumber", "hello"]]);
    expect(r.ok).toBe(false);
  });

  it("leaves out the booked-only details: code, reference, price and the cancellation deadline", () => {
    const r = parseItemForm([...draftFlight, ["confirmationCode", "ABC123"], ["bookingReference", "REF9"], ["price", "$240"], ["deadlineDate", "2027-01-10"], ["notes", "Window seat please"]]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.confirmationCode).toBeUndefined();
    expect(r.input.bookingReference).toBeUndefined();
    expect(r.input.price).toBeUndefined();
    expect(r.input.deadlines).toBeUndefined();
    expect(r.input.notes).toBe("Window seat please");
  });

  it("a stay marked Not yet keeps its dates and drops the booked-only details", () => {
    const r = parseItemForm([["type", "stay"], ["booked", "no"], ["name", "Harbour Hotel"], ["place", "Hong Kong"], ["checkInDate", "2027-01-16"], ["checkOutDate", "2027-01-27"], ["confirmationCode", "ZZ1"]]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.confirmationCode).toBeUndefined();
  });
});

describe("a draft flight as an item", () => {
  const input = { type: "flight" as const, fromAirport: "JFK", toAirport: "HKG", departLocal: "2027-01-15T09:00", arriveLocal: "2027-01-16T14:00" };
  const places = { homeZone: "America/New_York" };

  it("is titled by its airports and keeps the estimate flag", () => {
    const p = inputToProposal(input, [], places, { draft: true, endEstimated: true });
    expect(p.title).toBe("JFK to HKG");
    expect(p.flight?.flightNumber).toBe("");
    expect(p.endIsEstimated).toBe(true);
  });

  it("a flight that is booked, or sent by an assistant, still needs a number", () => {
    expect(() => inputToProposal(input, [], places)).toThrow(InputProblem);
  });
});

describe("editing a draft", () => {
  const agg = buildFixtureTrip();
  const requester: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
  const item = present(projectTrip(agg, requester).items.find((i) => i.type === "flight"));

  it("shows an existing booked item as Yes, and a draft as Not yet", () => {
    expect(itemToFormValues(item, []).fields.booked).toBe("yes");
    expect(itemToFormValues({ ...item, booked: false }, []).fields.booked).toBe("no");
  });

  it("marking it booked is a patch of its own, and a draft ignores seats and codes typed earlier", () => {
    const entries: FormEntries = [...Object.entries(itemToFormValues(item, []).fields).map(([k, v]): [string, string] => [k, v]), ["type", "flight"]];
    const asDraft = entries.map(([k, v]): [string, string] => (k === "booked" ? [k, "no"] : [k, v]));
    const parsed = parseEditForm([...asDraft, [`seat:${item.travelerIds[0]}`, "30K"]], { travelerIds: item.travelerIds, previous: [] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.booked).toBe(false);
    expect(parsed.private.some((row) => row.seat)).toBe(false);
    const proposal = inputToProposal({ ...parsed.input, travelers: item.travelerIds }, agg.travelers, { homeZone: "America/New_York" }, { draft: true });
    expect(editPatch(item, proposal, parsed.private, false).booked).toBe(false);
    expect(editPatch({ ...item, booked: false }, proposal, parsed.private, true).booked).toBe(true);
    expect(editPatch(item, proposal, parsed.private, true).booked).toBeUndefined();
  });
});
