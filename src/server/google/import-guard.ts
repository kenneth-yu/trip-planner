import { ruleForRequest } from "../security/rate-limit";

export const IMPORT_CLOSED = "Google Calendar import is not open yet.";

export const IMPORT_CONNECT_PATH = "/api/google/import/connect";
export const IMPORT_CALLBACK_PATH = "/api/google/import/callback";

export function importPagePath(tripId: string): string {
  return `/trips/${tripId}/import/google`;
}

export function importIsRateLimited(method: string, path: string): boolean {
  return ruleForRequest(method, path) !== null;
}
