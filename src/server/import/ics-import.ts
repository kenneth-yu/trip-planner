import { parseIcs, type SkipReason } from "@/domain/import/ics";
import { inRange, MAX_EVENTS_IN_RANGE, parseRange, type DateRange, type RangeProblem } from "@/domain/import/date-range";
import { assertCanEditTrip } from "@/domain/visibility/project";
import type { Requester } from "@/domain/types";
import { consumeRateLimit, RATE_RULES, type RateRule } from "../security/rate-limit";
import { importCalendarEvents, listInbox } from "../services/inbox-service";
import type { ServiceContext } from "../services/context";
import { NotFound, requireAggregate } from "../services/trip-service";
import { fetchCalendarText } from "./https-transport";

export interface IcsOutcome {
  waiting: number;
  matched: number;
  leftOut: number;
  skippedBy: Record<SkipReason, number>;
  outsideDates: number;
}

export interface IcsDates {
  from: unknown;
  to: unknown;
}

export class BadDates extends Error {
  constructor(readonly problem: RangeProblem) {
    super(problem);
    this.name = "BadDates";
  }
}

export class TooManyEvents extends Error {
  constructor(readonly count: number) {
    super("too many events");
    this.name = "TooManyEvents";
  }
}

export class NothingInDates extends Error {
  constructor(readonly range: DateRange) {
    super("nothing in the dates");
    this.name = "NothingInDates";
  }
}

export class UrlImportUnavailable extends Error {
  constructor() {
    super("Importing from a link is not turned on yet.");
    this.name = "UrlImportUnavailable";
  }
}

export class TooManyUrlImports extends Error {
  constructor() {
    super("Too many imports in a row.");
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

export async function importIcsText(ctx: ServiceContext, tripId: string, requester: Requester, text: string, label: string, dates: IcsDates): Promise<IcsOutcome> {
  await requireEditor(ctx, tripId, requester);
  const range = parseRange(dates.from, dates.to);
  if (!range.ok) throw new BadDates(range.problem);
  const parsed = parseIcs(text);
  const kept = parsed.events.filter((event) => inRange(event, range.range));
  const outsideDates = parsed.events.length - kept.length;
  if (kept.length > MAX_EVENTS_IN_RANGE) throw new TooManyEvents(kept.length);
  const skipped = Object.values(parsed.skipped).reduce((sum, n) => sum + n, 0);
  if (kept.length === 0 && parsed.events.length > 0) throw new NothingInDates(range.range);
  const leftOut = skipped + outsideDates;
  if (kept.length === 0) return { waiting: 0, matched: 0, leftOut, skippedBy: parsed.skipped, outsideDates };
  const { batchId } = await importCalendarEvents(ctx, tripId, requester, kept, { source: "ics", label });
  const batch = (await listInbox(ctx, tripId, requester)).filter((entry) => entry.batchId === batchId);
  return { waiting: batch.length, matched: batch.filter((entry) => entry.match !== null).length, leftOut, skippedBy: parsed.skipped, outsideDates };
}

export async function importIcsUrl(ctx: ServiceContext, tripId: string, requester: Requester, rawUrl: string, dates: IcsDates, deps: UrlImportDeps = defaultDeps): Promise<IcsOutcome> {
  const member = await requireEditor(ctx, tripId, requester);
  const rule = deps.rules[URL_RULE_NAME];
  if (!rule) throw new UrlImportUnavailable();
  const range = parseRange(dates.from, dates.to);
  if (!range.ok) throw new BadDates(range.problem);
  if (!(await consumeRateLimit(ctx.db, rule, member.userId, ctx.now())).allowed) throw new TooManyUrlImports();
  const text = await deps.fetchText(rawUrl);
  return importIcsText(ctx, tripId, requester, text, "Calendar link", dates);
}
