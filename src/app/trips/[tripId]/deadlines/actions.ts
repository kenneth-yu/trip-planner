"use server";

import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { CheckAnchor, CheckGone, dismissCheck, restoreCheck } from "@/server/services/check-service";
import { AccessDenied } from "@/domain/visibility/project";

export interface CheckResult {
  ok: boolean;
}

const Input = z.object({ tripId: z.string().uuid(), anchor: CheckAnchor });

async function run(raw: unknown, act: typeof dismissCheck): Promise<CheckResult> {
  const input = Input.parse(raw);
  const { ctx, requester } = await loadTripPage(input.tripId);
  try {
    await act(ctx, input.tripId, requester, input.anchor);
    return { ok: true };
  } catch (e) {
    if (e instanceof CheckGone || e instanceof AccessDenied) return { ok: false };
    throw e;
  }
}

export async function dismissCheckAction(raw: unknown): Promise<CheckResult> {
  return run(raw, dismissCheck);
}

export async function restoreCheckAction(raw: unknown): Promise<CheckResult> {
  return run(raw, restoreCheck);
}
