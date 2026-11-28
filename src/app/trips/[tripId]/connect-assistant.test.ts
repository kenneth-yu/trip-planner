import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { testContext } from "@/server/testing";
import { listAssistantTokens } from "@/server/services/assistant-service";
import type { ServiceContext } from "@/server/services/context";
import { RATE_RULES } from "@/server/security/rate-limit";
import { connectAssistant } from "./actions";

const page = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; userId: string } = { ctx: null, userId: "" };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!page.ctx) throw new Error("no test context");
    return { ctx: page.ctx, user: { id: page.userId }, view: { permissions: { canEdit: true } } };
  },
}));

function form(label: string) {
  const f = new FormData();
  f.set("tripId", TRIP_ID);
  f.set("label", label);
  return f;
}

describe("making assistant links", () => {
  beforeEach(async () => {
    process.env.APP_URL = "https://trips.test";
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
    page.ctx = (await testContext()).ctx;
    page.userId = USERS.jacob.id;
  });

  it("allows ten links an hour per person, then asks to wait and makes no eleventh", async () => {
    const ctx = page.ctx;
    if (!ctx) throw new Error("no test context");
    expect(RATE_RULES.assistantLink).toMatchObject({ limit: 10, windowMs: 3_600_000 });
    for (let i = 0; i < 10; i++) {
      const made = await connectAssistant({ url: null }, form(`Link ${i}`));
      expect(made.url).toMatch(/\/api\/mcp\/tpa_/);
    }
    const refused = await connectAssistant({ url: null }, form("Link 11"));
    expect(refused).toEqual({ url: null, message: "You made several links just now. Wait a while and try again." });
    expect(await listAssistantTokens(ctx, USERS.jacob.id)).toHaveLength(10);
  });

  it("counts each person separately", async () => {
    for (let i = 0; i < 10; i++) await connectAssistant({ url: null }, form(`Link ${i}`));
    page.userId = USERS.kenny.id;
    expect((await connectAssistant({ url: null }, form("Kenny's link"))).url).not.toBeNull();
  });
});
