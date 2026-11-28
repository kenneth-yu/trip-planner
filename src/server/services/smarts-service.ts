import { createHash } from "node:crypto";
import { z } from "zod";
import type { ServiceContext } from "./context";
import { CheckAnchor, CheckGone, loadChecks } from "./check-service";
import { loadTipPreferences, markTipsIntroSeen } from "./preference-service";
import { updateItem } from "./trip-service";
import { smartTips, type SmartTip } from "@/domain/smarts/tips";
import type { Item, Requester } from "@/domain/types";
import { AccessDenied, type TripView } from "@/domain/visibility/project";

export interface ShownTip extends SmartTip {
  anchor: string;
}

export interface TipsForPage {
  tips: ShownTip[];
  showIntro: boolean;
}

export const TipAnchor = z.string().regex(/^[0-9a-f]{16}$/);

export function tipAnchor(tripId: string, key: string): string {
  return createHash("sha256").update(`tip|${tripId}|${key}`).digest("hex").slice(0, 16);
}

export async function loadTipsForPage(ctx: ServiceContext, view: TripView, requester: Requester): Promise<TipsForPage> {
  if (requester.kind !== "member" || !view.permissions.canEdit) return { tips: [], showIntro: false };
  const prefs = await loadTipPreferences(ctx, requester.userId);
  if (!prefs.tipsOn) return { tips: [], showIntro: false };
  const tips = smartTips(view)
    .filter((tip) => !prefs.kindsOff.includes(tip.kind))
    .map((tip) => ({ ...tip, anchor: tipAnchor(view.trip.id, tip.key) }));
  return { tips, showIntro: tips.length > 0 && !prefs.introSeen };
}

export async function acknowledgeTipsIntro(ctx: ServiceContext, requester: Requester): Promise<void> {
  if (requester.kind !== "member") throw new AccessDenied();
  await markTipsIntroSeen(ctx, requester.userId);
}

export async function applySmartFix(ctx: ServiceContext, view: TripView, requester: Requester, anchor: string): Promise<Item> {
  if (requester.kind !== "member") throw new AccessDenied();
  const parsed = CheckAnchor.safeParse(anchor);
  if (!parsed.success) throw new CheckGone();
  const state = await loadChecks(ctx, view, requester);
  const target = state.everyFinding.find((f) => f.anchor === parsed.data);
  const fix = target?.fix;
  const itemId = target?.itemIds[0];
  if (!fix || !itemId) throw new CheckGone();
  return updateItem(ctx, view.trip.id, itemId, requester, { start: fix.start, end: fix.end });
}
