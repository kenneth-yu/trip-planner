import { describe, expect, it } from "vitest";
import { createAdapter, generateSessionToken, lookupSession } from "./adapter";
import { sessionMachine } from "@/domain/state/session.machine";
import { testContext } from "../testing";
import { present } from "@/testing/present";
import { USERS } from "@/fixtures/december-trip";

const DAY = 86400_000;

describe("session machine matches the stored session", () => {
  it("walks signIn, roll, expire and signOut against real session rows", async () => {
    const { db } = await testContext({ withItems: false });
    let clock = new Date("2026-11-26T12:00:00Z");
    const adapter = createAdapter(db, () => clock);
    const token = generateSessionToken();
    const observed = async () => ((await lookupSession(db, token, clock)) ? "Active" : "SignedOut");

    let state: string = sessionMachine.initial;
    expect(await observed()).toBe(state);

    state = sessionMachine.states.SignedOut.on.signIn;
    await present(adapter.createSession)({ sessionToken: token, userId: USERS.kenny.id, expires: new Date(clock.getTime() + 30 * DAY) });
    expect(await observed()).toBe(state);

    state = sessionMachine.states.Active.on.roll;
    clock = new Date(clock.getTime() + 2 * DAY);
    expect(await observed()).toBe(state);

    state = sessionMachine.states.Active.on.expire;
    clock = new Date(clock.getTime() + 31 * DAY);
    expect(await observed()).toBe(state);

    await present(adapter.createSession)({ sessionToken: token, userId: USERS.kenny.id, expires: new Date(clock.getTime() + 30 * DAY) });
    expect(await observed()).toBe("Active");
    state = sessionMachine.states.Active.on.signOut;
    await present(adapter.deleteSession)(token);
    expect(await observed()).toBe(state);
  });
});
