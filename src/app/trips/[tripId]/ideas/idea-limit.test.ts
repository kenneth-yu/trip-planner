import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { RATE_RULES } from "@/server/security/rate-limit";
import type { ServiceContext } from "@/server/services/context";
import { listIdeas } from "@/server/services/idea-service";
import { testContext } from "@/server/testing";
import { ideaAction, type IdeaState } from "./actions";

const page = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; userId: string } = { ctx: null, userId: "" };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!page.ctx) throw new Error("no test context");
    return { ctx: page.ctx, user: { id: page.userId }, requester: { kind: "member", userId: page.userId, homeZone: "America/New_York" } };
  },
}));

const idle: IdeaState = { status: null, error: null, undo: null };

function form(title: string) {
  const f = new FormData();
  f.set("tripId", TRIP_ID);
  f.set("intent", "add");
  f.set("title", title);
  return f;
}

describe("changing ideas", () => {
  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
    page.ctx = (await testContext()).ctx;
    page.userId = USERS.kenny.id;
  });

  it("allows sixty changes a minute per person, then asks to wait and adds no sixty first", async () => {
    const ctx = page.ctx;
    if (!ctx) throw new Error("no test context");
    expect(RATE_RULES.ideaChange).toMatchObject({ limit: 60, windowMs: 60_000 });
    for (let i = 0; i < 60; i++) expect((await ideaAction(idle, form(`Idea ${i}`))).error).toBeNull();
    const refused = await ideaAction(idle, form("Idea 61"));
    expect(refused).toEqual({ status: null, error: "Too many changes just now. Wait a minute and try again.", undo: null });
    const kept = await listIdeas(ctx, TRIP_ID, { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" });
    expect(kept).toHaveLength(60);
  });

  it("counts each person separately", async () => {
    for (let i = 0; i < 60; i++) await ideaAction(idle, form(`Idea ${i}`));
    page.userId = USERS.jacob.id;
    expect((await ideaAction(idle, form("Jacob's idea"))).error).toBeNull();
  });
});
