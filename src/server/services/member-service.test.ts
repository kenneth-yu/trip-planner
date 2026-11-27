import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import * as t from "../db/schema";
import { jacob, kenny, testContext } from "../testing";
import { NotFound } from "./trip-service";
import { listTripMembers } from "./member-service";

const stranger = { kind: "member" as const, userId: "00000000-0000-4000-8100-0000000000ff", homeZone: "America/New_York" };

describe("trip members for the Pick people list", () => {
  it("lists names and roles to a member", async () => {
    const { ctx } = await testContext({ withItems: false });
    const members = await listTripMembers(ctx, TRIP_ID, jacob);
    expect(members).toEqual([
      { userId: USERS.jacob.id, name: USERS.jacob.name, role: "editor" },
      { userId: USERS.kenny.id, name: USERS.kenny.name, role: "owner" },
    ]);
  });

  it("never includes email addresses", async () => {
    const { ctx } = await testContext({ withItems: false });
    const text = JSON.stringify(await listTripMembers(ctx, TRIP_ID, kenny));
    expect(text).not.toContain("@");
    expect(text).not.toContain("email");
  });

  it("refuses a view link requester and a non member", async () => {
    const { ctx } = await testContext({ withItems: false });
    await expect(listTripMembers(ctx, TRIP_ID, { kind: "link", homeZone: "America/New_York" })).rejects.toThrow(AccessDenied);
    await expect(listTripMembers(ctx, TRIP_ID, stranger)).rejects.toThrow(AccessDenied);
  });

  it("says a missing trip is not found", async () => {
    const { ctx } = await testContext({ withItems: false });
    await expect(listTripMembers(ctx, "00000000-0000-4000-8300-0000000000ff", kenny)).rejects.toThrow(NotFound);
  });

  it("shows nothing to a removed member", async () => {
    const { ctx, db } = await testContext({ withItems: false });
    await db.delete(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id));
    await expect(listTripMembers(ctx, TRIP_ID, jacob)).rejects.toThrow(AccessDenied);
  });
});
