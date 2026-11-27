import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TRAVELERS } from "@/fixtures/december-trip";
import { isValidZone } from "../time/format";
import { inputToProposal, InputProblem } from "./quick-add";
import { planProposals } from "./pipeline";
import type { ProposedItem } from "./proposal";
import { FUZZ_SEED, fuzzParams, garbageText, hugeText } from "./fuzz-config";

const travelers = [
  { id: TRAVELERS.kenny, name: "Kenneth Yu" },
  { id: TRAVELERS.jacob, name: "Jacob Lee" },
];
const places = { homeZone: "America/New_York" };

const localDateTime = fc.oneof(
  fc.date({ min: new Date("2026-01-01T00:00:00Z"), max: new Date("2027-12-31T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 16)),
  fc.constantFrom("2026-03-08T02:30", "2026-11-01T01:30", "2026-02-30T10:00", "2026-12-05T25:99", "0000-01-01T00:00", "9999-12-31T23:59", "2026-12-05T24:00"),
  garbageText,
);
const localDate = fc.oneof(
  fc.date({ min: new Date("2026-01-01T00:00:00Z"), max: new Date("2027-12-31T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
  fc.constantFrom("2026-02-30", "2026-13-01", "0000-00-00"),
  garbageText,
);
const clock = fc.option(fc.oneof(fc.constantFrom("00:00", "23:59", "24:00", "99:99", "15:00", "02:30"), garbageText), { nil: undefined });
const text = fc.option(fc.oneof(garbageText, hugeText, fc.constantFrom("Tokyo", "Hong Kong", "Springfield", "Haneda", "Cairo", "Kyoto")), { nil: undefined });
const code = fc.oneof(fc.constantFrom("NRT", "HND", "JFK", "HKG", "QQQ", "xyz", "ZZZ", "nrt"), garbageText);
const flightNumber = fc.oneof(fc.constantFrom("NH159", "CX 509", "cx509", "XX1", "A1 1"), garbageText);

const commonArb = fc.record(
  {
    travelers: fc.array(fc.oneof(fc.constantFrom("Kenneth", "Jacob", "jacob lee", TRAVELERS.kenny), garbageText), { maxLength: 3 }),
    notes: text,
    confirmationCode: text,
    phone: text,
    source: text,
    country: text,
    deadlines: fc.array(
      fc.record({ kind: fc.constantFrom("free_cancellation", "partial_refund", "change", "other"), local: localDateTime, consequence: fc.option(garbageText, { nil: undefined }) }),
      { maxLength: 3 },
    ),
  },
  { requiredKeys: [] },
);

const itemArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.tuple(commonArb, fc.record({ type: fc.constant("flight"), flightNumber, fromAirport: code, toAirport: code, departLocal: localDateTime, arriveLocal: localDateTime })).map(([c, i]) => ({ ...c, ...i })),
  fc
    .tuple(commonArb, fc.record({ type: fc.constant("stay"), name: garbageText, city: text, address: text, checkInDate: localDate, checkInTime: clock, checkOutDate: localDate, checkOutTime: clock }))
    .map(([c, i]) => ({ ...c, ...i })),
  fc.tuple(commonArb, fc.record({ type: fc.constant("plan"), title: garbageText, place: text, city: text, address: text, startLocal: localDateTime, endLocal: fc.option(localDateTime, { nil: undefined }) })).map(([c, i]) => ({ ...c, ...i })),
  fc.tuple(commonArb, fc.record({ type: fc.constant("transfer"), fromCity: garbageText, toCity: garbageText, startLocal: localDateTime, endLocal: localDateTime })).map(([c, i]) => ({ ...c, ...i })),
  fc.jsonValue(),
  fc.anything(),
);

function expectSound(p: ProposedItem) {
  expect(isValidZone(p.start.zone)).toBe(true);
  expect(isValidZone(p.end.zone)).toBe(true);
  expect(Number.isFinite(Date.parse(p.start.at))).toBe(true);
  expect(Number.isFinite(Date.parse(p.end.at))).toBe(true);
  expect(Date.parse(p.end.at)).toBeGreaterThanOrEqual(Date.parse(p.start.at));
  for (const d of p.deadlines) {
    expect(isValidZone(d.at.zone)).toBe(true);
    expect(Number.isFinite(Date.parse(d.at.at))).toBe(true);
  }
  if (p.problems.length) expect(p.status).toBe("needs_review");
}

function build(raw: unknown): ProposedItem | null {
  try {
    return inputToProposal(raw, travelers, places);
  } catch (e) {
    if (e instanceof InputProblem || e instanceof z.ZodError) return null;
    throw e;
  }
}

describe(`quick add fuzz (seed ${FUZZ_SEED})`, () => {
  it("inputToProposal only throws typed validation errors and every proposal is sound", () => {
    fc.assert(
      fc.property(itemArb, (raw) => {
        const p = build(raw);
        if (p) expectSound(p);
      }),
      fuzzParams(500),
    );
  });

  it("a place nobody can locate is flagged for review, never given a guessed zone silently", () => {
    const nonsense = fc.stringMatching(/^[bcdfghjklmnpqrstvwxz]{9,14}$/);
    fc.assert(
      fc.property(nonsense, fc.constantFrom("2026-12-05T10:00", "2026-03-08T12:00", "2026-07-01T00:00"), (city, startLocal) => {
        for (const raw of [
          { type: "plan", title: "Walk", city, startLocal },
          { type: "stay", name: "Somewhere", city, checkInDate: startLocal.slice(0, 10), checkOutDate: "2026-12-20" },
          { type: "transfer", fromCity: city, toCity: city, startLocal, endLocal: "2026-12-20T10:00" },
        ]) {
          const p = build(raw);
          expect(p?.problems.length).toBeGreaterThan(0);
          expect(p?.status).toBe("needs_review");
        }
      }),
      fuzzParams(),
    );
  });

  it("an unlocatable plan or stay carries a problem and needs review", () => {
    for (const city of ["Zzyzx Qwerty", "", "   ", "\u0000", "Xyzzyville"]) {
      const plan = build({ type: "plan", title: "Walk", city, startLocal: "2026-12-05T10:00" });
      expect(plan?.problems.length).toBeGreaterThan(0);
      expect(plan?.status).toBe("needs_review");
      const stay = build({ type: "stay", name: "Somewhere", city, checkInDate: "2026-12-05", checkOutDate: "2026-12-06" });
      expect(stay?.problems.length).toBeGreaterThan(0);
      expect(stay?.status).toBe("needs_review");
    }
  });

  it("planProposals clusters any set of sound proposals without throwing", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 6 }), (raws) => {
        const proposals = raws.map(build).filter((p): p is ProposedItem => p !== null);
        for (const draft of planProposals(proposals, [])) expectSound(draft.proposed);
      }),
      fuzzParams(150),
    );
  });
});
