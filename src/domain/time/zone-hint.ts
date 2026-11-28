import { z } from "zod";
import { isValidZone } from "./format";

const ZoneHint = z.string().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/).refine(isValidZone);

export const FALLBACK_ZONE = "UTC";

export function parseZoneHint(raw: unknown): string | null {
  const parsed = ZoneHint.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
