import { describe, expect, it } from "vitest";
import { USERS } from "@/fixtures/december-trip";
import { buildDemoTrip } from "@/fixtures/demo-trips";
import { projectTrip } from "../visibility/project";
import type { Requester } from "../types";
import { nowhereToSleep } from "./checks";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };

const flight = (flightNumber: string, fromAirport: string, toAirport: string, departLocal: string, arriveLocal: string) => ({
  input: { type: "flight" as const, flightNumber, fromAirport, toAirport, departLocal, arriveLocal },
});

describe("nowhere to sleep across three time zones", () => {
  const trip = buildDemoTrip({
    index: 9,
    name: "New York, Tokyo, Hong Kong",
    travelers: ["Kenneth Yu"],
    members: [{ user: "kenny", role: "owner" }],
    items: [
      flight("JL5", "JFK", "HND", "2027-03-01T11:00", "2027-03-02T14:00"),
      { input: { type: "stay" as const, name: "Tokyo Inn", city: "Tokyo", checkInDate: "2027-03-02", checkOutDate: "2027-03-03" } },
      flight("CX543", "HND", "HKG", "2027-03-04T10:00", "2027-03-04T13:30"),
      { input: { type: "stay" as const, name: "Harbour Inn", city: "Hong Kong", checkInDate: "2027-03-04", checkOutDate: "2027-03-07" } },
      flight("CX846", "HKG", "JFK", "2027-03-08T10:00", "2027-03-08T14:00"),
    ],
  });

  it("names the city each open night is in, not the first landing's city", () => {
    const findings = nowhereToSleep(projectTrip(trip, kenny));
    expect(findings.map((f) => f.sentence)).toEqual(["Nowhere booked for the night of Mar 3 in Tokyo.", "Nowhere booked for the night of Mar 7 in Hong Kong."]);
  });

  it("gives each finding its own key", () => {
    const keys = nowhereToSleep(projectTrip(trip, kenny)).map((f) => f.key);
    expect(new Set(keys).size).toBe(2);
  });
});
