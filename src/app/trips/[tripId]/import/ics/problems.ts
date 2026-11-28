import { z } from "zod";
import { IcsProblem } from "@/domain/import/ics";
import { DateTime } from "@/domain/time/luxon";
import { FetchRefused, type RefusalReason } from "@/server/import/fetch-guard";
import { BadDates, NothingInDates, TooManyEvents, TooManyUrlImports, UrlImportUnavailable } from "@/server/import/ics-import";

export const PROBLEMS = [
  "no_file",
  "not_calendar",
  "too_big",
  "link_invalid",
  "link_failed",
  "link_slow",
  "too_many",
  "try_again",
  "bad_dates",
  "from_after_to",
  "range_too_long",
  "too_many_events",
  "nothing_in_dates",
] as const;

export const ProblemCode = z.enum(PROBLEMS);
export type ProblemCode = z.infer<typeof ProblemCode>;

export interface ProblemContext {
  count?: number;
  from?: string;
  to?: string;
}

export interface Problem extends ProblemContext {
  code: ProblemCode;
}

const FIXED_TEXT: Record<Exclude<ProblemCode, "too_many_events" | "nothing_in_dates">, string> = {
  no_file: "Choose a file or paste a link.",
  not_calendar: "That does not look like a calendar file. Choose a file that ends in .ics.",
  too_big: "That calendar is over 2 MB. Export a shorter date range and try again.",
  link_invalid: "Use a link that starts with https:// or webcal://.",
  link_failed: "That link did not give back a calendar. Check that it is the calendar's share or subscribe link.",
  link_slow: "That link did not answer in time. Try again, or download the file and upload it.",
  too_many: "Too many imports in a row. Wait a minute and try again.",
  try_again: "That did not import. Try again.",
  bad_dates: "Those dates are not valid. Choose them again or leave them empty.",
  from_after_to: "The From date is after the To date.",
  range_too_long: "Choose dates less than a year apart.",
};

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.coerce.number().int().min(0).max(100_000);

function shown(day: string): string | null {
  const parsed = Day.safeParse(day);
  return parsed.success ? DateTime.fromISO(parsed.data, { zone: "utc" }).toFormat("LLL d") : null;
}

function between(from: string | undefined, to: string | undefined): string {
  const a = from ? shown(from) : null;
  const b = to ? shown(to) : null;
  if (a && b) return `between ${a} and ${b}`;
  if (a) return `on or after ${a}`;
  if (b) return `on or before ${b}`;
  return "in those dates";
}

export function problemText(problem: Problem): string {
  if (problem.code === "too_many_events") return `That calendar has ${(problem.count ?? 0).toLocaleString("en-US")} events in those dates. Choose dates closer to the trip.`;
  if (problem.code === "nothing_in_dates") return `Nothing in that calendar falls ${between(problem.from, problem.to)}. Change the dates or leave them empty.`;
  return FIXED_TEXT[problem.code];
}

export function problemFromQuery(query: Record<string, string | undefined>): Problem | null {
  const code = ProblemCode.safeParse(query.problem);
  if (!code.success) return null;
  const count = Count.safeParse(query.count);
  const from = Day.safeParse(query.from);
  const to = Day.safeParse(query.to);
  return { code: code.data, ...(count.success ? { count: count.data } : {}), ...(from.success ? { from: from.data } : {}), ...(to.success ? { to: to.data } : {}) };
}

const REFUSAL_CODE: Record<RefusalReason, ProblemCode> = {
  invalid: "link_invalid",
  scheme: "link_invalid",
  credentials: "link_invalid",
  port: "link_invalid",
  address: "link_failed",
  redirects: "link_failed",
  timeout: "link_slow",
  size: "too_big",
  status: "link_failed",
  unreachable: "link_failed",
};

export function problemFor(error: unknown): Problem | null {
  if (error instanceof FetchRefused) return { code: REFUSAL_CODE[error.reason] };
  if (error instanceof UrlImportUnavailable) return { code: "link_failed" };
  if (error instanceof TooManyUrlImports) return { code: "too_many" };
  if (error instanceof IcsProblem) return { code: error.code };
  if (error instanceof BadDates) return { code: error.problem };
  if (error instanceof TooManyEvents) return { code: "too_many_events", count: error.count };
  if (error instanceof NothingInDates) return { code: "nothing_in_dates", ...(error.range.from ? { from: error.range.from } : {}), ...(error.range.to ? { to: error.range.to } : {}) };
  return null;
}

export function problemQuery(problem: Problem): string {
  const params = new URLSearchParams({ problem: problem.code });
  if (problem.count !== undefined) params.set("count", String(problem.count));
  if (problem.from) params.set("from", problem.from);
  if (problem.to) params.set("to", problem.to);
  return params.toString();
}
