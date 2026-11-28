import { eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import type { ServiceContext } from "./context";
import { NotFound } from "./trip-service";
import { TIP_KINDS, type TipKind } from "@/domain/smarts/kinds";

export interface TipPreferences {
  tipsOn: boolean;
  kindsOff: TipKind[];
  introSeen: boolean;
}

const KindSchema = z.enum(["airport", "bags", "sleep", "arrival", "border"]);

export const TipPreferencesInput = z.object({
  tipsOn: z.boolean(),
  kindsOff: z.array(KindSchema).max(TIP_KINDS.length),
});

function onlyKinds(raw: string[]): TipKind[] {
  return TIP_KINDS.filter((k) => raw.includes(k));
}

export async function loadTipPreferences(ctx: ServiceContext, userId: string): Promise<TipPreferences> {
  const [row] = await ctx.db
    .select({ tipsOn: t.users.tipsOn, kindsOff: t.users.tipKindsOff, introSeen: t.users.tipsIntroSeen })
    .from(t.users)
    .where(eq(t.users.id, userId));
  if (!row) throw new NotFound("That account does not exist.");
  return { tipsOn: row.tipsOn, kindsOff: onlyKinds(row.kindsOff), introSeen: row.introSeen };
}

export async function saveTipPreferences(ctx: ServiceContext, userId: string, input: z.infer<typeof TipPreferencesInput>): Promise<TipPreferences> {
  const parsed = TipPreferencesInput.parse(input);
  const kindsOff = onlyKinds(parsed.kindsOff);
  const updated = await ctx.db
    .update(t.users)
    .set({ tipsOn: parsed.tipsOn, tipKindsOff: kindsOff })
    .where(eq(t.users.id, userId))
    .returning({ introSeen: t.users.tipsIntroSeen });
  const [row] = updated;
  if (!row) throw new NotFound("That account does not exist.");
  return { tipsOn: parsed.tipsOn, kindsOff, introSeen: row.introSeen };
}

export async function hideTipKind(ctx: ServiceContext, userId: string, kind: TipKind): Promise<TipPreferences> {
  const parsed = KindSchema.parse(kind);
  const current = await loadTipPreferences(ctx, userId);
  return saveTipPreferences(ctx, userId, { tipsOn: current.tipsOn, kindsOff: [...current.kindsOff, parsed] });
}

export async function markTipsIntroSeen(ctx: ServiceContext, userId: string): Promise<void> {
  await ctx.db.update(t.users).set({ tipsIntroSeen: true }).where(eq(t.users.id, userId));
}
