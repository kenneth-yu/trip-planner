import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { TRIP_ID } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { kenny, testContext } from "@/server/testing";
import * as t from "@/server/db/schema";
import { createInvite, revokeInvite } from "@/server/services/sharing-service";
import type { ServiceContext } from "@/server/services/context";
import { continueToSignIn, joinTrip } from "./actions";
import JoinInvitePage from "./join/page";
import { noticeMessage } from "./notice";
import { consentFor } from "./invite-cookies";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; user: { id: string; name: string } | null; jar: Map<string, string> } = {
    ctx: null,
    user: null,
    jar: new Map(),
  };
  return state;
});

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

vi.mock("@/server/auth/session", () => ({ currentUser: async () => world.user }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = world.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      if (value === "") world.jar.delete(name);
      else world.jar.set(name, value);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const mina = { id: "00000000-0000-4000-8100-000000000a01", name: "Mina Okafor" };

async function liveToken(ctx: ServiceContext): Promise<string> {
  const { url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
  return present(url.split("/invite/")[1]);
}

describe("joining through the page buttons", () => {
  beforeEach(async () => {
    const built = await testContext();
    await built.db.insert(t.users).values({ id: mina.id, name: mina.name, email: "mina@example.com" });
    world.ctx = built.ctx;
    world.user = mina;
    world.jar = new Map();
  });

  it("shows the join page with the trip, the inviter and a Join button to a signed in visitor", async () => {
    world.jar.set("trip-invite", await liveToken(present(world.ctx)));
    const html = renderToStaticMarkup(await JoinInvitePage());
    expect(html).toContain("Kenneth invited you as an editor.");
    expect(html).toContain("<h1");
    expect(html).toContain("Join this trip");
    expect(html).not.toContain("Continue");
    expect(html).not.toContain("tpi_");
  });

  it("shows Continue to a signed out visitor", async () => {
    world.user = null;
    world.jar.set("trip-invite", await liveToken(present(world.ctx)));
    const html = renderToStaticMarkup(await JoinInvitePage());
    expect(html).toContain("Continue");
    expect(html).not.toContain("Join this trip");
  });

  it("shows only the problem line for a revoked link", async () => {
    const ctx = present(world.ctx);
    const { inviteId, url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await revokeInvite(ctx, TRIP_ID, kenny, inviteId);
    world.jar.set("trip-invite", present(url.split("/invite/")[1]));
    const html = renderToStaticMarkup(await JoinInvitePage());
    expect(html).toContain("That link no longer works. Ask the trip owner for a new one.");
    expect(html).not.toContain("Join");
  });

  it("sends a malformed invite cookie to the lost invite page without a lookup", async () => {
    world.jar.set("trip-invite", "not-a-token");
    await expect(JoinInvitePage()).rejects.toThrow("redirect:/invite/lost");
    await expect(continueToSignIn()).rejects.toThrow("redirect:/invite/lost");
    await expect(joinTrip()).rejects.toThrow("redirect:/invite/lost");
  });

  it("sends a visitor with no invite cookie to the lost invite page", async () => {
    await expect(JoinInvitePage()).rejects.toThrow("redirect:/invite/lost");
  });

  it("records consent and goes to sign in on Continue", async () => {
    world.user = null;
    const token = await liveToken(present(world.ctx));
    world.jar.set("trip-invite", token);
    await expect(continueToSignIn()).rejects.toThrow(`redirect:/sign-in?next=${encodeURIComponent("/invite/accept")}`);
    expect(world.jar.get("trip-invite-ok")).toBe(consentFor(token));
  });

  it("refuses Continue without an invite cookie", async () => {
    await expect(continueToSignIn()).rejects.toThrow("redirect:/invite/lost");
    expect(world.jar.has("trip-invite-ok")).toBe(false);
  });

  it("joins on the Join button, clears the invite cookies and sets the notice", async () => {
    const ctx = present(world.ctx);
    const token = await liveToken(ctx);
    world.jar.set("trip-invite", token);
    world.jar.set("trip-invite-ok", consentFor(token));
    await expect(joinTrip()).rejects.toThrow(`redirect:/trips/${TRIP_ID}`);
    expect(world.jar.has("trip-invite")).toBe(false);
    expect(world.jar.has("trip-invite-ok")).toBe(false);
    expect(noticeMessage(world.jar.get("trip-joined"), TRIP_ID)).toBe("You joined as an editor.");
    const [m] = await ctx.db.select().from(t.memberships).where(eq(t.memberships.userId, mina.id));
    expect(present(m).role).toBe("editor");
  });

  it("does nothing for a signed out caller or a missing cookie", async () => {
    const ctx = present(world.ctx);
    await expect(joinTrip()).rejects.toThrow("redirect:/invite/lost");
    world.jar.set("trip-invite", await liveToken(ctx));
    world.user = null;
    await expect(joinTrip()).rejects.toThrow("redirect:/invite/join");
    expect(await ctx.db.select().from(t.memberships).where(eq(t.memberships.userId, mina.id))).toEqual([]);
  });

  it("goes to the problem page for a link that no longer works", async () => {
    const ctx = present(world.ctx);
    const { inviteId, url } = await createInvite(ctx, TRIP_ID, kenny, { role: "editor" });
    await revokeInvite(ctx, TRIP_ID, kenny, inviteId);
    world.jar.set("trip-invite", present(url.split("/invite/")[1]));
    await expect(joinTrip()).rejects.toThrow("redirect:/invite/problem/unusable");
    expect(world.jar.has("trip-invite")).toBe(false);
  });
});
