import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { testContext } from "@/server/testing";
import * as t from "@/server/db/schema";
import { createInvite, revokeInvite } from "@/server/services/sharing-service";
import type { ServiceContext } from "@/server/services/context";
import { kenny } from "@/server/testing";
import { GET as openLink } from "./[token]/route";
import { GET as accept } from "./accept/route";
import { noticeMessage } from "./notice";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; user: { id: string; name: string } | null } = { ctx: null, user: null };
  return state;
});

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

vi.mock("@/server/auth/session", () => ({
  currentUser: async () => world.user,
}));

const mina = { id: "00000000-0000-4000-8100-000000000a01", name: "Mina Okafor" };

function acceptRequest(cookie?: string, consent = true) {
  const parts = cookie ? [`trip-invite=${cookie}`, ...(consent ? ["trip-invite-ok=1"] : [])] : [];
  return new NextRequest("https://trips.test/invite/accept", { headers: parts.length ? { cookie: parts.join("; ") } : {} });
}

function tokenOf(url: string): string {
  return present(url.split("/invite/")[1]);
}

function setCookies(response: Response): string {
  return response.headers.getSetCookie().join("\n");
}

describe("opening an invite link", () => {
  beforeEach(async () => {
    const built = await testContext();
    await built.db.insert(t.users).values({ id: mina.id, name: mina.name, email: "mina@example.com" });
    world.ctx = built.ctx;
    world.user = null;
  });

  it("keeps the token in a short lived HttpOnly cookie and sends the browser on without it in the address", async () => {
    const ctx = present(world.ctx);
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    const token = tokenOf(url);
    const response = await openLink(new Request(url), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/invite/join");
    expect(response.headers.get("location")).not.toContain(token);
    const cookie = setCookies(response);
    expect(cookie).toContain(`trip-invite=${token}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=3600/i);
    expect(cookie).toMatch(/Path=\/invite/i);
    expect(cookie).toMatch(/trip-invite-ok=;/);
  });

  it("sends a malformed token to the plain problem page and sets no cookie", async () => {
    const response = await openLink(new Request("https://trips.test/invite/x"), { params: Promise.resolve({ token: "../../etc" }) });
    expect(response.headers.get("location")).toBe("/invite/problem/unusable");
    expect(setCookies(response)).toBe("");
  });
});

describe("accepting from the cookie", () => {
  beforeEach(async () => {
    const built = await testContext();
    await built.db.insert(t.users).values({ id: mina.id, name: mina.name, email: "mina@example.com" });
    world.ctx = built.ctx;
    world.user = mina;
  });

  it("gives the lost invite page and touches no trip data when the cookie is missing", async () => {
    const response = await accept(acceptRequest());
    expect(response.headers.get("location")).toBe("/invite/lost");
    const db = present(world.ctx).db;
    expect(await db.select().from(t.memberships).where(eq(t.memberships.userId, mina.id))).toEqual([]);
  });

  it("does not join a signed in visitor who has not pressed the button, as when a page sends them here", async () => {
    const ctx = present(world.ctx);
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    const response = await accept(acceptRequest(tokenOf(url), false));
    expect(response.headers.get("location")).toBe("/invite/join");
    expect(setCookies(response)).not.toContain("trip-joined");
    expect(await ctx.db.select().from(t.memberships).where(eq(t.memberships.userId, mina.id))).toEqual([]);
    const [invite] = await ctx.db.select().from(t.invites);
    expect(present(invite).acceptedAt).toBeNull();
  });

  it("asks a signed out visitor to sign in and keeps the invite", async () => {
    world.user = null;
    const { url } = await createInvite(present(world.ctx), TRIP_ID, kenny, { role: "editor" });
    const response = await accept(acceptRequest(tokenOf(url)));
    expect(response.headers.get("location")).toBe("/invite/join");
    expect(setCookies(response)).not.toContain("trip-invite");
  });

  it("adds the person, clears the invite cookie, sets the one time notice and lands on the trip", async () => {
    const ctx = present(world.ctx);
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    const response = await accept(acceptRequest(tokenOf(url)));
    expect(response.headers.get("location")).toBe(`/trips/${TRIP_ID}`);
    const cookies = setCookies(response);
    expect(cookies).toMatch(/trip-invite=;/);
    expect(cookies).toMatch(/trip-invite-ok=;/);
    const notice = present(response.headers.getSetCookie().find((c) => c.startsWith("trip-joined=")));
    expect(notice).toMatch(/HttpOnly/i);
    const value = present(notice.split(";")[0]?.split("=")[1]);
    expect(noticeMessage(value, TRIP_ID)).toBe("You joined as an editor.");
    const [m] = await ctx.db.select().from(t.memberships).where(eq(t.memberships.userId, mina.id));
    expect(present(m).role).toBe("editor");
  });

  it("says an existing member is already on the trip and leaves the link unused", async () => {
    const ctx = present(world.ctx);
    world.user = { id: USERS.jacob.id, name: USERS.jacob.name };
    await ctx.db.update(t.memberships).set({ role: "viewer" }).where(eq(t.memberships.userId, USERS.jacob.id));
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    const response = await accept(acceptRequest(tokenOf(url)));
    expect(response.headers.get("location")).toBe(`/trips/${TRIP_ID}`);
    const notice = present(response.headers.getSetCookie().find((c) => c.startsWith("trip-joined=")));
    const value = present(notice.split(";")[0]?.split("=")[1]);
    expect(noticeMessage(value, TRIP_ID)).toBe("You are already on this trip as a viewer. Ask the trip owner to change your role.");
    const [invite] = await ctx.db.select().from(t.invites);
    expect(present(invite).acceptedAt).toBeNull();
  });

  it("sends a revoked link to the plain problem page and clears the cookie", async () => {
    const ctx = present(world.ctx);
    const { inviteId, url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await revokeInvite(ctx, TRIP_ID, kenny, inviteId);
    const response = await accept(acceptRequest(tokenOf(url)));
    expect(response.headers.get("location")).toBe("/invite/problem/unusable");
    expect(setCookies(response)).toMatch(/trip-invite=;/);
    expect(await ctx.db.select().from(t.memberships).where(eq(t.memberships.userId, mina.id))).toEqual([]);
  });

  it("sends an expired link to the expired page", async () => {
    const ctx = present(world.ctx);
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    world.ctx = { ...ctx, now: () => new Date(ctx.now().getTime() + 8 * 24 * 60 * 60 * 1000) };
    const response = await accept(acceptRequest(tokenOf(url)));
    expect(response.headers.get("location")).toBe("/invite/problem/expired");
  });

  it("does not put the token or any trip data in the redirect", async () => {
    const ctx = present(world.ctx);
    const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "viewer" });
    const token = tokenOf(url);
    const response = await accept(acceptRequest(token));
    expect(response.headers.get("location")).not.toContain(token);
    expect(await response.text()).toBe("");
  });
});
