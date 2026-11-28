import { z } from "zod";
import { IcsProblem } from "@/domain/import/ics";
import { FetchRefused, type RefusalReason } from "@/server/import/fetch-guard";
import { TooManyUrlImports, UrlImportUnavailable } from "@/server/import/ics-import";

export const PROBLEMS = ["no_file", "not_calendar", "too_big", "link_invalid", "link_failed", "link_slow", "link_off", "too_many", "try_again"] as const;

export const ProblemCode = z.enum(PROBLEMS);
export type ProblemCode = z.infer<typeof ProblemCode>;

export const PROBLEM_TEXT: Record<ProblemCode, string> = {
  no_file: "Choose a calendar file first.",
  not_calendar: "We could not read that file as a calendar.",
  too_big: "That calendar is bigger than 2 MB.",
  link_invalid: "Paste a full link that starts with https://, with no user name, password or port in it.",
  link_failed: "We could not get a calendar from that link.",
  link_slow: "That link took too long to answer.",
  link_off: "Importing from a link is not turned on yet. Upload the file instead.",
  too_many: "Too many links just now. Wait a minute and try again.",
  try_again: "That did not import. Try again.",
};

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

export function problemFor(error: unknown): ProblemCode | null {
  if (error instanceof FetchRefused) return REFUSAL_CODE[error.reason];
  if (error instanceof UrlImportUnavailable) return "link_off";
  if (error instanceof TooManyUrlImports) return "too_many";
  if (error instanceof IcsProblem) return error.code;
  return null;
}
