import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { USERS } from "@/fixtures/december-trip";
import * as t from "../db/schema";
import { testContext } from "../testing";
import { exportUserData } from "./export-service";
import { hideTipKind, loadTipPreferences, markTipsIntroSeen, saveTipPreferences } from "./preference-service";
import { NotFound } from "./trip-service";

describe("travel tip settings", () => {
  it("start on, nothing hidden, intro not seen", async () => {
    const { ctx } = await testContext();
    expect(await loadTipPreferences(ctx, USERS.kenny.id)).toEqual({ tipsOn: true, kindsOff: [], introSeen: false });
  });

  it("save per person and leave everyone else alone", async () => {
    const { ctx } = await testContext();
    await saveTipPreferences(ctx, USERS.kenny.id, { tipsOn: false, kindsOff: ["bags", "airport"] });
    expect(await loadTipPreferences(ctx, USERS.kenny.id)).toMatchObject({ tipsOn: false, kindsOff: ["airport", "bags"] });
    expect(await loadTipPreferences(ctx, USERS.jacob.id)).toMatchObject({ tipsOn: true, kindsOff: [] });
  });

  it("refuse kinds that do not exist and unknown people", async () => {
    const { ctx } = await testContext();
    await expect(saveTipPreferences(ctx, USERS.kenny.id, { tipsOn: true, kindsOff: JSON.parse("[\"nonsense\"]") })).rejects.toThrow();
    await expect(saveTipPreferences(ctx, "00000000-0000-4000-8100-0000000000ff", { tipsOn: true, kindsOff: [] })).rejects.toBeInstanceOf(NotFound);
  });

  it("hiding a kind adds it once and keeps the switch as it was", async () => {
    const { ctx } = await testContext();
    await hideTipKind(ctx, USERS.kenny.id, "bags");
    await hideTipKind(ctx, USERS.kenny.id, "bags");
    expect(await loadTipPreferences(ctx, USERS.kenny.id)).toMatchObject({ tipsOn: true, kindsOff: ["bags"] });
  });

  it("ignore stored values that are not kinds", async () => {
    const { ctx, db } = await testContext();
    await db.update(t.users).set({ tipKindsOff: ["bags", "junk"] }).where(eq(t.users.id, USERS.kenny.id));
    expect((await loadTipPreferences(ctx, USERS.kenny.id)).kindsOff).toEqual(["bags"]);
  });

  it("remember the intro was seen", async () => {
    const { ctx } = await testContext();
    await markTipsIntroSeen(ctx, USERS.kenny.id);
    expect((await loadTipPreferences(ctx, USERS.kenny.id)).introSeen).toBe(true);
  });

  it("are in the data export", async () => {
    const { ctx } = await testContext();
    await saveTipPreferences(ctx, USERS.kenny.id, { tipsOn: false, kindsOff: ["border"] });
    expect((await exportUserData(ctx, USERS.kenny.id)).you.travelTips).toEqual({ on: false, kindsOff: ["border"] });
  });
});
