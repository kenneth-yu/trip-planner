import { SealError } from "./crypto/sealed";
import { SetupError } from "./env";

const SAFE_CODE = /^[A-Z0-9_]{3,32}$/;

function codeOf(error: unknown): string | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 3; current = current.cause, depth += 1) {
    if ("code" in current && typeof current.code === "string" && SAFE_CODE.test(current.code)) return current.code;
  }
  return undefined;
}

export function failureMessage(task: string, error: unknown): string {
  if (error instanceof SetupError || error instanceof SealError) return `${error.message}\n`;
  const code = codeOf(error);
  return `${task} failed${code ? ` (${code})` : ""}. Check that DATABASE_URL is valid and reachable. Details are not printed because they can include the database address.\n`;
}
