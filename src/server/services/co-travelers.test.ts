import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { InputProblem } from "@/domain/import/quick-add";
import { AccessDenied } from "@/domain/visibility/project";
import * as t from "../db/schema";
import { RATE_RULES } from "../security/rate-limit";
import { jacob, kenny, testContext } from "./../testing";
import { findCoTraveler, listCoTravelers, RateLimited } from "./member-service";
import { createInvite } from "./sharing-service";
import { createTrip } from "./trip-service";
import type { Requester } from "@/domain/types";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

const NY = "America/New_York";
const link: Requester = { kind: "link", homeZone: NY };
const asMember = (userId: string): Requester => ({ kind: "member", userId, homeZone: NY });
const kennyUser = { id: USERS.kenny.id, name: USERS.kenny.name };

let counter = 0;
async function person(db: Awaited<ReturnType<typeof testContext>>["db"], name: string, email?: string) {
  counter += 1;
  const id = `00000000-0000-4000-8100-${String(100 + counter).padStart(12, "0")}`;
  await db.insert(t.users).values({ id, name, email: email ?? `p${counter}@example.test` });
  return id;
}

async function join(db: Awaited<ReturnType<typeof testContext>>["db"], tripId: string, userId: string, role: "editor" | "viewer" = "editor") {
  await db.insert(t.memberships).values({ tripId, userId, role });
}

async function lisbon() {
  const env = await testContext({ withItems: false });
  const tripId = await createTrip(env.ctx, kennyUser, "Lisbon, someday");
  return { ...env, lisbon: tripId };
}

describe("people from your trips", () => {
  it("lists Jacob from the December trip on a new trip, with a name and an id and nothing else", async () => {
    const { ctx, lisbon: tripId } = await lisbon();
    const people = await listCoTravelers(ctx, tripId, kenny);
    expect(people).toEqual([{ id: USERS.jacob.id, name: USERS.jacob.name }]);
    expect(JSON.stringify(people)).not.toContain("@");
  });

  it("does not list people already on this trip, so December lists nobody", async () => {
    const { ctx } = await testContext({ withItems: false });
    expect(await listCoTravelers(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("never lists the owner themselves", async () => {
    const { ctx, lisbon: tripId } = await lisbon();
    expect((await listCoTravelers(ctx, tripId, kenny)).map((p) => p.id)).not.toContain(USERS.kenny.id);
  });

  it("does not list strangers who share no trip with the owner", async () => {
    const { ctx, db, lisbon: tripId } = await lisbon();
    const stranger = await person(db, "Stella Stranger");
    const other = await createTrip(ctx, { id: USERS.jacob.id, name: USERS.jacob.name }, "Jacob alone");
    await join(db, other, stranger);
    expect((await listCoTravelers(ctx, tripId, kenny)).map((p) => p.name)).toEqual([USERS.jacob.name]);
  });

  it("drops someone who left or was removed from every shared trip", async () => {
    const { ctx, db, lisbon: tripId } = await lisbon();
    const sam = await person(db, "Sam Park");
    await join(db, TRIP_ID, sam);
    expect((await listCoTravelers(ctx, tripId, kenny)).map((p) => p.name)).toContain("Sam Park");
    await db.delete(t.memberships).where(and(eq(t.memberships.tripId, TRIP_ID), eq(t.memberships.userId, sam)));
    expect((await listCoTravelers(ctx, tripId, kenny)).map((p) => p.name)).not.toContain("Sam Park");
  });

  it("shows a person once however many trips they share, and drops people who share only a trip the owner left", async () => {
    const { ctx, db, lisbon: tripId } = await lisbon();
    const second = await createTrip(ctx, kennyUser, "Chicago weekend");
    await join(db, second, USERS.jacob.id);
    const left = await createTrip(ctx, { id: USERS.jacob.id, name: USERS.jacob.name }, "Jacob's trip");
    const sam = await person(db, "Sam Park");
    await join(db, left, USERS.kenny.id);
    await join(db, left, sam);
    expect((await listCoTravelers(ctx, tripId, kenny)).filter((p) => p.id === USERS.jacob.id)).toHaveLength(1);
    expect((await listCoTravelers(ctx, tripId, kenny)).map((p) => p.name)).toContain("Sam Park");
    await db.delete(t.memberships).where(and(eq(t.memberships.tripId, left), eq(t.memberships.userId, USERS.kenny.id)));
    expect((await listCoTravelers(ctx, tripId, kenny)).map((p) => p.name)).not.toContain("Sam Park");
  });

  it("leaves out someone whose account name is an email address, and never puts an email in the output", async () => {
    const { ctx, db, lisbon: tripId } = await lisbon();
    const quiet = await person(db, "quiet@example.test", "quiet@example.test");
    const local = await person(db, "sam.local", "sam.local@example.test");
    await join(db, TRIP_ID, quiet);
    await join(db, TRIP_ID, local);
    const out = JSON.stringify(await listCoTravelers(ctx, tripId, kenny));
    expect(out).not.toContain("@");
    expect(out).not.toContain("sam.local");
  });

  it("orders by first name, then full name, the same whatever order people joined", async () => {
    const names = ["Sam Park", "Sam Adler", "émile Roy", "Eve Cole"];
    const outputs: string[] = [];
    for (const order of [names, [...names].reverse()]) {
      const { ctx, db, lisbon: tripId } = await lisbon();
      for (const name of order) await join(db, TRIP_ID, await person(db, name));
      outputs.push(JSON.stringify((await listCoTravelers(ctx, tripId, kenny)).map((p) => p.name)));
    }
    expect(outputs[0]).toBe(outputs[1]);
    expect(JSON.parse(outputs[0])).toEqual(["émile Roy", "Eve Cole", "Jacob Feldman", "Sam Adler", "Sam Park"]);
  });

  it("refuses an editor, a viewer, a view link and a non member the same way", async () => {
    const { ctx, db, lisbon: tripId } = await lisbon();
    const viewer = await person(db, "Vera Viewer");
    await join(db, tripId, viewer, "viewer");
    await join(db, tripId, USERS.jacob.id, "editor");
    const messages = new Set<string>();
    for (const who of [jacob, asMember(viewer), link, asMember("00000000-0000-4000-8100-0000000000ff")]) {
      await expect(listCoTravelers(ctx, tripId, who)).rejects.toThrow(AccessDenied);
      try {
        await listCoTravelers(ctx, tripId, who);
      } catch (e) {
        messages.add(e instanceof Error ? e.message : "");
      }
    }
    expect(messages.size).toBe(1);
  });

  it("is rate limited per person", async () => {
    const { ctx, lisbon: tripId } = await lisbon();
    for (let i = 0; i < RATE_RULES.inviteCreate.limit; i++) await listCoTravelers(ctx, tripId, kenny);
    await expect(listCoTravelers(ctx, tripId, kenny)).rejects.toThrow(RateLimited);
    await expect(listCoTravelers(ctx, TRIP_ID, jacob)).rejects.toThrow(AccessDenied);
  });
});

describe("picking a person to invite", () => {
  it("finds someone on the list and refuses a forged, unknown or malformed id with the same text", async () => {
    const { ctx, db, lisbon: tripId } = await lisbon();
    const stranger = await person(db, "Stella Stranger");
    expect(await findCoTraveler(ctx, tripId, kenny, USERS.jacob.id)).toEqual({ id: USERS.jacob.id, name: USERS.jacob.name });
    const texts = new Set<string>();
    for (const id of [stranger, "00000000-0000-4000-8100-0000000000fe", "not an id", USERS.kenny.id]) {
      try {
        await findCoTraveler(ctx, tripId, kenny, id);
        texts.add("accepted");
      } catch (e) {
        expect(e).toBeInstanceOf(InputProblem);
        texts.add(e instanceof Error ? e.message : "");
      }
    }
    expect([...texts]).toEqual(["Pick someone from the list."]);
  });

  it("makes the same invite as a plain link and adds nobody", async () => {
    const { ctx, db, lisbon: tripId } = await lisbon();
    const members = (await db.select().from(t.memberships)).length;
    const travelers = (await db.select().from(t.travelers)).length;
    await findCoTraveler(ctx, tripId, kenny, USERS.jacob.id);
    const picked = await createInvite(ctx, tripId, kenny, { role: "viewer" });
    const plain = await createInvite(ctx, tripId, kenny, { role: "viewer" });
    const rows = await db.select().from(t.invites).where(eq(t.invites.tripId, tripId));
    const strip = (r: (typeof rows)[number]) => ({ tripId: r.tripId, role: r.role, travelerId: r.travelerId, createdBy: r.createdBy, acceptedAt: r.acceptedAt, revokedAt: r.revokedAt, expiresAt: r.expiresAt.getTime() });
    const a = strip(present(rows.find((r) => r.id === picked.inviteId)));
    const b = strip(present(rows.find((r) => r.id === plain.inviteId)));
    expect(a).toEqual(b);
    expect(a).toMatchObject({ travelerId: null, acceptedAt: null, revokedAt: null });
    expect((await db.select().from(t.memberships)).length).toBe(members);
    expect((await db.select().from(t.travelers)).length).toBe(travelers);
  });
});
