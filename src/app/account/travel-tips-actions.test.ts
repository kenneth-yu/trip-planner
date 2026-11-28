import { beforeEach, describe, expect, it, vi } from "vitest";
import { USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { loadTipPreferences, saveTipPreferences } from "@/server/services/preference-service";
import { testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { saveTravelTipsAction, type TravelTipsState } from "./travel-tips-actions";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; user: { id: string } | null } = { ctx: null, user: null };
  return state;
});

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

vi.mock("@/server/auth/session", () => ({ currentUser: async () => world.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const idle: TravelTipsState = { status: "idle" };

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("saving the Travel smarts section", () => {
  beforeEach(async () => {
    world.ctx = (await testContext()).ctx;
    world.user = { id: USERS.kenny.id };
  });

  it("turns off the listed kinds that are unchecked and the switch when it is unchecked", async () => {
    const state = await saveTravelTipsAction(idle, form([["kind", "airport"]]));
    expect(state).toEqual({ status: "saved" });
    expect(await loadTipPreferences(present(world.ctx), USERS.kenny.id)).toMatchObject({ tipsOn: false, kindsOff: ["bags"] });
  });

  it("reads the saved preferences first, so a kind the section does not list keeps its state", async () => {
    const ctx = present(world.ctx);
    await saveTipPreferences(ctx, USERS.kenny.id, { tipsOn: true, kindsOff: ["sleep", "border"] });
    await saveTravelTipsAction(idle, form([["tipsOn", "on"], ["kind", "airport"], ["kind", "bags"]]));
    expect(await loadTipPreferences(ctx, USERS.kenny.id)).toMatchObject({ tipsOn: true, kindsOff: ["sleep", "border"] });
    await saveTravelTipsAction(idle, form([["tipsOn", "on"], ["kind", "bags"]]));
    expect((await loadTipPreferences(ctx, USERS.kenny.id)).kindsOff).toEqual(["airport", "sleep", "border"]);
  });

  it("ignores kinds that do not exist in the form", async () => {
    await saveTravelTipsAction(idle, form([["tipsOn", "on"], ["kind", "airport"], ["kind", "bags"], ["kind", "nonsense"]]));
    expect((await loadTipPreferences(present(world.ctx), USERS.kenny.id)).kindsOff).toEqual([]);
  });

  it("sends a signed out person to sign in and saves nothing", async () => {
    world.user = null;
    await expect(saveTravelTipsAction(idle, form([["tipsOn", "on"]]))).rejects.toThrow("redirect:/sign-in");
    expect(await loadTipPreferences(present(world.ctx), USERS.kenny.id)).toMatchObject({ tipsOn: true, kindsOff: [] });
  });
});
