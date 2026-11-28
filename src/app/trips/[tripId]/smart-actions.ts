"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { CheckAnchor, CheckGone, dismissCheck } from "@/server/services/check-service";
import { hideTipKind, TipKindSchema } from "@/server/services/preference-service";
import { applySmartFix } from "@/server/services/smarts-service";
import { setFlash } from "@/app/ui/item-form/set-flash";
import type { FlashKind } from "@/app/ui/item-form/flash";
import { InputProblem } from "@/domain/import/quick-add";
import { AccessDenied } from "@/domain/visibility/project";

export interface SmartResult {
  ok: boolean;
}

const Anchored = z.object({ tripId: z.string().uuid(), anchor: CheckAnchor });
const Hide = z.object({ tripId: z.string().uuid(), kind: TipKindSchema });

async function finish(tripId: string, flash: FlashKind): Promise<SmartResult> {
  await setFlash(flash, tripId);
  revalidatePath(`/trips/${tripId}`, "layout");
  return { ok: true };
}

export async function applyFixAction(raw: unknown): Promise<SmartResult> {
  const input = Anchored.parse(raw);
  const { ctx, requester, view } = await loadTripPage(input.tripId);
  try {
    await applySmartFix(ctx, view, requester, input.anchor);
  } catch (e) {
    if (e instanceof CheckGone || e instanceof AccessDenied || e instanceof InputProblem) return { ok: false };
    throw e;
  }
  return finish(input.tripId, "fixed");
}

export async function markFineAction(raw: unknown): Promise<SmartResult> {
  const input = Anchored.parse(raw);
  const { ctx, requester } = await loadTripPage(input.tripId);
  try {
    await dismissCheck(ctx, input.tripId, requester, input.anchor);
  } catch (e) {
    if (e instanceof CheckGone || e instanceof AccessDenied) return { ok: false };
    throw e;
  }
  return finish(input.tripId, "fine");
}

export async function hideTipKindAction(raw: unknown): Promise<SmartResult> {
  const input = Hide.parse(raw);
  const { ctx, requester, view } = await loadTripPage(input.tripId);
  if (requester.kind !== "member" || !view.permissions.canEdit) return { ok: false };
  await hideTipKind(ctx, requester.userId, input.kind);
  return finish(input.tripId, "tip_hidden");
}
