import { parseIcs, type SkipReason } from "@/domain/import/ics";
import { assertCanEditTrip } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { consumeRateLimit, RATE_RULES, type RateRule } from "../security/rate-limit";
import { importCalendarEvents } from "../services/inbox-service";
import type { ServiceContext } from "../services/context";
import { NotFound, requireAggregate } from "../services/trip-service";
import { fetchCalendarText } from "./https-transport";

export interface IcsOutcome {
  count: number;
  skipped: number;
  repeating: number;
  skippedBy: Record<SkipReason, number>;
}

export class UrlImportUnavailable extends Error {
  constructor() {
    super("Importing from a link is not turned on yet. Upload the file instead.");
    this.name = "UrlImportUnavailable";
  }
}

export class TooManyUrlImports extends Error {
  constructor() {
    super("Too many links just now. Wait a minute and try again.");
    this.name = "TooManyUrlImports";
  }
}

export interface UrlImportDeps {
  fetchText: (rawUrl: string) => Promise<string>;
  rules: Record<string, RateRule>;
}

const URL_RULE_NAME: string = "icsUrl";

export function urlImportAvailable(rules: Record<string, RateRule> = RATE_RULES): boolean {
  return rules[URL_RULE_NAME] !== undefined;
}

const defaultDeps: UrlImportDeps = { fetchText: fetchCalendarText, rules: RATE_RULES };

async function requireEditor(ctx: ServiceContext, tripId: string, requester: Requester) {
  if (requester.kind !== "member") throw new NotFound();
  assertCanEditTrip(await requireAggregate(ctx.db, tripId), requester);
  return requester;
}

export async function importIcsText(ctx: ServiceContext, tripId: string, requester: Requester, text: string, label: string): Promise<IcsOutcome> {
  await requireEditor(ctx, tripId, requester);
  const parsed = parseIcs(text);
  const batch = await importCalendarEvents(ctx, tripId, requester, parsed.events, { source: "ics", label });
  const skipped = Object.values(parsed.skipped).reduce((sum, n) => sum + n, 0);
  return { count: batch.count, skipped, repeating: parsed.repeating, skippedBy: parsed.skipped };
}

export async function importIcsUrl(ctx: ServiceContext, tripId: string, requester: Requester, rawUrl: string, deps: UrlImportDeps = defaultDeps): Promise<IcsOutcome> {
  const member = await requireEditor(ctx, tripId, requester);
  const rule = deps.rules[URL_RULE_NAME];
  if (!rule) throw new UrlImportUnavailable();
  if (!(await consumeRateLimit(ctx.db, rule, member.userId, ctx.now())).allowed) throw new TooManyUrlImports();
  const text = await deps.fetchText(rawUrl);
  return importIcsText(ctx, tripId, requester, text, "Calendar link");
}
