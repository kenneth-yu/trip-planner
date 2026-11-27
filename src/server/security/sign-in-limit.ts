import { headers } from "next/headers";
import { getDb } from "../db/client";
import { clientIp } from "./client-ip";
import { RATE_RULES, consumeRateLimit } from "./rate-limit";

export type SignInAttempt = "allowed" | "limited" | "unavailable";

export async function spendSignInAttempt(): Promise<SignInAttempt> {
  try {
    const subject = clientIp(await headers(), process.env.TRUST_PROXY === "1");
    const verdict = await consumeRateLimit(await getDb(), RATE_RULES.signIn, subject, new Date());
    return verdict.allowed ? "allowed" : "limited";
  } catch {
    console.error(`rate limit unavailable for rule ${RATE_RULES.signIn.name}`);
    return "unavailable";
  }
}
