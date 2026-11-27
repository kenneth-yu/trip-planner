import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { TRAVELERS, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { AccessDenied } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { present } from "@/testing/present";
import { jacob, kenny, testContext } from "@/server/testing";
import * as t from "@/server/db/schema";
import { createTrip, getTripView } from "@/server/services/trip-service";
import { acceptInvite, listInvites } from "@/server/services/sharing-service";
import type { ServiceContext } from "@/server/services/context";
import SharePage from "./page";
import { changeRoleAction, createInviteAction, previewRemoval, removeMemberAction, revokeInviteAction, type CreatedInviteState } from "./actions";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; requester: Requester | null; revalidated: string[] } = { ctx: null, requester: null, revalidated: [] };
  return state;
});

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    world.revalidated.push(path);
  },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/server/web", () => ({
  loadTripPage: async (tripId: string) => {
    if (!world.ctx || !world.requester) throw new Error("no test context");
    const view = await getTripView(world.ctx, tripId, world.requester);
    return { ctx: world.ctx, requester: world.requester, view, user: { id: world.requester.kind === "member" ? world.requester.userId : "" } };
  },
}));

const viewerId = "00000000-0000-4000-8100-000000000a03";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function page() {
  return SharePage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve({}) });
}

describe("the share page", () => {
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-0123");
    world.ctx = (await testContext()).ctx;
    world.requester = kenny;
    world.revalidated = [];
  });

  it("shows the owner the invite form, the people and no pending box when there are no invites", async () => {
    const html = renderToStaticMarkup(await page());
    expect(html.indexOf("Invite someone")).toBeLessThan(html.indexOf("People on this trip"));
    expect(html).toContain("Editor: can add and change things.");
    expect(html).toContain("Viewer: can look, cannot change anything.");
    expect(html).toContain("Create invite link");
    expect(html).toContain("Kenneth Yu");
    expect(html).toContain("You");
    expect(html).not.toContain("Pending invites");
    expect(html).not.toContain("No pending invites");
  });

  it("returns a 404 to an editor", async () => {
    world.requester = jacob;
    await expect(page()).rejects.toThrow("notFound");
  });

  it("returns a 404 to a viewer", async () => {
    const ctx = present(world.ctx);
    await ctx.db.insert(t.users).values({ id: viewerId, name: "Vic Viewer", email: "vic@example.com" });
    await ctx.db.insert(t.memberships).values({ tripId: TRIP_ID, userId: viewerId, role: "viewer" });
    world.requester = { kind: "member", userId: viewerId, homeZone: "America/New_York" };
    await expect(page()).rejects.toThrow("notFound");
  });
});

describe("the share actions", () => {
  beforeEach(async () => {
    world.ctx = (await testContext()).ctx;
    world.requester = kenny;
    world.revalidated = [];
  });

  it("creates a link for the owner and returns it with its invite id, the page lists the pending invite with the newest first", async () => {
    const created = await createInviteAction({ inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null }, form({ tripId: TRIP_ID, role: "viewer", traveler: "new" }));
    expect(created.error).toBeNull();
    expect(created.role).toBe("viewer");
    expect(created.url?.startsWith("https://trips.test/invite/tpi_")).toBe(true);
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("Pending invites");
    expect(html).toContain("Viewer invite, created");
    expect(html).not.toContain(present(created.url).split("/invite/")[1]);
    expect(world.revalidated).toContain(`/trips/${TRIP_ID}/share`);
  });

  it("says what is wrong when the traveler is not on the list, without throwing", async () => {
    const result = await createInviteAction(
      { inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null },
      form({ tripId: TRIP_ID, role: "editor", traveler: TRAVELERS.jacob }),
    );
    expect(result).toEqual({ inviteId: null, travelerId: null, url: null, role: null, forName: null, error: "Pick someone from the list." });
  });

  it("makes a link for a person from the list, names them, and refuses an id off the list like a bad id", async () => {
    const empty = { inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null };
    const trip = await createTrip(present(world.ctx), { id: USERS.kenny.id, name: USERS.kenny.name }, "Lisbon, someday");
    const picked = await createInviteAction(empty, form({ tripId: trip, role: "editor", traveler: "new", personId: USERS.jacob.id }));
    expect(picked).toMatchObject({ forName: "Jacob", role: "editor", error: null });
    const forged = await createInviteAction(empty, form({ tripId: trip, role: "editor", traveler: "new", personId: "00000000-0000-4000-8100-0000000000fe" }));
    const garbage = await createInviteAction(empty, form({ tripId: trip, role: "editor", traveler: "new", personId: "nonsense" }));
    expect(forged).toEqual(garbage);
    expect(forged.error).toBe("Pick someone from the list.");
  });

  it("says to wait when too many invites are made in a row, without a name", async () => {
    const empty = { inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null };
    let last: CreatedInviteState = empty;
    for (let i = 0; i < 31; i++) last = await createInviteAction(empty, form({ tripId: TRIP_ID, role: "editor", traveler: "new" }));
    expect(last).toEqual({ ...empty, error: "Too many invites in a row. Wait a minute and try again." });
  });

  it("refuses an editor and refuses a bad role", async () => {
    world.requester = jacob;
    await expect(createInviteAction({ inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null }, form({ tripId: TRIP_ID, role: "editor", traveler: "new" }))).rejects.toThrow(
      AccessDenied,
    );
    world.requester = kenny;
    await expect(createInviteAction({ inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null }, form({ tripId: TRIP_ID, role: "owner", traveler: "new" }))).rejects.toThrow();
  });

  it("revokes an invite and treats a second revoke as already done", async () => {
    const ctx = present(world.ctx);
    const created = await createInviteAction({ inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null }, form({ tripId: TRIP_ID, role: "editor", traveler: "new" }));
    const inviteId = present(created.inviteId);
    await revokeInviteAction(form({ tripId: TRIP_ID, inviteId }));
    await expect(revokeInviteAction(form({ tripId: TRIP_ID, inviteId }))).resolves.toBeUndefined();
    expect(await listInvites(ctx, TRIP_ID, kenny)).toEqual([]);
  });

  it("lets only the owner change a role and remove a person, and shows the count only through the preview", async () => {
    const ctx = present(world.ctx);
    world.requester = jacob;
    await expect(changeRoleAction(form({ tripId: TRIP_ID, userId: USERS.jacob.id, role: "viewer" }))).rejects.toThrow(AccessDenied);
    await expect(removeMemberAction(form({ tripId: TRIP_ID, userId: USERS.kenny.id }))).rejects.toThrow(AccessDenied);
    await expect(previewRemoval(TRIP_ID, USERS.jacob.id)).rejects.toThrow(AccessDenied);
    world.requester = kenny;
    await changeRoleAction(form({ tripId: TRIP_ID, userId: USERS.jacob.id, role: "viewer" }));
    expect(await previewRemoval(TRIP_ID, USERS.jacob.id)).toBe(0);
    await removeMemberAction(form({ tripId: TRIP_ID, userId: USERS.jacob.id }));
    expect(await ctx.db.select().from(t.memberships).where(eq(t.memberships.userId, USERS.jacob.id))).toEqual([]);
  });

  it("parses its input", async () => {
    await expect(removeMemberAction(form({ tripId: "nope", userId: USERS.jacob.id }))).rejects.toThrow();
    await expect(previewRemoval(TRIP_ID, "nope")).rejects.toThrow();
  });

  it("does not let a joined person's invite link be used again from the list", async () => {
    const ctx = present(world.ctx);
    const created = await createInviteAction({ inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null }, form({ tripId: TRIP_ID, role: "editor", traveler: "new" }));
    await ctx.db.insert(t.users).values({ id: viewerId, name: "Vic Viewer", email: "vic@example.com" });
    await acceptInvite(ctx, present(present(created.url).split("/invite/")[1]), { id: viewerId, name: "Vic Viewer" });
    expect(await listInvites(ctx, TRIP_ID, kenny)).toEqual([]);
  });
});
