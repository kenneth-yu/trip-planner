import { headers } from "next/headers";
import { getDb } from "../db/client";
import { clientIp } from "./client-ip";
import { trustProxy } from "./trust-proxy";
import { RATE_RULES, consumeRateLimit } from "./rate-limit";

export async function spendSignInAttempt(): Promise<boolean> {
  const subject = clientIp(await headers(), trustProxy(process.env));
  const verdict = await consumeRateLimit(await getDb(), RATE_RULES.signIn, subject, new Date());
  return verdict.allowed;
}
