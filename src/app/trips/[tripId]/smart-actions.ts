"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { CheckAnchor, CheckGone } from "@/server/services/check-service";
import { hideTipKind } from "@/server/services/preference-service";
import { acknowledgeTipsIntro, applySmartFix } from "@/server/services/smarts-service";
import { InputProblem } from "@/domain/import/quick-add";
import { AccessDenied } from "@/domain/visibility/project";

export interface SmartResult {
  ok: boolean;
}

const Fix = z.object({ tripId: z.string().uuid(), anchor: CheckAnchor });
const Hide = z.object({ tripId: z.string().uuid(), kind: z.enum(["airport", "bags", "sleep", "arrival", "border"]) });
const Intro = z.object({ tripId: z.string().uuid() });

export async function applyFixAction(raw: unknown): Promise<SmartResult> {
  const input = Fix.parse(raw);
  const { ctx, requester, view } = await loadTripPage(input.tripId);
  try {
    await applySmartFix(ctx, view, requester, input.anchor);
  } catch (e) {
    if (e instanceof CheckGone || e instanceof AccessDenied || e instanceof InputProblem) return { ok: false };
    throw e;
  }
  revalidatePath(`/trips/${input.tripId}`, "layout");
  return { ok: true };
}

export async function hideTipKindAction(raw: unknown): Promise<SmartResult> {
  const input = Hide.parse(raw);
  const { ctx, requester } = await loadTripPage(input.tripId);
  if (requester.kind !== "member") return { ok: false };
  await hideTipKind(ctx, requester.userId, input.kind);
  revalidatePath(`/trips/${input.tripId}`, "layout");
  return { ok: true };
}

export async function acknowledgeIntroAction(raw: unknown): Promise<SmartResult> {
  const input = Intro.parse(raw);
  const { ctx, requester } = await loadTripPage(input.tripId);
  try {
    await acknowledgeTipsIntro(ctx, requester);
  } catch (e) {
    if (e instanceof AccessDenied) return { ok: false };
    throw e;
  }
  revalidatePath(`/trips/${input.tripId}`, "layout");
  return { ok: true };
}
