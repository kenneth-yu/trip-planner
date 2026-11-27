import { describe, expect, it } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { runChecks } from "@/domain/checks/checks";
import { createPgliteDb } from "../db/client";
import { cachedGeocoder, FakeGeocoder, nominatimGeocoder } from "./geocoder";
import { kenny, testContext } from "../testing";
import { getTripView, quickAddItem, updateItem } from "../services/trip-service";

const NISHIAZABU = { lat: 35.66, lng: 139.72, label: "Nishiazabu, Minato, Tokyo, Japan" };

describe("address lookup", () => {
  it("is cached: the same address is looked up once", async () => {
    const db = await createPgliteDb();
    const fake = new FakeGeocoder({ "3-2-15 Nishiazabu": NISHIAZABU });
    const geo = cachedGeocoder(db, fake);
    expect(await geo.lookup("3-2-15 Nishiazabu")).toEqual(NISHIAZABU);
    expect(await geo.lookup("3-2-15  nishiazabu ")).toEqual(NISHIAZABU);
    expect(await geo.lookup("nowhere at all")).toBeNull();
    expect(await geo.lookup("nowhere at all")).toBeNull();
    expect(fake.calls).toEqual(["3-2-15 Nishiazabu", "nowhere at all"]);
  });

  it("reads OpenStreetMap results and sends no personal details", async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify([{ lat: "35.66", lon: "139.72", display_name: "Nishiazabu" }]), { status: 200 });
    };
    const geo = nominatimGeocoder({ userAgent: "trip-planner", minIntervalMs: 0, fetchImpl: fakeFetch });
    expect(await geo.lookup("3-2-15 Nishiazabu")).toEqual({ lat: 35.66, lng: 139.72, label: "Nishiazabu" });
    const url = new URL(requests[0].url);
    expect([...url.searchParams.keys()].sort()).toEqual(["format", "limit", "q"]);
    expect(requests[0].headers.get("user-agent")).toBe("trip-planner");
  });
});

describe("places in quick add", () => {
  it("looks up an address the offline data cannot place, and is sure", async () => {
    const fake = new FakeGeocoder({ "3-2-15 Nishiazabu, Minato City": NISHIAZABU });
    const { ctx } = await testContext({ overrides: { geocoder: fake } });
    const item = await quickAddItem(ctx, TRIP_ID, kenny, { type: "plan", title: "Omakase", address: "3-2-15 Nishiazabu, Minato City", startLocal: "2026-12-03T19:00", endLocal: "2026-12-03T21:00" });
    expect([item.start.zone, item.status, item.flags]).toEqual(["Asia/Tokyo", "confirmed", []]);
  });

  it("skips the lookup when the city already settles it", async () => {
    const fake = new FakeGeocoder({});
    const { ctx } = await testContext({ overrides: { geocoder: fake } });
    await quickAddItem(ctx, TRIP_ID, kenny, { type: "plan", title: "Tailor", address: "25 Des Voeux Road Central, Hong Kong", startLocal: "2026-12-05T17:00", endLocal: "2026-12-05T18:00" });
    expect(fake.calls).toEqual([]);
  });

  it("flags an unclear place, shows it as a check, and clears it once someone fixes the place", async () => {
    const { ctx } = await testContext();
    const item = await quickAddItem(ctx, TRIP_ID, kenny, { type: "plan", title: "Day trip to Nara", city: "Nara", startLocal: "2026-12-04T10:00", endLocal: "2026-12-04T16:00" });
    expect([item.start.zone, item.status]).toEqual(["Asia/Tokyo", "needs_review"]);
    const finding = present(runChecks(await getTripView(ctx, TRIP_ID, kenny)).find((f) => f.kind === "unsure_place"));
    expect(finding.sentence).toMatch(/^Day trip to Nara: The only Nara we know is in Mali/);

    await updateItem(ctx, TRIP_ID, item.id, kenny, { location: { city: "Nara", name: "Nara Park" } });
    const after = present((await getTripView(ctx, TRIP_ID, kenny)).items.find((i) => i.id === item.id));
    expect([after.status, after.flags]).toEqual(["confirmed", []]);
  });
});
