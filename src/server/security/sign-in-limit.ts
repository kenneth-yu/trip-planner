import { headers } from "next/headers";
import { getDb } from "../db/client";
import { clientIp } from "./client-ip";
import { RATE_RULES, consumeRateLimit } from "./rate-limit";

export async function spendSignInAttempt(): Promise<boolean> {
  const subject = clientIp(await headers(), process.env.TRUST_PROXY === "1");
  const verdict = await consumeRateLimit(await getDb(), RATE_RULES.signIn, subject, new Date());
  return verdict.allowed;
}
