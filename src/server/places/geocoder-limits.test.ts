import { describe, expect, it } from "vitest";
import { createPgliteDb } from "../db/client";
import * as t from "../db/schema";
import { cachedGeocoder, FakeGeocoder, nominatimGeocoder } from "./geocoder";

const HIT = { lat: 35.66, lng: 139.72, label: "Nishiazabu, Minato, Tokyo, Japan" };

function blockEventLoopFor(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until);
}

describe("address lookup spacing", () => {
  it("keeps concurrent lookups apart by the minimum interval", async () => {
    const starts: number[] = [];
    const fakeFetch: typeof fetch = async () => {
      starts.push(Date.now());
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const geo = nominatimGeocoder({ userAgent: "trip-planner", minIntervalMs: 60, fetchImpl: fakeFetch });
    await Promise.all(Array.from({ length: 6 }, (_, i) => geo.lookup(`${i} Soy Street`)));
    expect(starts).toHaveLength(6);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(60);
  });

  it("keeps the interval from the real start of a late lookup", async () => {
    const starts: number[] = [];
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      starts.push(Date.now());
      calls += 1;
      if (calls === 1) blockEventLoopFor(30);
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const geo = nominatimGeocoder({ userAgent: "trip-planner", minIntervalMs: 20, fetchImpl: fakeFetch });
    const first = geo.lookup("1 Soy Street");
    const second = geo.lookup("2 Soy Street");
    const third = geo.lookup("3 Soy Street");
    await Promise.all([first, second, third]);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(20);
  });
});

describe("address lookup failures", () => {
  it("lets the next lookup run after one fails", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 503 }) : new Response(JSON.stringify([]), { status: 200 });
    };
    const geo = nominatimGeocoder({ userAgent: "trip-planner", minIntervalMs: 5, fetchImpl: fakeFetch });
    const results = await Promise.allSettled([geo.lookup("1 Soy Street"), geo.lookup("2 Soy Street")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
  });
});

describe("address lookup cache", () => {
  it("looks an address up again once the cached answer is old", async () => {
    const db = await createPgliteDb();
    const fake = new FakeGeocoder({ "3-2-15 Nishiazabu": HIT });
    let now = new Date("2026-11-27T00:00:00Z");
    const geo = cachedGeocoder(db, fake, { now: () => now });
    await geo.lookup("3-2-15 Nishiazabu");
    await geo.lookup("3-2-15 Nishiazabu");
    expect(fake.calls).toHaveLength(1);
    now = new Date("2026-12-31T00:00:00Z");
    await geo.lookup("3-2-15 Nishiazabu");
    expect(fake.calls).toHaveLength(2);
    expect(await db.select().from(t.geocodeCache)).toHaveLength(1);
  });

  it("drops expired rows when it adds a new one", async () => {
    const db = await createPgliteDb();
    const fake = new FakeGeocoder({});
    let now = new Date("2026-11-01T00:00:00Z");
    const geo = cachedGeocoder(db, fake, { now: () => now });
    await geo.lookup("1 Old Street");
    now = new Date("2026-12-31T00:00:00Z");
    await geo.lookup("2 New Street");
    expect(await db.select().from(t.geocodeCache)).toHaveLength(1);
  });

  it("keeps at most the newest rows up to the cap", async () => {
    const db = await createPgliteDb();
    const fake = new FakeGeocoder({});
    let now = new Date("2026-11-27T00:00:00Z");
    const geo = cachedGeocoder(db, fake, { now: () => now, maxRows: 3 });
    for (let i = 0; i < 6; i++) {
      now = new Date(now.getTime() + 1000);
      await geo.lookup(`${i} Soy Street`);
    }
    expect(await db.select().from(t.geocodeCache)).toHaveLength(3);
  });
});
