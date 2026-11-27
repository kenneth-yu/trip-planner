import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID, USERS } from "@/fixtures/december-trip";
import { testContext } from "@/server/testing";
import { createAssistantToken, listAssistantTokens } from "@/server/services/assistant-service";
import type { ServiceContext } from "@/server/services/context";
import { revokeAssistant } from "./actions";

const page = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; revalidated: string[] } = { ctx: null, revalidated: [] };
  return state;
});

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    page.revalidated.push(path);
  },
}));

vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!page.ctx) throw new Error("no test context");
    return { ctx: page.ctx, user: { id: USERS.jacob.id } };
  },
}));

function revokeForm(tokenId: string) {
  const form = new FormData();
  form.set("tripId", TRIP_ID);
  form.set("tokenId", tokenId);
  return form;
}

describe("revokeAssistant", () => {
  beforeEach(async () => {
    page.ctx = (await testContext()).ctx;
    page.revalidated = [];
  });

  it("treats a second Disconnect of the same assistant as already disconnected", async () => {
    const ctx = page.ctx;
    if (!ctx) throw new Error("no test context");
    const { id } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude", tripId: TRIP_ID });
    await revokeAssistant(revokeForm(id));
    await expect(revokeAssistant(revokeForm(id))).resolves.toBeUndefined();
    expect(await listAssistantTokens(ctx, USERS.jacob.id)).toEqual([]);
    expect(page.revalidated).toEqual([`/trips/${TRIP_ID}/connect`, `/trips/${TRIP_ID}/connect`]);
  });

  it("still surfaces any other failure while disconnecting", async () => {
    const ctx = page.ctx;
    if (!ctx) throw new Error("no test context");
    const { id } = await createAssistantToken(ctx, USERS.jacob.id, { label: "Jacob's Claude", tripId: TRIP_ID });
    page.ctx = {
      ...ctx,
      now: () => {
        throw new Error("clock failed");
      },
    };
    await expect(revokeAssistant(revokeForm(id))).rejects.toThrow("clock failed");
    expect(page.revalidated).toEqual([]);
  });
});
